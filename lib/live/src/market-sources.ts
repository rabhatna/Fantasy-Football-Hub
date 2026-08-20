/**
 * Market data sources: ADP, season projections, and auction values.
 *
 * All free and unauthenticated, fetched only on an explicit refresh:
 *
 * - Fantasy Football Calculator's REST API serves ADP from their live mock
 *   drafts (documented and offered for reuse; attribution required, data
 *   updates daily).
 * - Sleeper's projections endpoint carries full-season point projections in
 *   all three scoring formats plus Sleeper's own ADP. Unofficial.
 * - ESPN's fantasy API carries crowd auction values and ESPN ADP. Unofficial.
 *
 * The unofficial endpoints may change shape or disappear; every parser here
 * treats a surprise as "this source failed" and never lets it take the others
 * down.
 */

import { parseCsv } from "@workspace/store";
import type { FetchOptions } from "./sources.ts";
import type { MatchableSource } from "./match.ts";

const USER_AGENT = "TheDraftRoom/1.0 (local fantasy draft tool)";

const BOARD_POSITIONS = ["QB", "RB", "WR", "TE"];

export interface AdpRecord extends MatchableSource {
  adp: number;
  /** Spread of the picks behind the average, when the source reports one. */
  stdev: number | null;
}

export interface ProjectionRecord extends MatchableSource {
  /** Projected 2026 season totals, by scoring format. */
  pointsPpr: number | null;
  pointsHalfPpr: number | null;
  pointsStandard: number | null;
}

export interface AuctionRecord extends MatchableSource {
  /** Average auction value, in league dollars. */
  aav: number;
}

async function getJson(
  url: string,
  { timeoutMs = 20_000, fetchImpl = fetch }: FetchOptions = {},
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Bring other sites' team codes in line with the dataset's nflverse codes. */
function normalizeTeam(team: string | null): string | null {
  if (!team) return null;
  const aliases: Record<string, string> = {
    WSH: "WAS",
    JAC: "JAX",
    OAK: "LV",
    SD: "LAC",
    STL: "LAR",
    LA: "LAR",
  };
  return aliases[team] ?? team;
}

// ── FantasyPros expert-consensus ranks (dynastyprocess mirror) ───────────────

export const ECR_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv";

export interface EcrRecord extends MatchableSource {
  /** Overall redraft expert-consensus rank. */
  ecr: number;
  /** Movement since the previous scrape; positive = rising. */
  rankDelta: number | null;
  scrapeDate: string | null;
}

/**
 * Live FantasyPros overall redraft ECR, via the freely mirrored dynastyprocess
 * export — the same feed the offline dataset build reads. This is what keeps
 * the board's rankings from ageing with the snapshot: the snapshot's 2025
 * production is final, but expert consensus keeps moving.
 */
export async function fetchEcr(options?: FetchOptions): Promise<EcrRecord[]> {
  const { timeoutMs = 20_000, fetchImpl = fetch } = options ?? {};
  const response = await fetchImpl(ECR_URL, {
    headers: { "user-agent": USER_AGENT, accept: "text/csv" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const rows = parseCsv(await response.text());

  const records: EcrRecord[] = [];
  for (const row of rows) {
    if (row["page_type"] !== "redraft-overall") continue;
    const position = str(row["pos"]);
    const name = str(row["player"]);
    const ecr = num(Number(row["ecr"]));
    if (!name || !position || ecr === null || !BOARD_POSITIONS.includes(position)) continue;

    const delta = Number(row["rank_delta"]);
    records.push({
      gsisId: null,
      name,
      team: normalizeTeam(str(row["tm"]) ?? str(row["team"])),
      position,
      ecr,
      rankDelta: Number.isFinite(delta) ? delta : null,
      scrapeDate: str(row["scrape_date"]),
    });
  }

  if (records.length === 0) {
    throw new Error("ECR export contained no overall redraft rows");
  }
  return records;
}

// ── Fantasy Football Calculator ──────────────────────────────────────────────

export function ffcAdpUrl(teams: number, year: number): string {
  return `https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=${teams}&year=${year}`;
}

/**
 * ADP from live PPR mock drafts. Free for reuse with attribution — the
 * dashboard credits FantasyFootballCalculator.com wherever this is shown.
 */
export async function fetchFfcAdp(
  teams: number,
  year: number,
  options?: FetchOptions,
): Promise<AdpRecord[]> {
  const payload = await getJson(ffcAdpUrl(teams, year), options);
  const players = (payload as { players?: unknown })?.players;
  if (!Array.isArray(players)) {
    throw new Error("FFC returned an unexpected payload");
  }

  const records: AdpRecord[] = [];
  for (const value of players) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const name = str(row["name"]);
    const position = str(row["position"]);
    const adp = num(row["adp"]);
    // Kickers and defenses are not on the board.
    if (!name || !position || adp === null || !BOARD_POSITIONS.includes(position)) continue;

    records.push({
      gsisId: null, // FFC has no cross-site ids
      name,
      team: normalizeTeam(str(row["team"])),
      position,
      adp,
      stdev: num(row["stdev"]),
    });
  }

  if (records.length === 0) {
    throw new Error("FFC returned no usable ADP records");
  }
  return records;
}

// ── Sleeper projections ──────────────────────────────────────────────────────

export function sleeperProjectionsUrl(year: number): string {
  const positions = BOARD_POSITIONS.map((position) => `position[]=${position}`).join("&");
  return `https://api.sleeper.com/projections/nfl/${year}?season_type=regular&${positions}&order_by=adp_ppr`;
}

/** Sleeper writes 999 where a player simply has no ADP. */
function sleeperAdp(value: unknown): number | null {
  const adp = num(value);
  return adp !== null && adp > 0 && adp < 999 ? adp : null;
}

/**
 * Season point projections (all three scoring formats) and Sleeper ADP, from
 * one payload. Each record embeds the player's name/team/position, so no
 * second lookup is needed to identify who a row is about.
 */
export async function fetchSleeperMarket(
  year: number,
  options?: FetchOptions,
): Promise<{ adp: AdpRecord[]; projections: ProjectionRecord[] }> {
  const payload = await getJson(sleeperProjectionsUrl(year), options);
  if (!Array.isArray(payload)) {
    throw new Error("Sleeper returned an unexpected payload");
  }

  const adp: AdpRecord[] = [];
  const projections: ProjectionRecord[] = [];

  for (const value of payload) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const player = (row["player"] ?? {}) as Record<string, unknown>;
    const stats = (row["stats"] ?? {}) as Record<string, unknown>;

    const name = [str(player["first_name"]), str(player["last_name"])].filter(Boolean).join(" ");
    const position = str(player["position"]);
    if (!name || !position || !BOARD_POSITIONS.includes(position)) continue;

    const base: MatchableSource = {
      gsisId: null, // Sleeper nulls gsis_id for most active players
      name,
      team: normalizeTeam(str(player["team"]) ?? str(row["team"])),
      position,
    };

    const playerAdp = sleeperAdp(stats["adp_ppr"]);
    if (playerAdp !== null) {
      adp.push({ ...base, adp: playerAdp, stdev: null });
    }

    const pointsPpr = num(stats["pts_ppr"]);
    const pointsHalfPpr = num(stats["pts_half_ppr"]);
    const pointsStandard = num(stats["pts_std"]);
    if (pointsPpr !== null || pointsHalfPpr !== null || pointsStandard !== null) {
      projections.push({ ...base, pointsPpr, pointsHalfPpr, pointsStandard });
    }
  }

  if (adp.length === 0 && projections.length === 0) {
    throw new Error("Sleeper returned no usable projection records");
  }
  return { adp, projections };
}

// ── ESPN market values ───────────────────────────────────────────────────────

export function espnMarketUrl(year: number): string {
  return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leaguedefaults/3?view=kona_player_info`;
}

/** ESPN keys positions and teams by number. Only the board positions matter. */
const ESPN_POSITIONS: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE" };
const ESPN_TEAMS: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

/**
 * Crowd auction values and ESPN ADP from live ESPN drafts. The filter header
 * is how ESPN's own client pages this endpoint; 400 rows comfortably covers
 * the 250-player board.
 */
export async function fetchEspnMarket(
  year: number,
  options?: FetchOptions,
): Promise<{ adp: AdpRecord[]; auction: AuctionRecord[] }> {
  const filter = JSON.stringify({
    players: {
      limit: 400,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" },
    },
  });
  const payload = await getJson(espnMarketUrl(year), options, { "x-fantasy-filter": filter });
  const players = (payload as { players?: unknown })?.players;
  if (!Array.isArray(players)) {
    throw new Error("ESPN returned an unexpected payload");
  }

  const adp: AdpRecord[] = [];
  const auction: AuctionRecord[] = [];

  for (const value of players) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const player = (entry["player"] ?? {}) as Record<string, unknown>;
    const ownership = (player["ownership"] ?? {}) as Record<string, unknown>;

    const name = str(player["fullName"]);
    const position = ESPN_POSITIONS[num(player["defaultPositionId"]) ?? -1];
    if (!name || !position) continue;

    const base: MatchableSource = {
      gsisId: null, // ESPN ids are ESPN's own
      name,
      team: ESPN_TEAMS[num(player["proTeamId"]) ?? -1] ?? null,
      position,
    };

    const playerAdp = num(ownership["averageDraftPosition"]);
    if (playerAdp !== null && playerAdp > 0) {
      adp.push({ ...base, adp: playerAdp, stdev: null });
    }

    const aav = num(ownership["auctionValueAverage"]);
    if (aav !== null && aav > 0) {
      auction.push({ ...base, aav });
    }
  }

  if (adp.length === 0 && auction.length === 0) {
    throw new Error("ESPN returned no usable market records");
  }
  return { adp, auction };
}
