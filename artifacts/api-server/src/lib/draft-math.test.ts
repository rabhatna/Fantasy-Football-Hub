import assert from "node:assert/strict";
import { test } from "node:test";

import { remainingPicks, snakeOverall } from "./draft-math.ts";

test("snake order runs forward in odd rounds and backward in even", () => {
  // 12 teams, slot 6: picks 6, 19, 30, 43...
  assert.equal(snakeOverall(1, 12, 6), 6);
  assert.equal(snakeOverall(2, 12, 6), 19);
  assert.equal(snakeOverall(3, 12, 6), 30);
  assert.equal(snakeOverall(4, 12, 6), 43);

  // The turn: slot 12 picks back-to-back at 12 and 13.
  assert.equal(snakeOverall(1, 12, 12), 12);
  assert.equal(snakeOverall(2, 12, 12), 13);
  // Slot 1 waits the longest between picks: 1 and 24.
  assert.equal(snakeOverall(1, 12, 1), 1);
  assert.equal(snakeOverall(2, 12, 1), 24);
});

test("a round-cost keeper removes exactly that round", () => {
  const slots = remainingPicks({
    teamCount: 12,
    draftSlot: 6,
    rounds: 4,
    keeperRounds: [3],
    picksMade: 0,
  });
  assert.deepEqual(slots, [
    { round: 1, overall: 6 },
    { round: 2, overall: 19 },
    { round: 4, overall: 43 },
  ]);
});

test("each pick made consumes the earliest remaining slot", () => {
  const slots = remainingPicks({
    teamCount: 12,
    draftSlot: 6,
    rounds: 4,
    keeperRounds: [1],
    picksMade: 1,
  });
  // Round 1 went to the keeper, the made pick ate round 2.
  assert.deepEqual(slots, [
    { round: 3, overall: 30 },
    { round: 4, overall: 43 },
  ]);
});

test("traded-away rounds vanish alongside keeper rounds", () => {
  const slots = remainingPicks({
    teamCount: 12,
    draftSlot: 1,
    rounds: 6,
    keeperRounds: [6],
    missingRounds: [2, 3, 4, 5],
    picksMade: 0,
  });
  // Only round 1 survives: 2-5 were traded, 6 went to a keeper.
  assert.deepEqual(slots, [{ round: 1, overall: 1 }]);
});

test("a fully drafted roster has no remaining picks", () => {
  const slots = remainingPicks({
    teamCount: 10,
    draftSlot: 1,
    rounds: 3,
    keeperRounds: [2],
    picksMade: 2,
  });
  assert.deepEqual(slots, []);
});

test("keeper rounds outside the draft change nothing", () => {
  const slots = remainingPicks({
    teamCount: 8,
    draftSlot: 4,
    rounds: 2,
    keeperRounds: [9],
    picksMade: 0,
  });
  assert.equal(slots.length, 2);
});
