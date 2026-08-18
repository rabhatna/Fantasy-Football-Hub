import { normalize, number, percent, rounded, round, weightedAverage, type Row } from "./fields.ts";

export interface DatasetTeam {
  team: string;
  fullName: string;
  aly: number | null;
  stuffRate: number | null;
  runBlockGrade: number | null;
  passBlockGrade: number | null;
  olGrade: number | null;
  proe: number | null;
  snapContinuity: number | null;
  vacatedTargets: number | null;
  vacatedCarries: number | null;
  vacatedOpportunity: number | null;
  pointsPerGame: number | null;
  playsPerGame: number | null;
  returningStarters: number | null;
  /** 0-100 composite of the line's run and pass blocking plus continuity. */
  compositeScore: number | null;
  tier: string;
  trend: string;
}

const TEAM_NAMES: Record<string, string> = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys",
  DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams",
  LV: "Las Vegas Raiders", MIA: "Miami Dolphins", MIN: "Minnesota Vikings",
  NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks", SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans", WAS: "Washington Commanders", WSH: "Washington Commanders",
};

/**
 * Observed ranges across the 32 teams in the 2026 snapshot.
 *
 * The previous implementation normalised adjusted line yards as
 * (aly - 3.0) / (5.5 - 3.0) and treated stuff rate as a 10-25 percentage.
 * Those bounds came from generated data: real adjusted line yards span roughly
 * 2.4 to 3.5, and stuff rate is a fraction around 0.11-0.25, so every team
 * scored near zero — or below it — under the old formula.
 *
 * Bounds are held slightly wider than the observed range so a future snapshot
 * with a more extreme team is clamped rather than rescaling the whole board.
 */
const RANGES = {
  aly: { min: 2.2, max: 3.7 },
  stuffRate: { min: 0.09, max: 0.27 },
  grade: { min: 0, max: 100 },
  continuity: { min: 0, max: 1 },
} as const;

function tierForScore(score: number | null): string {
  if (score === null) return "Unrated";
  if (score >= 75) return "Elite";
  if (score >= 60) return "Above Average";
  if (score >= 45) return "Average";
  if (score >= 30) return "Below Average";
  return "Poor";
}

/**
 * Continuity is how much of the 2025 offensive line is back in 2026, so it
 * describes which direction the unit is heading rather than how good it is.
 */
function trendForContinuity(continuity: number | null, returningStarters: number | null): string {
  if (continuity === null) return "Unknown";
  if (continuity >= 0.85 && (returningStarters ?? 0) >= 4) return "Stable";
  if (continuity >= 0.85) return "Rising";
  if (continuity >= 0.6) return "Watch";
  return "Risk";
}

export function toTeam(row: Row): DatasetTeam {
  const code = (row["team_2026"] ?? "").trim();
  const aly = number(row, "tm_adjusted_line_yards");
  const stuffRate = number(row, "tm_stuff_rate_adj");
  const runBlock = number(row, "tm_ol_run_block_grade");
  const passBlock = number(row, "tm_ol_pass_block_grade");
  const continuity = number(row, "tm_ol_continuity_pct");

  // Run blocking and pass blocking carry the most weight; adjusted line yards
  // and stuff rate are play-by-play evidence for the run grade, and continuity
  // is how much of that unit actually returns.
  const compositeScore = weightedAverage([
    { value: normalize(runBlock, RANGES.grade.min, RANGES.grade.max), weight: 0.3 },
    { value: normalize(passBlock, RANGES.grade.min, RANGES.grade.max), weight: 0.3 },
    { value: normalize(aly, RANGES.aly.min, RANGES.aly.max), weight: 0.15 },
    {
      value: normalize(stuffRate, RANGES.stuffRate.min, RANGES.stuffRate.max, { invert: true }),
      weight: 0.1,
    },
    { value: normalize(continuity, RANGES.continuity.min, RANGES.continuity.max), weight: 0.15 },
  ]);

  const vacatedTargets = percent(row, "tm_vacated_target_pct");
  const vacatedCarries = percent(row, "tm_vacated_carry_pct");
  const vacatedOpportunity =
    vacatedTargets === null && vacatedCarries === null
      ? null
      : round(((vacatedTargets ?? 0) + (vacatedCarries ?? 0)) / 2, 1);

  return {
    team: code,
    fullName: TEAM_NAMES[code] ?? code,
    aly: rounded(row, "tm_adjusted_line_yards", 2),
    stuffRate: percent(row, "tm_stuff_rate_adj"),
    runBlockGrade: rounded(row, "tm_ol_run_block_grade", 1),
    passBlockGrade: rounded(row, "tm_ol_pass_block_grade", 1),
    olGrade: rounded(row, "tm_ol_overall_grade", 1),
    proe: percent(row, "tm_proe"),
    snapContinuity: percent(row, "tm_ol_continuity_pct"),
    vacatedTargets,
    vacatedCarries,
    vacatedOpportunity,
    pointsPerGame: rounded(row, "tm_points_per_game", 1),
    playsPerGame: rounded(row, "tm_plays_per_game", 1),
    returningStarters: number(row, "tm_returning_starters"),
    compositeScore,
    tier: tierForScore(compositeScore),
    trend: trendForContinuity(continuity, number(row, "tm_returning_starters")),
  };
}

/**
 * One record per team. Team columns repeat identically on every player row, so
 * the first row for each team is representative.
 */
export function toTeams(rows: readonly Row[]): DatasetTeam[] {
  const seen = new Map<string, Row>();
  for (const row of rows) {
    const code = (row["team_2026"] ?? "").trim();
    if (code && !seen.has(code)) seen.set(code, row);
  }

  return [...seen.values()]
    .map(toTeam)
    .sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1));
}
