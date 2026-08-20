import { parseCsv } from "@workspace/store";
import { parseFeed, type FeedEntry } from "./rss.ts";

/**
 * Live sources, all free and unauthenticated.
 *
 * The original brief asked for beat-writer accounts on X. There is no free,
 * unauthenticated way to read those any more, so this uses public NFL news
 * feeds instead — every URL here was checked to respond with parseable RSS
 * before it was added.
 */
export const NEWS_FEEDS: readonly { name: string; url: string }[] = [
  { name: "ESPN NFL", url: "https://www.espn.com/espn/rss/nfl/news" },
  { name: "CBS Sports NFL", url: "https://www.cbssports.com/rss/headlines/nfl/" },
  { name: "ProFootballTalk", url: "https://profootballtalk.nbcsports.com/feed/" },
  { name: "Yahoo Sports NFL", url: "https://sports.yahoo.com/nfl/rss.xml" },
];

export const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

export const DEPTH_CHARTS_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_2026.csv";

/** Identifies this app to the services it reads, rather than posing as a browser. */
const USER_AGENT = "TheDraftRoom/1.0 (local fantasy draft tool)";

export interface FetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function get(url: string, { timeoutMs = 20_000, fetchImpl = fetch }: FetchOptions = {}) {
  const response = await fetchImpl(url, {
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
    redirect: "follow", // ProFootballTalk and Yahoo both 301 to their canonical host
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response;
}

// ── Injuries (Sleeper) ───────────────────────────────────────────────────────

export interface InjuryRecord {
  gsisId: string | null;
  name: string;
  team: string | null;
  position: string | null;
  /** Roster status: Active, Inactive, Injured Reserve, ... */
  rosterStatus: string | null;
  /** Game-status designation: Questionable, Doubtful, Out, IR, PUP, ... */
  designation: string | null;
  bodyPart: string | null;
}

/** Sleeper writes "NA" where a player simply has no designation. */
function cleanDesignation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toUpperCase() === "NA") return null;

  // Expand the abbreviations Sleeper uses so the UI never shows a code the
  // user has to decipher.
  const expanded: Record<string, string> = {
    IR: "IR",
    PUP: "PUP",
    Sus: "Suspended",
    COV: "COVID-19",
    DNR: "Did Not Report",
    NFI: "Non-Football Injury",
  };
  return expanded[trimmed] ?? trimmed;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Fetch every NFL player Sleeper knows about.
 *
 * This is a ~15 MB response covering 12,000 players — the whole point of
 * caching it to disk and only refetching when the user asks.
 */
export async function fetchInjuries(options?: FetchOptions): Promise<InjuryRecord[]> {
  const response = await get(SLEEPER_PLAYERS_URL, options);
  const payload: unknown = await response.json();

  if (!payload || typeof payload !== "object") {
    throw new Error("Sleeper returned an unexpected payload");
  }

  const records: InjuryRecord[] = [];
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const player = value as Record<string, unknown>;

    const name =
      str(player["full_name"]) ??
      [str(player["first_name"]), str(player["last_name"])].filter(Boolean).join(" ");
    if (!name) continue;

    // Skill positions are on the board, and offensive linemen matter to the
    // O-Line center's health view; skip the other ~8,500 records rather than
    // carrying them into the cache. Sleeper labels linemen inconsistently
    // (OL/OT/T/G/C), so they are normalised to one position here.
    const rawPosition = str(player["position"]);
    if (!rawPosition) continue;
    const position = ["OL", "OT", "T", "G", "C", "OG"].includes(rawPosition) ? "OL" : rawPosition;
    if (!["QB", "RB", "WR", "TE", "OL"].includes(position)) continue;

    records.push({
      gsisId: str(player["gsis_id"]),
      name,
      team: str(player["team"]),
      position,
      rosterStatus: str(player["status"]),
      designation: cleanDesignation(player["injury_status"]),
      bodyPart: str(player["injury_body_part"]),
    });
  }

  if (records.length === 0) {
    throw new Error("Sleeper returned no usable player records");
  }
  return records;
}

// ── Depth charts (ESPN, via nflverse) ────────────────────────────────────────

/** One depth-chart entry: where a player sits in his team's pecking order. */
export interface DepthChartRecord {
  team: string;
  name: string;
  gsisId: string | null;
  /** ESPN position slot: QB, RB, WR, TE, FB, LT, LG, C, RG, RT. */
  slot: string;
  /** 1 = the starter (for WRs, the overall WR pecking order across slots). */
  rank: number;
  /** null on the source side; present to satisfy the shared matcher shape. */
  position: string | null;
}

/** The depth positions the app cares about: the skill spots plus the line. */
const DEPTH_SLOTS = new Set(["QB", "RB", "WR", "TE", "FB", "LT", "LG", "C", "RG", "RT"]);

/** Line slots, in the order a line is read left to right. */
export const OL_SLOTS = ["LT", "LG", "C", "RG", "RT"] as const;

/**
 * ESPN's team depth charts, republished daily by nflverse as one CSV keyed by
 * gsis_id (so board players join without name matching).
 *
 * The file carries every daily snapshot, newest first, and the host honours
 * range requests — so this reads only the first ~¾ MB and keeps the rows from
 * the newest snapshot, rather than downloading 40+ MB of history. If the host
 * ignores the range header the whole file arrives and the same filter applies.
 */
export async function fetchDepthCharts(options?: FetchOptions): Promise<DepthChartRecord[]> {
  const { timeoutMs = 20_000, fetchImpl = fetch } = options ?? {};
  const response = await fetchImpl(DEPTH_CHARTS_URL, {
    headers: { "user-agent": USER_AGENT, accept: "text/csv", range: "bytes=0-786431" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  // A ranged read (206) almost certainly ends mid-row; drop the partial line.
  // A full read (200) is complete as-is.
  const complete = response.status === 206 ? text.slice(0, text.lastIndexOf("\n") + 1) : text;
  const rows = parseCsv(complete);
  if (rows.length === 0) throw new Error("depth chart file was empty");

  const latest = rows[0]["dt"];
  if (!latest) throw new Error("depth chart file had no snapshot date");

  const records: DepthChartRecord[] = [];
  for (const row of rows) {
    if (row["dt"] !== latest) break; // snapshots are newest-first
    const slot = row["pos_abb"] ?? "";
    if (!DEPTH_SLOTS.has(slot)) continue;
    const rank = Number(row["pos_rank"]);
    const name = row["player_name"]?.trim();
    const team = row["team"]?.trim();
    if (!name || !team || !Number.isFinite(rank)) continue;

    records.push({
      team,
      name,
      gsisId: str(row["gsis_id"]),
      slot,
      rank,
      position: null,
    });
  }

  if (records.length === 0) {
    throw new Error("depth chart snapshot contained no usable rows");
  }
  return records;
}

// ── Headlines (RSS) ──────────────────────────────────────────────────────────

export interface HeadlineRecord extends FeedEntry {
  source: string;
}

export async function fetchFeed(
  feed: { name: string; url: string },
  options?: FetchOptions,
): Promise<HeadlineRecord[]> {
  const response = await get(feed.url, options);
  const xml = await response.text();
  const entries = parseFeed(xml);

  if (entries.length === 0) {
    throw new Error("feed contained no entries");
  }
  return entries.map((entry) => ({ ...entry, source: feed.name }));
}
