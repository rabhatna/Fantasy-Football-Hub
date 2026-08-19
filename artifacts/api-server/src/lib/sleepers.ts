/**
 * Sleepers and rookies: who the room is not paying for.
 *
 * A sleeper here is a player whose price is late (or absent) while something
 * real argues for him: youth on an early-career arc, a rookie landing spot,
 * a handcuff one injury from a starting job, a committee share the market is
 * reading as a timeshare, efficiency the counting stats hid, or a weekly
 * ceiling his median hides. Every signal that fires emits a reason and a tag,
 * so the list reads as arguments — and can be filtered to just rookies, just
 * handcuffs, and so on.
 *
 * Pure: no I/O, fully table-testable. Missing inputs contribute nothing.
 */

import { isUnavailableStatus } from "@workspace/shared";

export interface SleeperCandidate {
  id: string;
  name: string;
  team: string;
  position: string;
  rank: number;
  adp: number;
  adpConsensus: number | null;
  ecrRank: number | null;
  depthRank: number | null;
  injuryStatus: string | null;
  age: number | null;
  isRookie: boolean;
  share: number | null;
  projectedPoints: number | null;
  ppg: number | null;
  nextGen: { ryoe: number | null; separation: number | null };
  consistency: { median: number | null; ceiling: number | null };
}

export interface SleeperPick {
  playerId: string;
  name: string;
  team: string;
  position: string;
  adp: number;
  score: number;
  tags: string[];
  reasons: string[];
}

export interface SleeperInput {
  players: readonly SleeperCandidate[];
  /** Drafted and kept players — already owned, so not sleepers to chase. */
  unavailableIds: ReadonlySet<string>;
  teamCount: number;
}

const price = (player: SleeperCandidate) => player.adpConsensus ?? player.adp;

export function findSleepers(input: SleeperInput, limit = 24): SleeperPick[] {
  const { players, unavailableIds, teamCount } = input;

  // "Under the radar" means the room is not spending an early pick: anything
  // after about round five, plus rookies wherever they go — a rookie the
  // market has already priced up front is excluded from the sleeper list but
  // still belongs on the rookie filter, so he keeps the tag with no score.
  const lateCutoff = teamCount * 5;

  const byTeamPosition = new Map<string, SleeperCandidate[]>();
  for (const player of players) {
    const key = `${player.team}|${player.position}`;
    const bucket = byTeamPosition.get(key);
    if (bucket) bucket.push(player);
    else byTeamPosition.set(key, [player]);
  }

  const picks: SleeperPick[] = [];

  for (const player of players) {
    if (unavailableIds.has(player.id)) continue;
    if (isUnavailableStatus(player.injuryStatus)) continue; // hurt players are not sleepers

    const tags: string[] = [];
    const reasons: string[] = [];
    let score = 0;
    const playerPrice = price(player);
    const isLate = playerPrice >= lateCutoff;

    // ── Youth arc ───────────────────────────────────────────────────────
    if (player.isRookie) {
      tags.push("rookie");
      reasons.push("Rookie season");
      if (isLate) score += 0.25;
      if (player.depthRank !== null && player.depthRank <= 2) {
        score += 0.2;
        reasons.push(
          player.depthRank === 1
            ? "Already atop the depth chart"
            : "One spot from the starting job",
        );
      }
    } else if (player.age !== null && player.age <= 24) {
      tags.push("early-career");
      reasons.push(`Age ${Math.round(player.age)} — second or third season`);
      if (isLate) score += 0.2;
    }

    // ── The market is later than the talent ─────────────────────────────
    const modelRank = player.ecrRank ?? player.rank;
    const priceGap = playerPrice - modelRank;
    if (isLate && priceGap >= teamCount) {
      tags.push("value");
      score += Math.min(0.35, (priceGap / teamCount) * 0.08);
      reasons.push(
        `Drafted ~${Math.round(priceGap)} picks after his rank (#${Math.round(modelRank)})`,
      );
    }

    // ── Opportunity: handcuffs and committees ───────────────────────────
    const mates = byTeamPosition.get(`${player.team}|${player.position}`) ?? [];
    const starter = mates.find((mate) => mate.depthRank === 1 && mate.id !== player.id);
    if (player.depthRank === 2 && starter) {
      if (isUnavailableStatus(starter.injuryStatus)) {
        tags.push("handcuff");
        score += 0.45;
        reasons.push(`Next man up: ${starter.name} is ${starter.injuryStatus}`);
      } else if (starter.injuryStatus?.trim().toLowerCase() === "questionable") {
        tags.push("handcuff");
        score += 0.25;
        reasons.push(`${starter.name} ahead of him is Questionable`);
      } else if (player.position === "RB" && isLate) {
        tags.push("handcuff");
        score += 0.12;
        reasons.push(`One ${starter.name} injury from a backfield`);
      }
    }
    if (
      player.position === "RB" &&
      player.share !== null &&
      player.share >= 18 &&
      player.share <= 45 &&
      isLate
    ) {
      tags.push("committee");
      score += 0.22;
      reasons.push(`${Math.round(player.share)}% of the backfield touches already`);
    }

    // ── Efficiency the box score hid ────────────────────────────────────
    if (isLate && player.nextGen.ryoe !== null && player.nextGen.ryoe > 25) {
      score += 0.12;
      reasons.push(`+${Math.round(player.nextGen.ryoe)} rushing yards over expected`);
    }
    if (isLate && player.nextGen.separation !== null && player.nextGen.separation >= 3.2) {
      score += 0.12;
      reasons.push(`${player.nextGen.separation.toFixed(1)} yds separation — wins routes`);
    }

    // ── Ceiling his median hides ────────────────────────────────────────
    const { median, ceiling } = player.consistency;
    if (isLate && median !== null && ceiling !== null && median >= 5 && ceiling >= median * 2.2) {
      tags.push("boom");
      score += 0.1;
      reasons.push(`Weekly ceiling of ${ceiling.toFixed(0)} on a ${median.toFixed(0)} median`);
    }

    // A rookie is always listed (the rookie filter needs him); anyone else
    // needs a real argument and a late price.
    if (tags.length === 0 || (!player.isRookie && (!isLate || score < 0.2))) continue;

    picks.push({
      playerId: player.id,
      name: player.name,
      team: player.team,
      position: player.position,
      adp: Number(playerPrice.toFixed(1)),
      score: Number(score.toFixed(3)),
      tags,
      reasons,
    });
  }

  return picks.sort((a, b) => b.score - a.score || a.adp - b.adp).slice(0, limit);
}
