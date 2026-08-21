import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDraftPlan, type DraftPlanInput } from "./draft-plan.ts";
import type { RecommendablePlayer } from "./recommend.ts";
import type { RosterSettings } from "@workspace/store";

let nextId = 0;
function player(overrides: Partial<RecommendablePlayer>): RecommendablePlayer {
  nextId += 1;
  return {
    id: `p-${nextId}`,
    name: `Player ${nextId}`,
    team: "KC",
    position: "WR",
    rank: nextId,
    tier: 3,
    adp: 50,
    adpConsensus: null,
    adpConsensusStdev: null,
    valueScore: null,
    valueScoreConsensus: null,
    projectedPoints: 200,
    ppg: null,
    injuryStatus: null,
    byeWeek: 7,
    ...overrides,
  };
}

const ROSTER: RosterSettings = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 };

/** A believable 100-player board: ADP ladder with positions mixed in. */
function board(): RecommendablePlayer[] {
  const players: RecommendablePlayer[] = [];
  const cycle = ["RB", "WR", "WR", "RB", "TE", "QB"];
  for (let i = 0; i < 100; i += 1) {
    players.push(
      player({
        position: cycle[i % cycle.length],
        adp: i + 1,
        adpConsensus: i + 1,
        projectedPoints: 350 - i * 2.5,
      }),
    );
  }
  return players;
}

function run(overrides: Partial<DraftPlanInput> = {}) {
  return buildDraftPlan({
    players: board(),
    unavailableIds: new Set(),
    myRoster: [],
    roster: ROSTER,
    myNextPicks: Array.from({ length: 15 }, (_, index) => ({
      round: index + 1,
      overall: index * 12 + 6, // slot 6 of a 12-teamer, snake flattened
    })),
    ...overrides,
  });
}

test("every remaining pick gets a slot, and the tail streams K and DST", () => {
  const slots = run();
  assert.equal(slots.length, 15);
  const tail = slots.slice(-2);
  assert.ok(tail.every((slot) => slot.options.length === 0 && slot.note !== null));
  assert.ok(tail.some((slot) => slot.note?.includes("defense")));
  assert.ok(tail.some((slot) => slot.note?.includes("kicker")));
});

test("options are unique across the whole plan and ADP tracks the pick", () => {
  const slots = run();
  const ids = slots.flatMap((slot) => slot.options.map((option) => option.playerId));
  assert.equal(ids.length, new Set(ids).size);

  // Round 1 proposes someone priced near the top; round 8 someone much later.
  const first = slots[0].options[0];
  const late = slots[7].options[0];
  assert.ok(first.adp <= 15, `round 1 primary priced at ${first.adp}`);
  assert.ok(late.adp > first.adp + 30, `round 8 primary priced at ${late.adp}`);
});

test("kept players come off the board and their position stops being a need", () => {
  const players = board();
  const keptRbs = players.filter((entry) => entry.position === "RB").slice(0, 2);
  const slots = run({
    unavailableIds: new Set(keptRbs.map((entry) => entry.id)),
    myRoster: keptRbs.map((entry) => ({ position: entry.position })),
  });

  const proposed = slots.flatMap((slot) => slot.options.map((option) => option.playerId));
  assert.ok(keptRbs.every((entry) => !proposed.includes(entry.id)));

  // With both RB starters kept, the first primary should fill another need.
  const firstPrimary = slots[0].options[0];
  assert.notEqual(firstPrimary.role, "fills RB");
});

test("a starter-filling primary is labelled with its role", () => {
  const slots = run();
  const roles = slots.map((slot) => slot.options[0]?.role).filter(Boolean);
  assert.ok(roles.some((role) => role?.startsWith("fills ")));
  assert.ok(roles.some((role) => role === "depth"));
});

test("players who cannot start the season are not planned", () => {
  const players = board();
  players[0].injuryStatus = "IR";
  const slots = run({ players });
  const proposed = slots.flatMap((slot) => slot.options.map((option) => option.playerId));
  assert.ok(!proposed.includes(players[0].id));
});

test("an exhausted board leaves an honest note instead of an empty slot", () => {
  const slots = run({ players: board().slice(0, 6) });
  const starved = slots.filter((slot) => slot.note?.includes("exhausted"));
  assert.ok(starved.length > 0);
});
