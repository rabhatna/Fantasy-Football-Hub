import {
  boolean,
  clamp,
  integer,
  number,
  percent,
  requiredNumber,
  requiredText,
  round,
  rounded,
  text,
  type Row,
} from "./fields.ts";

/**
 * A player as the API serves them.
 *
 * Nullable fields are nullable because the source data genuinely lacks them for
 * some players, not as a convenience — see fields.ts.
 */
export interface DatasetPlayer {
  id: string;
  rank: number;
  name: string;
  team: string;
  position: string;
  adp: number;
  adpSource: string | null;
  /**
   * Production-versus-price gap, in standard deviations: positive means the
   * player produced better than his draft cost implies. This is the dataset's
   * own `value_score`, roughly Z(2025 positional finish) - Z(2026 ADP), and it
   * spans about -3 to +2.5. It is deliberately *not* rescaled to a 0-10 rating:
   * the sign and the magnitude in SDs are the meaning.
   */
  valueScore: number | null;
  marketVerdict: string | null;
  ppg: number | null;
  /**
   * 2025 points per game under each scoring format. `ppg` above is the PPR
   * value (the dataset's primary scoring); these let the server serve whichever
   * format the league settings ask for without reloading the snapshot.
   */
  ppgByScoring: {
    ppr: number | null;
    halfPpr: number | null;
    standard: number | null;
  };
  share: number | null;
  oLineGrade: number | null;
  injuryStatus: string | null;
  byeWeek: number | null;
  tier: number;
  durabilityScore: number | null;
  productionFinish: number | null;
  age: number | null;
  isRookie: boolean;
  gamesPlayed: number | null;
  snapShare: number | null;
  note: string | null;
  nextGen: {
    separation: number | null;
    catchPct: number | null;
    ryoe: number | null;
    boxCount: number | null;
  };
  consistency: {
    floor: number | null;
    median: number | null;
    ceiling: number | null;
    boomRate: number | null;
    bustRate: number | null;
    weeksPlayed: number | null;
  };
}

/**
 * Tier from overall rank. The dataset ranks players but does not tier them, and
 * the boundaries below are the draft-round breaks the board is read against.
 */
function tierForRank(rank: number): number {
  if (rank <= 5) return 1;
  if (rank <= 12) return 2;
  if (rank <= 24) return 3;
  if (rank <= 48) return 4;
  if (rank <= 96) return 5;
  return 6;
}

/**
 * A 0-100 durability read from availability: how much of the season he was
 * active, and how heavily he was used when he was.
 *
 * Null for anyone with no 2025 snaps — a rookie has not demonstrated
 * durability either way, and scoring him 0 would read as "injury prone".
 */
function durability(row: Row): number | null {
  const games = number(row, "y25_games");
  const snapPct = number(row, "y25_snap_pct");
  if (games === null && snapPct === null) return null;

  // 17-game season; games played carries most of the signal, snap share
  // separates a full-time starter from a rotational body.
  const availability = games === null ? null : Math.min(1, games / 17);
  const usage = snapPct === null ? null : Math.min(1, snapPct);

  const parts = [availability, usage].filter((part): part is number => part !== null);
  const score = parts.reduce((sum, part) => sum + part, 0) / parts.length;
  return clamp(round(score * 100, 0), 0, 100);
}

/**
 * Opportunity share: target share for pass catchers, carry share for backs.
 *
 * Uses the `_active` variants, which are computed only over weeks the player
 * actually took a snap — a player who missed six games should not look
 * low-usage because of the weeks he was not there.
 */
function opportunityShare(row: Row, position: string): number | null {
  if (position === "RB") {
    return percent(row, "y25_carry_share_active") ?? percent(row, "y25_carry_share");
  }
  if (position === "QB") return null; // target/carry share is meaningless for a passer
  return percent(row, "y25_target_share_active") ?? percent(row, "y25_target_share");
}

export function toPlayer(row: Row): DatasetPlayer {
  const position = requiredText(row, "position");
  const rank = requiredNumber(row, "rank");

  return {
    // gsis_id is nflverse's stable player key: present for all 250, unique, and
    // the same across dataset refreshes. The previous name-derived slugs
    // changed whenever a name did.
    id: requiredText(row, "gsis_id"),
    rank,
    name: requiredText(row, "player"),
    team: requiredText(row, "team_2026"),
    position,
    adp: requiredNumber(row, "adp"),
    adpSource: text(row, "adp_source"),
    valueScore: rounded(row, "value_score", 2),
    marketVerdict: text(row, "market_verdict"),
    ppg: rounded(row, "y25_ppr_ppg", 1),
    ppgByScoring: {
      ppr: rounded(row, "y25_ppr_ppg", 1),
      halfPpr: rounded(row, "y25_half_ppr_ppg", 1),
      standard: rounded(row, "y25_standard_ppg", 1),
    },
    share: opportunityShare(row, position),
    oLineGrade: rounded(row, "tm_ol_overall_grade", 1),
    // The dataset carries no injury or availability status — it is built from
    // completed-season production and market data. Live status arrives from a
    // separate source; until then this is honestly unknown rather than "Active".
    injuryStatus: null,
    byeWeek: integer(row, "bye"),
    tier: tierForRank(rank),
    durabilityScore: durability(row),
    productionFinish: integer(row, "y25_pos_finish"),
    age: rounded(row, "age", 1),
    isRookie: boolean(row, "is_rookie"),
    gamesPlayed: integer(row, "y25_games"),
    snapShare: percent(row, "y25_snap_pct"),
    note: text(row, "notes"),
    nextGen: {
      // Recorded per position: separation and catch rate for receivers, rushing
      // yards over expected and eight-plus-box rate for backs. Null elsewhere.
      separation: rounded(row, "ngs_separation", 2),
      catchPct: rounded(row, "ngs_catch_pct", 1),
      ryoe: rounded(row, "ngs_ryoe", 1),
      boxCount: rounded(row, "ngs_eight_plus_box_pct", 1),
    },
    consistency: {
      floor: rounded(row, "y25_weekly_floor", 1),
      median: rounded(row, "y25_weekly_median", 1),
      ceiling: rounded(row, "y25_weekly_ceiling", 1),
      boomRate: percent(row, "y25_boom_rate"),
      bustRate: percent(row, "y25_bust_rate"),
      weeksPlayed: integer(row, "y25_weeks_played"),
    },
  };
}

/**
 * Normalised name for matching a player across datasets (and old saved picks).
 *
 * Handles "Lamb, CeeDee" as well as "CeeDee Lamb": these files are meant to be
 * edited in a spreadsheet, and last-name-first is how people write names there.
 */
export function normalizeName(name: string): string {
  // Only a single comma is a surname separator; anything else is left alone.
  const parts = name.split(",");
  const ordered = parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;

  return ordered
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
