/**
 * Snake-draft arithmetic: which overall picks belong to a slot, and which of
 * them the user still holds once keepers and made picks are accounted for.
 */

export interface RemainingPicksInput {
  teamCount: number;
  /** The user's slot in round one, 1..teamCount. */
  draftSlot: number;
  /** Total rounds, i.e. the sum of the roster spots. */
  rounds: number;
  /** Rounds consumed by the user's round-cost keepers. */
  keeperRounds: readonly number[];
  /** Rounds where the user traded the pick away and never had one. */
  missingRounds?: readonly number[];
  /** Picks the user has already made; each consumes the earliest remaining slot. */
  picksMade: number;
}

export interface DraftPickSlot {
  round: number;
  overall: number;
}

/** Overall pick number for a slot in a snake draft: odd rounds run forward, even rounds reverse. */
export function snakeOverall(round: number, teamCount: number, draftSlot: number): number {
  const base = (round - 1) * teamCount;
  return round % 2 === 1 ? base + draftSlot : base + (teamCount + 1 - draftSlot);
}

/** The user's picks still to come, in draft order. */
export function remainingPicks(input: RemainingPicksInput): DraftPickSlot[] {
  const { teamCount, draftSlot, rounds, keeperRounds, missingRounds = [], picksMade } = input;
  const consumed = new Set([...keeperRounds, ...missingRounds]);

  const slots: DraftPickSlot[] = [];
  for (let round = 1; round <= rounds; round++) {
    if (consumed.has(round)) continue;
    slots.push({ round, overall: snakeOverall(round, teamCount, draftSlot) });
  }

  return slots.slice(Math.max(0, picksMade));
}
