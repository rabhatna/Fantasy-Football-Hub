/**
 * The proposed draft plan: a round-by-round target list for every pick the
 * user still holds, built from whoever is still on the board once keepers
 * and drafted players come off it.
 *
 * Each slot carries several options, best first, because the primary will
 * sometimes be gone: the plan is a sheet of names to walk down, not a single
 * script. Options are unique across the whole plan — a name you see at round
 * 6 will not reappear at round 9 — so the sheet reads as one broad list.
 *
 * The scoring favors players whose market price lands near the pick: taking
 * a player three rounds early burns value, and a player priced much later
 * will still be there next turn. Positional need walks forward with the plan
 * (the round-4 slot assumes the round-3 primary was taken), so the whole
 * thing fills a legal starting lineup before it drafts depth.
 *
 * Pure: no I/O, no clock, fully table-testable.
 */

import { isUnavailableStatus } from "@workspace/shared";
import type { RosterSettings } from "@workspace/store";
import { positionalNeeds, type RecommendablePlayer } from "./recommend.ts";

export interface PlanPickSlot {
  round: number;
  overall: number;
}

export interface DraftPlanInput {
  players: readonly RecommendablePlayer[];
  /** Ids off the board: drafted players and every keeper, any owner. */
  unavailableIds: ReadonlySet<string>;
  /** The user's roster so far (keepers + picks), as positions. */
  myRoster: readonly { position: string }[];
  roster: RosterSettings;
  /** The user's remaining picks, in draft order. */
  myNextPicks: readonly PlanPickSlot[];
}

export interface PlanOption {
  playerId: string;
  name: string;
  team: string;
  position: string;
  /** The price the plan reasoned from: consensus ADP, or the dataset's. */
  adp: number;
  /** Chance he is still on the board at this pick, 0-1. */
  availability: number;
  /** What taking him does for the roster: "fills RB", "flex", "depth". */
  role: string;
}

export interface DraftPlanSlot {
  round: number;
  overall: number;
  /** Best first. The first option is the primary target. */
  options: PlanOption[];
  /** Set when the slot has no ranked candidates — kicker/defense rounds. */
  note: string | null;
}

const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf approximation). */
function phi(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const erf =
    1 -
    t *
      (0.254829592 +
        t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function seasonPoints(player: RecommendablePlayer): number | null {
  if (player.projectedPoints !== null) return player.projectedPoints;
  if (player.ppg !== null) return player.ppg * 17;
  return null;
}

/** How many options each slot proposes, primary included. */
const OPTIONS_PER_SLOT = 4;

/** He has to be plausibly on the board to make the sheet at all. */
const MIN_AVAILABILITY = 0.2;

export function buildDraftPlan(input: DraftPlanInput): DraftPlanSlot[] {
  const { players, unavailableIds, myRoster, roster, myNextPicks } = input;

  // The ranked board has no kickers or defenses, so those roster spots are
  // planned as notes on the final picks — which is where they belong anyway.
  const streamers: string[] = [];
  for (let i = 0; i < (roster.DST ?? 0); i += 1) streamers.push("defense");
  for (let i = 0; i < (roster.K ?? 0); i += 1) streamers.push("kicker");
  const streamerSlots = Math.min(streamers.length, myNextPicks.length);
  const playerSlots = myNextPicks.length - streamerSlots;

  const plannable = new Set(["QB", "RB", "WR", "TE"]);
  const available = players.filter(
    (player) =>
      plannable.has(player.position) &&
      !unavailableIds.has(player.id) &&
      // A player who cannot start the season is not a draft target.
      !isUnavailableStatus(player.injuryStatus),
  );

  const used = new Set<string>();
  const plannedRoster = myRoster.map((entry) => ({ position: entry.position }));
  const slots: DraftPlanSlot[] = [];

  for (let index = 0; index < playerSlots; index += 1) {
    const pick = myNextPicks[index];
    const nextPick = myNextPicks[index + 1] ?? null;
    const needs = positionalNeeds(roster, plannedRoster);
    const startersOpen = needs.QB + needs.RB + needs.WR + needs.TE + needs.FLEX;

    const scored = available
      .filter((player) => !used.has(player.id))
      .map((player) => {
        const mu = player.adpConsensus ?? player.adp;
        const sigma = Math.min(15, Math.max(3, player.adpConsensusStdev ?? 6));
        const pNow = phi((mu - pick.overall) / sigma);
        if (pNow < MIN_AVAILABILITY) return null;

        const pNext =
          index + 1 < playerSlots && nextPick !== null
            ? phi((mu - nextPick.overall) / sigma)
            : 0;
        // Take him now or lose him: the share of his availability that
        // evaporates between this pick and the next one.
        const urgency = clamp01(pNow - pNext);

        const baseNeed = needs[player.position as keyof typeof needs] ?? 0;
        const flexOpen = needs.FLEX > 0 && FLEX_POSITIONS.has(player.position);
        // Once the starting lineup is planned, everyone is depth and the
        // need weight flattens — bench rounds chase value, not positions.
        const need = baseNeed > 0 ? 1 : flexOpen ? 0.75 : startersOpen > 0 ? 0.2 : 0.5;
        const role = baseNeed > 0 ? `fills ${player.position}` : flexOpen ? "flex" : "depth";

        const points = seasonPoints(player);
        const positionPoints = available
          .filter((other) => other.position === player.position && !used.has(other.id))
          .map(seasonPoints)
          .filter((value): value is number => value !== null);
        let quality = 0.5;
        if (points !== null && positionPoints.length > 1) {
          const below = positionPoints.filter((value) => value < points).length;
          quality = below / (positionPoints.length - 1);
        }

        // Pick value: how well his market price fits this pick. Taking a
        // player priced two rounds later than the pick burns the pick —
        // the plan should propose the best player the market expects to be
        // gone soon, not the safest one who would still be there next turn.
        const reach = Math.max(0, mu - pick.overall);
        const value = clamp01(1 - reach / 24);

        const score =
          0.4 * value + 0.2 * quality + 0.15 * need + 0.15 * urgency + 0.1 * pNow;

        return { player, pNow, role, score };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.score - a.score);

    const options = scored.slice(0, OPTIONS_PER_SLOT).map((entry) => ({
      playerId: entry.player.id,
      name: entry.player.name,
      team: entry.player.team,
      position: entry.player.position,
      adp: Number((entry.player.adpConsensus ?? entry.player.adp).toFixed(1)),
      availability: Number(entry.pNow.toFixed(2)),
      role: entry.role,
    }));

    // Every proposed name is consumed so it cannot resurface later — the
    // sheet is one broad list, and a round-6 alternate who survives will be
    // obvious value on draft day without the plan repeating him.
    for (const option of options) used.add(option.playerId);
    if (options.length > 0) plannedRoster.push({ position: options[0].position });

    slots.push({
      round: pick.round,
      overall: pick.overall,
      options,
      note: options.length === 0 ? "The ranked board is exhausted at this pick." : null,
    });
  }

  // The tail picks stream what the board does not rank.
  for (let index = 0; index < streamerSlots; index += 1) {
    const pick = myNextPicks[playerSlots + index];
    const what = streamers[index];
    slots.push({
      round: pick.round,
      overall: pick.overall,
      options: [],
      note: `Stream a ${what} here — the ranked board doesn't cover them, and the last rounds are where they belong.`,
    });
  }

  return slots;
}
