import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { parseFeed } from "./rss.ts";
import { buildMatcher, normalizeName, playersMentioned } from "./match.ts";
import { fetchFeed, fetchInjuries } from "./sources.ts";
import { injuriesByPlayer, newsItems, readLiveStatus, refreshLive, type LiveCache } from "./index.ts";

const dirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ff-live-"));
  dirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const PLAYERS = [
  { id: "00-0036900", name: "Ja'Marr Chase", team: "CIN", position: "WR" },
  { id: "00-0039139", name: "Jahmyr Gibbs", team: "DET", position: "RB" },
  { id: "00-0039075", name: "Puka Nacua", team: "LAR", position: "WR" },
  { id: "00-0000001", name: "Michael Thomas", team: "NO", position: "WR" },
];

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Feed</title>
    <item>
      <title>Puka Nacua limited in practice</title>
      <link>https://example.com/a</link>
      <dc:creator>Beat Writer</dc:creator>
      <pubDate>Tue, 18 Aug 2026 13:52:25 EST</pubDate>
    </item>
    <item>
      <title><![CDATA[Ja'Marr Chase &amp; the Bengals' offense]]></title>
      <link>https://example.com/b</link>
      <pubDate>Tue, 18 Aug 2026 16:20:24 EST</pubDate>
    </item>
    <item>
      <description>no title here</description>
    </item>
  </channel>
</rss>`;

describe("rss", () => {
  test("parses entries and skips ones with no headline", () => {
    const entries = parseFeed(RSS);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].title, "Puka Nacua limited in practice");
    assert.equal(entries[0].link, "https://example.com/a");
    assert.equal(entries[0].author, "Beat Writer");
    assert.equal(entries[0].publishedAt, new Date("Tue, 18 Aug 2026 13:52:25 EST").toISOString());
  });

  test("decodes CDATA and entities", () => {
    assert.equal(parseFeed(RSS)[1].title, "Ja'Marr Chase & the Bengals' offense");
  });

  test("reads Atom entries and href links", () => {
    const atom = `<feed><entry><title>Atom headline</title>
      <link rel="alternate" href="https://example.com/atom"/>
      <updated>2026-08-18T12:00:00Z</updated></entry></feed>`;
    const [entry] = parseFeed(atom);
    assert.equal(entry.title, "Atom headline");
    assert.equal(entry.link, "https://example.com/atom");
    assert.equal(entry.publishedAt, "2026-08-18T12:00:00.000Z");
  });

  test("returns nothing for junk rather than throwing", () => {
    assert.deepEqual(parseFeed("<html><body>not a feed</body></html>"), []);
    assert.deepEqual(parseFeed(""), []);
  });

  test("an unparseable date becomes null, not an invalid date", () => {
    const [entry] = parseFeed("<rss><item><title>T</title><pubDate>whenever</pubDate></item></rss>");
    assert.equal(entry.publishedAt, null);
  });
});

describe("matching", () => {
  test("prefers gsis_id but falls back to name and position", () => {
    const match = buildMatcher([
      { gsisId: "00-0036900", name: "Wrong Name Entirely", team: "CIN", position: "WR" },
      { gsisId: null, name: "Jahmyr Gibbs", team: "DET", position: "RB" },
    ]);

    // gsis_id wins even when the name disagrees: it is the authoritative key.
    assert.equal(match(PLAYERS[0])?.name, "Wrong Name Entirely");
    // Sleeper leaves gsis_id null for most active players; name+position covers them.
    assert.equal(match(PLAYERS[1])?.name, "Jahmyr Gibbs");
  });

  test("drops an ambiguous match instead of guessing", () => {
    const match = buildMatcher([
      { gsisId: null, name: "Michael Thomas", team: "NO", position: "WR" },
      { gsisId: null, name: "Michael Thomas", team: "NYJ", position: "WR" },
    ]);
    // Two same-name receivers, one on the player's team: the team separates them.
    assert.equal(match(PLAYERS[3])?.team, "NO");

    const unresolvable = buildMatcher([
      { gsisId: null, name: "Michael Thomas", team: "KC", position: "WR" },
      { gsisId: null, name: "Michael Thomas", team: "NYJ", position: "WR" },
    ]);
    // Neither is on his team — reporting either would be a coin flip.
    assert.equal(unresolvable(PLAYERS[3]), undefined);
  });

  test("does not match a player at a different position", () => {
    const match = buildMatcher([{ gsisId: null, name: "Jahmyr Gibbs", team: "DET", position: "WR" }]);
    assert.equal(match(PLAYERS[1]), undefined);
  });

  test("normalizes punctuation, case, suffixes and surname-first", () => {
    assert.equal(normalizeName("Ja'Marr Chase"), normalizeName("JaMarr Chase"));
    assert.equal(normalizeName("Marvin Harrison Jr."), normalizeName("Marvin Harrison"));
    assert.equal(normalizeName("Chase, Ja'Marr"), normalizeName("Ja'Marr Chase"));
  });

  test("tags a headline only on a full-name match", () => {
    assert.deepEqual(
      playersMentioned("Puka Nacua limited in practice", PLAYERS).map((p) => p.name),
      ["Puka Nacua"],
    );
    // A surname alone must not tag a player: too many share one.
    assert.deepEqual(playersMentioned("Chase traded to the Jets", PLAYERS), []);
    assert.deepEqual(playersMentioned("Generic league news", PLAYERS), []);
  });
});

describe("refreshLive", () => {
  const injuryPayload = JSON.stringify({
    a: { full_name: "Puka Nacua", position: "WR", team: "LAR", status: "Active", injury_status: "Questionable", injury_body_part: "Knee", gsis_id: null },
    b: { full_name: "Ja'Marr Chase", position: "WR", team: "CIN", status: "Active", injury_status: "NA", gsis_id: null },
    c: { full_name: "Jahmyr Gibbs", position: "RB", team: "DET", status: "Injured Reserve", injury_status: null, gsis_id: null },
    d: { full_name: "Some Lineman", position: "OT", team: "DET", status: "Active", gsis_id: null },
  });

  const depthCsv = [
    "dt,team,player_name,espn_id,gsis_id,pos_grp,pos_abb,pos_slot,pos_rank",
    "2026-08-18T07:00:00Z,LAR,Puka Nacua,1,,Offense,WR,1,1",
    "2026-08-18T07:00:00Z,DET,Some Lineman,2,,Offense,LT,1,1",
  ].join("\n");

  function stubFetch(handlers: Record<string, () => Promise<Response> | Response>): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(handlers).find((candidate) => url.includes(candidate));
      if (!key) throw new Error(`unexpected request: ${url}`);
      return handlers[key]();
    }) as typeof fetch;
  }

  const ok = (body: string, type: string) =>
    new Response(body, { status: 200, headers: { "content-type": type } });

  test("writes a cache and reports each source", async () => {
    const dir = await scratch();
    const { cache, status } = await refreshLive(dir, {
      fetchImpl: stubFetch({
        "sleeper.app": () => ok(injuryPayload, "application/json"),
        "nflverse-data": () => ok(depthCsv, "text/csv"),
        "espn.com": () => ok(RSS, "text/xml"),
        "cbssports.com": () => ok(RSS, "text/xml"),
        "nbcsports.com": () => ok(RSS, "text/xml"),
        "yahoo.com": () => ok(RSS, "text/xml"),
      }),
    });

    assert.ok(cache);
    assert.equal(status.stale, false);
    assert.equal(status.sources.length, 6);
    assert.ok(status.sources.every((source) => source.ok));

    // Linemen are kept (normalised to OL, for the O-Line center); everything
    // else off the board is dropped before it reaches the cache.
    assert.ok(cache!.injuries.some((record) => record.position === "OL"));
    assert.ok(!cache!.injuries.some((record) => record.position === "OT"));
    assert.equal(cache!.depthCharts?.length, 2);
    // The same story from four feeds collapses to one headline.
    assert.equal(cache!.headlines.length, 2);

    const written = JSON.parse(await readFile(path.join(dir, "cache", "live.json"), "utf8"));
    assert.equal(written.injuries.length, cache!.injuries.length);
  });

  test("a failing feed does not stop the others, and marks the result stale", async () => {
    const dir = await scratch();
    const { cache, status } = await refreshLive(dir, {
      fetchImpl: stubFetch({
        "sleeper.app": () => ok(injuryPayload, "application/json"),
        "nflverse-data": () => ok(depthCsv, "text/csv"),
        "espn.com": () => ok(RSS, "text/xml"),
        "cbssports.com": () => new Response("nope", { status: 503, statusText: "Service Unavailable" }),
        "nbcsports.com": () => { throw new Error("network down"); },
        "yahoo.com": () => ok(RSS, "text/xml"),
      }),
    });

    assert.ok(cache);
    assert.equal(status.stale, true, "a partial failure must be reported as stale");
    const failed = status.sources.filter((source) => !source.ok);
    assert.equal(failed.length, 2);
    assert.match(failed[0].detail, /503/);
    // The feeds that worked still landed.
    assert.equal(cache!.headlines.length, 2);
  });

  test("keeps the previous cache when everything fails, and says so", async () => {
    const dir = await scratch();
    const good = stubFetch({
      "sleeper.app": () => ok(injuryPayload, "application/json"),
      "nflverse-data": () => ok(depthCsv, "text/csv"),
      "espn.com": () => ok(RSS, "text/xml"),
      "cbssports.com": () => ok(RSS, "text/xml"),
      "nbcsports.com": () => ok(RSS, "text/xml"),
      "yahoo.com": () => ok(RSS, "text/xml"),
    });
    const first = await refreshLive(dir, { fetchImpl: good });
    assert.ok(first.cache);

    const offline = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const second = await refreshLive(dir, { fetchImpl: offline });

    // The board keeps working offline, on the last good data...
    assert.equal(second.cache?.fetchedAt, first.cache!.fetchedAt);
    assert.equal(second.cache?.headlines.length, first.cache!.headlines.length);
    // ...but is explicitly flagged as not current.
    assert.equal(second.status.stale, true);
    assert.equal(second.status.fetchedAt, first.status.fetchedAt);
    assert.notEqual(second.status.attemptedAt, first.status.attemptedAt);
    assert.ok(second.status.sources.every((source) => !source.ok));

    const persisted = await readLiveStatus(dir);
    assert.equal(persisted.stale, true);
  });

  test("status is empty, not stale, before anything has been fetched", async () => {
    const dir = await scratch();
    const status = await readLiveStatus(dir);
    assert.equal(status.fetchedAt, null);
    assert.equal(status.stale, false);
  });
});

describe("shaping", () => {
  const cache: LiveCache = {
    fetchedAt: "2026-08-18T12:00:00.000Z",
    injuries: [
      { gsisId: null, name: "Puka Nacua", team: "LAR", position: "WR", rosterStatus: "Active", designation: "Questionable", bodyPart: "Knee" },
      { gsisId: null, name: "Ja'Marr Chase", team: "CIN", position: "WR", rosterStatus: "Active", designation: null, bodyPart: null },
      { gsisId: null, name: "Jahmyr Gibbs", team: "DET", position: "RB", rosterStatus: "Injured Reserve", designation: null, bodyPart: null },
    ],
    headlines: [
      { source: "ESPN NFL", title: "Puka Nacua limited in practice", link: "https://example.com/a", author: null, publishedAt: "2026-08-18T11:00:00.000Z" },
      { source: "ESPN NFL", title: "League expands playoff format", link: "https://example.com/b", author: null, publishedAt: "2026-08-18T10:00:00.000Z" },
    ],
  };

  test("maps designations and roster status onto players", () => {
    const injuries = injuriesByPlayer(cache, PLAYERS);
    assert.equal(injuries.get("00-0039075")?.status, "Questionable");
    assert.equal(injuries.get("00-0039075")?.bodyPart, "Knee");
    assert.equal(injuries.get("00-0036900")?.status, "Active");
    assert.equal(injuries.get("00-0039139")?.status, "Injured Reserve");
    // Not in the source at all: absent, rather than assumed healthy.
    assert.equal(injuries.has("00-0000001"), false);
  });

  test("tags news with the player it names and their current status", () => {
    const injuries = injuriesByPlayer(cache, PLAYERS);
    const items = newsItems(cache, PLAYERS, injuries);

    assert.equal(items[0].playerName, "Puka Nacua");
    assert.equal(items[0].status, "Questionable");
    assert.equal(items[0].url, "https://example.com/a");
    // A general headline stays untagged rather than being forced onto someone.
    assert.equal(items[1].playerId, null);
  });

  test("no cache means no news and no injuries, not invented ones", () => {
    assert.deepEqual(newsItems(null, PLAYERS, new Map()), []);
    assert.equal(injuriesByPlayer(null, PLAYERS).size, 0);
  });
});
