/**
 * Suggested picks: who to take next, and why.
 *
 * A weighted blend of everything the app now knows — how likely the player is
 * to still be there at the user's next turn (consensus ADP vs their actual
 * snake slots), what the roster still needs, market value, positional tier
 * scarcity, projected points, availability, and bye-week pileups. Every
 * component that moves the score also emits a human-readable reason, so a
 * suggestion is an argument rather than a number.
 *
 * Pure: no I/O, no clock, fully table-testable. Missing inputs contribute
 * nothing rather than being invented — the blank-is-not-zero rule extends to
 * scoring.
 */

import { isUnavailableStatus } from "@workspace/shared";
import type { RosterSettings } from "@workspace/store";

export interface RecommendablePlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  rank: number;
  tier: number;
  adp: number;
  adpConsensus: number | null;
  adpConsensusStdev: number | null;
  valueScore: number | null;
  valueScoreConsensus: number | null;
  projectedPoints: number | null;
  ppg: number | null;
  injuryStatus: string | null;
  byeWeek: number | null;
}

export interface RecommendInput {
  players: readonly RecommendablePlayer[];
  /** Ids off the board: drafted players and every keeper, any owner. */
  unavailableIds: ReadonlySet<string>;
  /** The user's roster so far (keepers + picks), as positions and byes. */
  myRoster: readonly { position: string; byeWeek: number | null }[];
  roster: RosterSettings;
  /** The user's remaining overall picks, in order. Empty means roster full. */
  myNextPicks: readonly number[];
}

export interface Recommendation {
  playerId: string;
  name: string;
  team: string;
  position: string;
  score: number;
  reasons: string[];
  components: {
    availability: number;
    need: number;
    value: number;
    scarcity: number;
    projection: number;
    injury: number;
    bye: number;
  };
}

const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);

/**
 * Starting spots still to fill, from the league's roster settings.
 *
 * FLEX is consumed only by RB/WR/TE beyond their base spots: a third WR in a
 * 2-WR league fills the flex, not a phantom WR3 slot.
 */
export function positionalNeeds(
  roster: RosterSettings,
  rostered: readonly { position: string }[],
) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const player of rostered) {
    if (player.position in counts) counts[player.position as keyof typeof counts] += 1;
  }

  const flexUsed = (["RB", "WR", "TE"] as const).reduce(
    (used, position) => used + Math.max(0, counts[position] - roster[position]),
    0,
  );

  return {
    QB: Math.max(0, roster.QB - counts.QB),
    RB: Math.max(0, roster.RB - counts.RB),
    WR: Math.max(0, roster.WR - counts.WR),
    TE: Math.max(0, roster.TE - counts.TE),
    FLEX: Math.max(0, roster.FLEX - flexUsed),
  };
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf approximation). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf =
    1 -
    t *
      (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Season points to compare players by: the projection, or last year's pace. */
function seasonPoints(player: RecommendablePlayer): number | null {
  if (player.projectedPoints !== null) return player.projectedPoints;
  if (player.ppg !== null) return player.ppg * 17;
  return null;
}

export function recommend(input: RecommendInput, limit = 10): Recommendation[] {
  const { players, unavailableIds, myRoster, roster, myNextPicks } = input;
  if (myNextPicks.length === 0) return [];

  const currentPick = myNextPicks[0];
  const nextPick = myNextPicks[1] ?? null;
  const needs = positionalNeeds(roster, myRoster);

  const available = players.filter(
    (player) => !unavailableIds.has(player.id) && player.position in needs,
  );

  const byPosition = new Map<string, RecommendablePlayer[]>();
  for (const player of available) {
    const group = byPosition.get(player.position);
    if (group) group.push(player);
    else byPosition.set(player.position, [player]);
  }

  const recommendations = available.map((player) => {
    const reasons: string[] = [];
    const positionGroup = byPosition.get(player.position) ?? [];

    // ── Availability: will he make it back to me? ────────────────────────
    // Consensus ADP as the mean, the cross-source spread as the sigma. Wide
    // floor/ceiling on sigma: even a unanimous ADP is not that precise.
    const mu = player.adpConsensus ?? player.adp;
    const sigma = Math.min(15, Math.max(3, player.adpConsensusStdev ?? 6));
    const pNow = phi((mu - currentPick) / sigma);
    const pNextTurn = nextPick === null ? 0 : phi((mu - nextPick) / sigma);
    const availability = clamp01(pNow - pNextTurn);
    if (nextPick !== null && availability >= 0.35 && pNow >= 0.3) {
      reasons.push(`${Math.round((1 - pNextTurn) * 100)}% gone before your next pick (#${nextPick})`);
    }

    // ── Need ─────────────────────────────────────────────────────────────
    const baseNeed = needs[player.position as keyof typeof needs] ?? 0;
    const flexOpen = needs.FLEX > 0 && FLEX_POSITIONS.has(player.position);
    const need = baseNeed > 0 ? 1 : flexOpen ? 0.7 : 0.15;
    if (baseNeed > 0) reasons.push(`Fills an open ${player.position} spot`);
    else if (flexOpen) reasons.push("Flex-eligible");

    // ── Value ────────────────────────────────────────────────────────────
    const valueSd = player.valueScoreConsensus ?? player.valueScore;
    const value = valueSd === null ? 0.5 : clamp01((Math.max(-2, Math.min(2, valueSd)) + 2) / 4);
    if (valueSd !== null && valueSd >= 0.5) {
      reasons.push(`Priced ${valueSd.toFixed(1)} SD below his 2025 production`);
    }

    // ── Tier scarcity ────────────────────────────────────────────────────
    const tierLeft = positionGroup.filter((other) => other.tier === player.tier).length;
    const points = seasonPoints(player);
    const nextTierPoints = positionGroup
      .filter((other) => other.tier > player.tier)
      .map(seasonPoints)
      .filter((value): value is number => value !== null);
    const dropOff =
      points !== null && nextTierPoints.length > 0
        ? Math.max(0, points - Math.max(...nextTierPoints))
        : null;
    const scarcity =
      (tierLeft <= 2 ? 0.5 : tierLeft <= 4 ? 0.3 : 0) +
      (dropOff !== null ? clamp01(dropOff / 60) * 0.5 : 0);
    if (tierLeft <= 3 && dropOff !== null && dropOff >= 15) {
      reasons.push(
        `${tierLeft === 1 ? "Last one" : `One of ${tierLeft} left`} in ${player.position} tier ${player.tier}; ${Math.round(dropOff)}-pt drop to the next tier`,
      );
    }

    // ── Projection percentile within position ────────────────────────────
    const positionPoints = positionGroup
      .map(seasonPoints)
      .filter((value): value is number => value !== null);
    let projection = 0.5;
    if (points !== null && positionPoints.length > 1) {
      const below = positionPoints.filter((value) => value < points).length;
      projection = below / (positionPoints.length - 1);
      if (projection >= 0.999) reasons.push(`Top remaining ${player.position} by projection`);
    }

    // ── Injury ───────────────────────────────────────────────────────────
    let injury = 0;
    if (isUnavailableStatus(player.injuryStatus)) {
      injury = -1;
      reasons.push(`Listed ${player.injuryStatus}`);
    } else if (player.injuryStatus?.trim().toLowerCase() === "questionable") {
      injury = -0.3;
      reasons.push("Carrying a Questionable tag");
    }

    // ── Bye overlap ──────────────────────────────────────────────────────
    let bye = 0;
    if (player.byeWeek !== null && player.byeWeek !== 0) {
      const clash = myRoster.some(
        (mine) => mine.position === player.position && mine.byeWeek === player.byeWeek,
      );
      if (clash) {
        bye = -0.15;
        reasons.push(`Shares the week ${player.byeWeek} bye with your other ${player.position}`);
      }
    }

    const components = { availability, need, value, scarcity, projection, injury, bye };
    const score =
      0.3 * availability +
      0.25 * need +
      0.2 * value +
      0.15 * scarcity +
      0.1 * projection +
      0.35 * injury +
      bye;

    return {
      playerId: player.id,
      name: player.name,
      team: player.team,
      position: player.position,
      score: Number(score.toFixed(3)),
      reasons,
      components: Object.fromEntries(
        Object.entries(components).map(([key, value]) => [key, Number(value.toFixed(3))]),
      ) as Recommendation["components"],
    };
  });

  return recommendations.sort((a, b) => b.score - a.score).slice(0, limit);
}
