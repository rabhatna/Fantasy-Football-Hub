/**
 * The market cache: consensus ADP, season projections, auction values.
 *
 * Same shape of contract as the live injury/news cache, kept in a separate
 * file because it moves on a different cadence (market numbers change daily,
 * headlines hourly): fetched only on explicit refresh, sources fail
 * independently, a failed source keeps its previously cached records, writes
 * are atomic, and reads never touch the network.
 */

import path from "node:path";
import { readFileOrNull, writeFileAtomic } from "@workspace/store";
import {
  fetchEspnMarket,
  fetchFfcAdp,
  fetchSleeperMarket,
  type AdpRecord,
  type AuctionRecord,
  type ProjectionRecord,
} from "./market-sources.ts";
import type { FetchOptions } from "./sources.ts";
import type { LiveStatus, SourceResult } from "./index.ts";
import { buildMatcher, type MatchablePlayer } from "./match.ts";

export interface MarketCache {
  fetchedAt: string;
  adp: {
    ffc: AdpRecord[];
    sleeper: AdpRecord[];
    espn: AdpRecord[];
  };
  projections: {
    sleeper: ProjectionRecord[];
  };
  auction: {
    espn: AuctionRecord[];
  };
}

const EMPTY_STATUS: LiveStatus = {
  fetchedAt: null,
  attemptedAt: null,
  stale: false,
  sources: [],
};

function cachePath(dataDir: string): string {
  return path.join(dataDir, "cache", "market.json");
}

function statusPath(dataDir: string): string {
  return path.join(dataDir, "cache", "market-status.json");
}

async function readJson<T>(file: string): Promise<T | null> {
  const text = await readFileOrNull(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function readMarketCache(dataDir: string): Promise<MarketCache | null> {
  return readJson<MarketCache>(cachePath(dataDir));
}

export async function readMarketStatus(dataDir: string): Promise<LiveStatus> {
  return (await readJson<LiveStatus>(statusPath(dataDir))) ?? EMPTY_STATUS;
}

export interface MarketRefreshOptions extends FetchOptions {
  /** League size, so FFC's ADP reflects the room being drafted in. */
  teams?: number;
  year?: number;
}

/**
 * Fetch every market source, then write the cache. Called only from the
 * explicit refresh path — never from a read.
 */
export async function refreshMarket(
  dataDir: string,
  options: MarketRefreshOptions = {},
): Promise<{ cache: MarketCache | null; status: LiveStatus }> {
  const { teams = 12, year = 2026, ...fetchOptions } = options;
  const attemptedAt = new Date().toISOString();
  const previous = await readMarketCache(dataDir);
  const sources: SourceResult[] = [];

  const [ffc, sleeper, espn] = await Promise.all([
    fetchFfcAdp(teams, year, fetchOptions).then(
      (records) => ({ ok: true as const, records }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    fetchSleeperMarket(year, fetchOptions).then(
      (records) => ({ ok: true as const, records }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    fetchEspnMarket(year, fetchOptions).then(
      (records) => ({ ok: true as const, records }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);

  const next: MarketCache = {
    fetchedAt: attemptedAt,
    adp: {
      ffc: previous?.adp.ffc ?? [],
      sleeper: previous?.adp.sleeper ?? [],
      espn: previous?.adp.espn ?? [],
    },
    projections: { sleeper: previous?.projections.sleeper ?? [] },
    auction: { espn: previous?.auction.espn ?? [] },
  };

  if (ffc.ok) {
    next.adp.ffc = ffc.records;
    sources.push({
      name: "FFC ADP",
      ok: true,
      detail: `${ffc.records.length} players from live PPR mocks`,
    });
  } else {
    sources.push({ name: "FFC ADP", ok: false, detail: describeError(ffc.error) });
  }

  if (sleeper.ok) {
    next.adp.sleeper = sleeper.records.adp;
    next.projections.sleeper = sleeper.records.projections;
    sources.push({
      name: "Sleeper projections",
      ok: true,
      detail: `${sleeper.records.projections.length} projections, ${sleeper.records.adp.length} with ADP`,
    });
  } else {
    sources.push({ name: "Sleeper projections", ok: false, detail: describeError(sleeper.error) });
  }

  if (espn.ok) {
    next.adp.espn = espn.records.adp;
    next.auction.espn = espn.records.auction;
    sources.push({
      name: "ESPN market values",
      ok: true,
      detail: `${espn.records.auction.length} auction values, ${espn.records.adp.length} with ADP`,
    });
  } else {
    sources.push({ name: "ESPN market values", ok: false, detail: describeError(espn.error) });
  }

  const anythingArrived = ffc.ok || sleeper.ok || espn.ok;
  const cache = anythingArrived ? next : previous;
  if (anythingArrived) {
    await writeFileAtomic(cachePath(dataDir), JSON.stringify(cache, null, 2));
  }

  const status: LiveStatus = {
    fetchedAt: cache?.fetchedAt ?? null,
    attemptedAt,
    stale: sources.some((source) => !source.ok),
    sources,
  };

  await writeFileAtomic(statusPath(dataDir), JSON.stringify(status, null, 2));
  return { cache, status };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "timed out";
    if (error.name === "AbortError") return "aborted";
    return error.message;
  }
  return String(error);
}

// ── Shaping cached data for the API ──────────────────────────────────────────

export interface AdpSourceValue {
  source: string;
  adp: number;
}

export interface PlayerMarket {
  /** Per-source ADP for this player, from the market cache only. */
  adpSources: AdpSourceValue[];
  /** FFC's pick spread, the only source that reports one. */
  adpStdev: number | null;
  projection: {
    ppr: number | null;
    halfPpr: number | null;
    standard: number | null;
  } | null;
  aav: number | null;
}

/**
 * Match every cached market record to the ranked players.
 *
 * Sources carry no shared ids, so this rides the same name+position matcher
 * as injuries: an ambiguous match is dropped, never guessed. Consensus is not
 * computed here — the caller folds in the dataset's own ADP first.
 */
export function marketByPlayer(
  cache: MarketCache | null,
  players: readonly MatchablePlayer[],
): Map<string, PlayerMarket> {
  const result = new Map<string, PlayerMarket>();
  if (!cache) return result;

  const adpMatchers = [
    { source: "ffc", match: buildMatcher(cache.adp.ffc) },
    { source: "sleeper", match: buildMatcher(cache.adp.sleeper) },
    { source: "espn", match: buildMatcher(cache.adp.espn) },
  ];
  const projectionMatch = buildMatcher(cache.projections.sleeper);
  const auctionMatch = buildMatcher(cache.auction.espn);

  for (const player of players) {
    const adpSources: AdpSourceValue[] = [];
    let adpStdev: number | null = null;
    for (const { source, match } of adpMatchers) {
      const record = match(player);
      if (!record) continue;
      adpSources.push({ source, adp: record.adp });
      adpStdev ??= record.stdev;
    }

    const projection = projectionMatch(player);
    const auction = auctionMatch(player);

    if (adpSources.length === 0 && !projection && !auction) continue;
    result.set(player.id, {
      adpSources,
      adpStdev,
      projection: projection
        ? {
            ppr: projection.pointsPpr,
            halfPpr: projection.pointsHalfPpr,
            standard: projection.pointsStandard,
          }
        : null,
      aav: auction?.aav ?? null,
    });
  }

  return result;
}

/** Mean and spread across ADP sources; null when there are none. */
export function consensusAdp(values: readonly number[]): {
  mean: number | null;
  stdev: number | null;
} {
  if (values.length === 0) return { mean: null, stdev: null };
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (values.length === 1) return { mean, stdev: null };
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, stdev: Math.sqrt(variance) };
}
