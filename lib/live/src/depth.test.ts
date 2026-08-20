import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchDepthCharts } from "./sources.ts";
import { depthByPlayer, offensiveLine, type LiveCache } from "./index.ts";

const csv = [
  "dt,team,player_name,espn_id,gsis_id,pos_grp_id,pos_grp,pos_id,pos_name,pos_abb,pos_slot,pos_rank",
  // Newest snapshot
  "2026-08-18T07:00:00Z,SF,Christian McCaffrey,1,00-0033280,1,Offense,1,Running Back,RB,1,1",
  "2026-08-18T07:00:00Z,SF,Trent Williams,2,00-0027970,1,Offense,2,Left Tackle,LT,1,1",
  "2026-08-18T07:00:00Z,SF,Austen Pleasants,3,,1,Offense,2,Left Tackle,LT,1,2",
  "2026-08-18T07:00:00Z,SF,Spare Tackle,9,,1,Offense,2,Left Tackle,LT,1,3",
  "2026-08-18T07:00:00Z,SF,Jake Brendel,4,00-0033884,1,Offense,3,Center,C,1,1",
  "2026-08-18T07:00:00Z,SF,Deebo Samuel,5,00-0035216,1,Offense,4,Wide Receiver,WR,2,2",
  "2026-08-18T07:00:00Z,SF,Fred Warner,6,00-0034827,2,Defense,5,Linebacker,MLB,1,1",
  // Older snapshot that must be ignored
  "2026-08-17T07:00:00Z,SF,Christian McCaffrey,1,00-0033280,1,Offense,1,Running Back,RB,1,2",
].join("\n");

function fakeFetch(body: string, status = 206) {
  return (async () =>
    new Response(body, { status, headers: { "content-type": "text/csv" } })) as typeof fetch;
}

test("parses only the newest snapshot and keeps offense slots", async () => {
  const records = await fetchDepthCharts({ fetchImpl: fakeFetch(csv) });
  assert.equal(records.length, 6); // Warner (defense) and the old snapshot are gone
  assert.ok(records.every((record) => record.team === "SF"));
  const cmc = records.find((record) => record.name === "Christian McCaffrey");
  assert.deepEqual({ slot: cmc?.slot, rank: cmc?.rank }, { slot: "RB", rank: 1 });
});

test("a ranged response ending mid-row drops the partial line", async () => {
  const truncated = csv.slice(0, csv.lastIndexOf("2026-08-17") + 20);
  const records = await fetchDepthCharts({ fetchImpl: fakeFetch(truncated) });
  assert.equal(records.length, 6);
});

function cacheWith(depthCharts: LiveCache["depthCharts"]): LiveCache {
  return {
    fetchedAt: "2026-08-18T08:00:00Z",
    injuries: [
      {
        gsisId: null,
        name: "Trent Williams",
        team: "SF",
        position: "OL",
        rosterStatus: "Active",
        designation: "Questionable",
        bodyPart: "Ankle",
      },
    ],
    headlines: [],
    depthCharts,
  };
}

test("depthByPlayer joins by gsis id and by name+team, slot must match position", async () => {
  const records = await fetchDepthCharts({ fetchImpl: fakeFetch(csv) });
  const cache = cacheWith(records);
  const depth = depthByPlayer(cache, [
    { id: "00-0033280", name: "Christian McCaffrey", team: "SF", position: "RB" },
    // No gsis match — falls back to name+team, and the WR slot agrees.
    { id: "xx-deebo", name: "Deebo Samuel", team: "SF", position: "WR" },
    // A quarterback named like a lineman must not inherit the LT rank.
    { id: "xx-fake", name: "Trent Williams", team: "SF", position: "QB" },
  ]);

  assert.equal(depth.get("00-0033280"), 1);
  assert.equal(depth.get("xx-deebo"), 2);
  assert.equal(depth.get("xx-fake"), undefined);
});

test("offensiveLine reads the line in order with injuries merged, depth 2 max", async () => {
  const records = await fetchDepthCharts({ fetchImpl: fakeFetch(csv) });
  const line = offensiveLine(cacheWith(records), "SF");

  assert.deepEqual(
    line.map((man) => `${man.slot}${man.rank} ${man.name}`),
    ["LT1 Trent Williams", "LT2 Austen Pleasants", "C1 Jake Brendel"],
  );
  assert.equal(line[0].injuryStatus, "Questionable");
  assert.equal(line[0].injuryBodyPart, "Ankle");
  assert.equal(line[1].injuryStatus, null);
});

test("no depth charts in the cache means empty results, not errors", () => {
  const cache = cacheWith(undefined);
  assert.equal(depthByPlayer(cache, []).size, 0);
  assert.deepEqual(offensiveLine(cache, "SF"), []);
  assert.deepEqual(offensiveLine(null, "SF"), []);
});
