import path from "node:path";
import { readFileOrNull, writeFileAtomic } from "@workspace/store";
import {
  fetchDepthCharts,
  fetchFeed,
  fetchInjuries,
  NEWS_FEEDS,
  OL_SLOTS,
  type DepthChartRecord,
  type FetchOptions,
  type HeadlineRecord,
  type InjuryRecord,
} from "./sources.ts";
import { buildMatcher, normalizeName, playersMentioned, type MatchablePlayer } from "./match.ts";

export { parseFeed, type FeedEntry } from "./rss.ts";
export { buildMatcher, normalizeName, playersMentioned, type MatchablePlayer } from "./match.ts";
export {
  DEPTH_CHARTS_URL,
  fetchDepthCharts,
  fetchFeed,
  fetchInjuries,
  NEWS_FEEDS,
  OL_SLOTS,
  SLEEPER_PLAYERS_URL,
  type DepthChartRecord,
  type HeadlineRecord,
  type InjuryRecord,
} from "./sources.ts";
export {
  consensusAdp,
  marketByPlayer,
  readMarketCache,
  readMarketStatus,
  refreshMarket,
  type AdpSourceValue,
  type MarketCache,
  type MarketRefreshOptions,
  type PlayerMarket,
} from "./market.ts";
export {
  fetchEspnMarket,
  fetchFfcAdp,
  fetchSleeperMarket,
  type AdpRecord,
  type AuctionRecord,
  type ProjectionRecord,
} from "./market-sources.ts";

/** Outcome of one source in a refresh. */
export interface SourceResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LiveCache {
  /** When the cache was last successfully written. */
  fetchedAt: string;
  injuries: InjuryRecord[];
  headlines: HeadlineRecord[];
  /** Absent in caches written before depth charts existed. */
  depthCharts?: DepthChartRecord[];
}

export interface LiveStatus {
  /** When the cached data was fetched, or null if it never has been. */
  fetchedAt: string | null;
  /** When a refresh was last attempted, successful or not. */
  attemptedAt: string | null;
  /**
   * True when the last attempt failed and what is being served came from an
   * earlier fetch. The UI must say so rather than presenting it as current.
   */
  stale: boolean;
  sources: SourceResult[];
}

const EMPTY_STATUS: LiveStatus = {
  fetchedAt: null,
  attemptedAt: null,
  stale: false,
  sources: [],
};

function cachePath(dataDir: string): string {
  return path.join(dataDir, "cache", "live.json");
}

function statusPath(dataDir: string): string {
  return path.join(dataDir, "cache", "live-status.json");
}

async function readJson<T>(file: string): Promise<T | null> {
  const text = await readFileOrNull(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // A corrupt cache is a reason to refetch, not to fail.
    return null;
  }
}

export async function readLiveCache(dataDir: string): Promise<LiveCache | null> {
  return readJson<LiveCache>(cachePath(dataDir));
}

export async function readLiveStatus(dataDir: string): Promise<LiveStatus> {
  return (await readJson<LiveStatus>(statusPath(dataDir))) ?? EMPTY_STATUS;
}

/**
 * Fetch every live source, then write the cache.
 *
 * Sources are fetched concurrently and independently: one feed being down must
 * not cost the others. The cache is only replaced by data that actually
 * arrived — a failed source keeps its previous contents rather than being
 * blanked, and the status records the failure so the UI can say what is stale.
 *
 * Nothing here runs on its own. It is called only when the user asks for a
 * refresh, so no request leaves the machine unprompted.
 */
export async function refreshLive(
  dataDir: string,
  options: FetchOptions = {},
): Promise<{ cache: LiveCache | null; status: LiveStatus }> {
  const attemptedAt = new Date().toISOString();
  const previous = await readLiveCache(dataDir);
  const sources: SourceResult[] = [];

  const [injuryOutcome, depthOutcome, ...feedOutcomes] = await Promise.all([
    fetchInjuries(options).then(
      (records) => ({ ok: true as const, records }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    fetchDepthCharts(options).then(
      (records) => ({ ok: true as const, records }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    ...NEWS_FEEDS.map((feed) =>
      fetchFeed(feed, options).then(
        (records) => ({ ok: true as const, feed, records }),
        (error: unknown) => ({ ok: false as const, feed, error }),
      ),
    ),
  ]);

  let injuries = previous?.injuries ?? [];
  if (injuryOutcome.ok) {
    injuries = injuryOutcome.records;
    const designated = injuries.filter((record) => record.designation).length;
    sources.push({
      name: "Sleeper injury designations",
      ok: true,
      detail: `${injuries.length} players, ${designated} carrying a designation`,
    });
  } else {
    sources.push({
      name: "Sleeper injury designations",
      ok: false,
      detail: describeError(injuryOutcome.error),
    });
  }

  let depthCharts = previous?.depthCharts ?? [];
  if (depthOutcome.ok) {
    depthCharts = depthOutcome.records;
    const teams = new Set(depthCharts.map((record) => record.team)).size;
    sources.push({
      name: "ESPN depth charts",
      ok: true,
      detail: `${depthCharts.length} entries across ${teams} teams (via nflverse)`,
    });
  } else {
    sources.push({
      name: "ESPN depth charts",
      ok: false,
      detail: describeError(depthOutcome.error),
    });
  }

  const headlines: HeadlineRecord[] = [];
  let anyFeedOk = false;
  for (const outcome of feedOutcomes) {
    if (outcome.ok) {
      anyFeedOk = true;
      headlines.push(...outcome.records);
      sources.push({
        name: outcome.feed.name,
        ok: true,
        detail: `${outcome.records.length} headlines`,
      });
    } else {
      sources.push({
        name: outcome.feed.name,
        ok: false,
        detail: describeError(outcome.error),
      });
    }
  }

  // If every feed failed, keep the headlines already cached rather than
  // replacing a working feed with an empty one.
  const mergedHeadlines = anyFeedOk ? dedupeHeadlines(headlines) : (previous?.headlines ?? []);
  const anythingArrived = injuryOutcome.ok || depthOutcome.ok || anyFeedOk;

  const cache: LiveCache | null = anythingArrived
    ? {
        fetchedAt: attemptedAt,
        injuries,
        headlines: mergedHeadlines,
        depthCharts,
      }
    : previous;

  if (anythingArrived) {
    await writeFileAtomic(cachePath(dataDir), JSON.stringify(cache, null, 2));
  }

  const status: LiveStatus = {
    fetchedAt: cache?.fetchedAt ?? null,
    attemptedAt,
    // Stale whenever any source failed: some of what is on screen is older
    // than this attempt, and the UI should not imply otherwise.
    stale: sources.some((source) => !source.ok),
    sources,
  };

  await writeFileAtomic(statusPath(dataDir), JSON.stringify(status, null, 2));
  return { cache, status };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // A timeout arrives as a DOMException named TimeoutError; say so plainly.
    if (error.name === "TimeoutError") return "timed out";
    if (error.name === "AbortError") return "aborted";
    return error.message;
  }
  return String(error);
}

/** Several outlets carry the same wire story; keep the first of each headline. */
function dedupeHeadlines(headlines: readonly HeadlineRecord[]): HeadlineRecord[] {
  const seen = new Set<string>();
  const unique: HeadlineRecord[] = [];

  for (const headline of headlines) {
    const key = headline.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(headline);
  }

  return unique.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

// ── Shaping cached data for the API ──────────────────────────────────────────

export interface PlayerInjury {
  status: string;
  designation: string | null;
  bodyPart: string | null;
}

/**
 * Map each ranked player to a live availability status.
 *
 * A player Sleeper has no record of is left out entirely rather than assumed
 * healthy — absence of a designation is not evidence of one.
 */
export function injuriesByPlayer(
  cache: LiveCache | null,
  players: readonly MatchablePlayer[],
): Map<string, PlayerInjury> {
  const result = new Map<string, PlayerInjury>();
  if (!cache) return result;

  const match = buildMatcher(cache.injuries);

  for (const player of players) {
    const record = match(player);
    if (!record) continue;

    // A game-status designation is the more specific signal; fall back to the
    // roster status, which is what says someone is on injured reserve.
    const status =
      record.designation ??
      (record.rosterStatus && record.rosterStatus !== "Active"
        ? record.rosterStatus
        : record.rosterStatus === "Active"
          ? "Active"
          : null);

    if (!status) continue;
    result.set(player.id, {
      status,
      designation: record.designation,
      bodyPart: record.bodyPart,
    });
  }

  return result;
}

/**
 * Map each ranked player to his depth-chart standing.
 *
 * Joins by gsis_id first (nflverse carries it for most), then by normalised
 * name + team + matching slot. The slot must agree with the player's fantasy
 * position so a name collision across positions cannot produce a rank.
 */
export function depthByPlayer(
  cache: LiveCache | null,
  players: readonly MatchablePlayer[],
): Map<string, number> {
  const result = new Map<string, number>();
  const records = cache?.depthCharts;
  if (!records || records.length === 0) return result;

  const byGsis = new Map(records.filter((r) => r.gsisId).map((r) => [r.gsisId as string, r]));
  const byNameTeam = new Map<string, DepthChartRecord[]>();
  for (const record of records) {
    const key = `${normalizeName(record.name)}|${record.team}`;
    const bucket = byNameTeam.get(key);
    if (bucket) bucket.push(record);
    else byNameTeam.set(key, [record]);
  }

  for (const player of players) {
    const record =
      byGsis.get(player.id) ??
      byNameTeam
        .get(`${normalizeName(player.name)}|${player.team}`)
        ?.find((candidate) => candidate.slot === player.position);
    if (record && record.slot === player.position) result.set(player.id, record.rank);
  }

  return result;
}

export interface LinemanShape {
  slot: string;
  rank: number;
  name: string;
  injuryStatus: string | null;
  injuryBodyPart: string | null;
}

/**
 * A team's offensive line, read left to right, with availability merged from
 * the injury feed. Depth 1 and 2 per slot — the starter and the swing man.
 */
export function offensiveLine(cache: LiveCache | null, team: string): LinemanShape[] {
  const records = cache?.depthCharts;
  if (!records) return [];

  const injuriesByName = new Map<string, InjuryRecord>();
  for (const record of cache?.injuries ?? []) {
    if (record.position !== "OL" || record.team !== team) continue;
    injuriesByName.set(normalizeName(record.name), record);
  }

  const line: LinemanShape[] = [];
  for (const slot of OL_SLOTS) {
    const slotRecords = records
      .filter((record) => record.team === team && record.slot === slot && record.rank <= 2)
      .sort((a, b) => a.rank - b.rank);
    for (const record of slotRecords) {
      const injury = injuriesByName.get(normalizeName(record.name));
      line.push({
        slot,
        rank: record.rank,
        name: record.name,
        injuryStatus:
          injury?.designation ??
          (injury?.rosterStatus && injury.rosterStatus !== "Active" ? injury.rosterStatus : null),
        injuryBodyPart: injury?.bodyPart ?? null,
      });
    }
  }

  return line;
}

export interface NewsItemShape {
  id: string;
  source: string;
  author: string | null;
  headline: string;
  url: string | null;
  timestamp: string | null;
  playerId: string | null;
  playerName: string | null;
  status: string | null;
}

/** Turn cached headlines into API news items, tagged with any player named. */
export function newsItems(
  cache: LiveCache | null,
  players: readonly MatchablePlayer[],
  injuries: Map<string, PlayerInjury>,
  limit = 60,
): NewsItemShape[] {
  if (!cache) return [];

  return cache.headlines.slice(0, limit).map((headline, index) => {
    const mentioned = playersMentioned(headline.title, players);
    const player = mentioned.length === 1 ? mentioned[0] : null;

    return {
      id: `news-${index}-${hash(headline.title)}`,
      source: headline.source,
      author: headline.author,
      headline: headline.title,
      url: headline.link,
      timestamp: headline.publishedAt,
      playerId: player?.id ?? null,
      playerName: player?.name ?? null,
      status: player ? (injuries.get(player.id)?.status ?? null) : null,
    };
  });
}

function hash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = (Math.imul(31, result) + value.charCodeAt(index)) | 0;
  }
  return (result >>> 0).toString(36);
}
