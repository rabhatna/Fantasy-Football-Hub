import assert from "node:assert/strict";
import { test } from "node:test";

import { findSleepers, type SleeperCandidate } from "./sleepers.ts";

let nextId = 0;
function candidate(overrides: Partial<SleeperCandidate>): SleeperCandidate {
  nextId += 1;
  return {
    id: `p-${nextId}`,
    name: `Player ${nextId}`,
    team: "KC",
    position: "RB",
    // Rank and price agree by default, so the value signal only fires in
    // tests that deliberately separate them.
    rank: 100,
    adp: 100,
    adpConsensus: 100,
    ecrRank: null,
    depthRank: null,
    injuryStatus: null,
    age: 27,
    isRookie: false,
    share: null,
    projectedPoints: null,
    ppg: null,
    nextGen: { ryoe: null, separation: null },
    consistency: { median: null, ceiling: null },
    ...overrides,
  };
}

function run(players: SleeperCandidate[], unavailable: string[] = []) {
  return findSleepers({ players, unavailableIds: new Set(unavailable), teamCount: 12 });
}

test("a handcuff behind a hurt starter is the loudest sleeper", () => {
  const starter = candidate({ name: "Hurt Starter", depthRank: 1, injuryStatus: "IR", adpConsensus: 30 });
  const backup = candidate({ name: "Next Man Up", depthRank: 2, rank: 130, adpConsensus: 130 });
  const nobody = candidate({ name: "Veteran Depth", rank: 130, adpConsensus: 130 });
  const picks = run([starter, backup, nobody]);

  assert.equal(picks[0]?.name, "Next Man Up");
  assert.ok(picks[0].tags.includes("handcuff"));
  assert.ok(picks[0].reasons.some((reason) => reason.includes("Hurt Starter is IR")));
  // The uninteresting veteran has no argument at all.
  assert.ok(!picks.some((pick) => pick.name === "Veteran Depth"));
});

test("rookies are always listed, but an early-priced rookie carries no sleeper score", () => {
  const earlyRookie = candidate({ name: "First Rounder", isRookie: true, age: 22, adpConsensus: 8 });
  const lateRookie = candidate({ name: "Late Rookie", isRookie: true, age: 22, adpConsensus: 120, depthRank: 2 });
  const picks = run([earlyRookie, lateRookie]);

  const early = picks.find((pick) => pick.name === "First Rounder");
  const late = picks.find((pick) => pick.name === "Late Rookie");
  assert.ok(early && early.tags.includes("rookie"));
  assert.ok(late && late.score > (early.score ?? 0));
});

test("a committee back with real touches gets tagged and explained", () => {
  const committee = candidate({ name: "Committee Back", share: 32, rank: 95, adpConsensus: 95 });
  const picks = run([committee]);
  assert.ok(picks[0]?.tags.includes("committee"));
  assert.ok(picks[0].reasons.some((reason) => reason.includes("32%")));
});

test("late price against a much better rank reads as value", () => {
  const value = candidate({ name: "Faller", ecrRank: 55, adpConsensus: 110 });
  const fair = candidate({ name: "Priced Right", ecrRank: 110, adpConsensus: 110 });
  const picks = run([value, fair]);
  assert.ok(picks.find((pick) => pick.name === "Faller")?.tags.includes("value"));
  assert.ok(!picks.some((pick) => pick.name === "Priced Right"));
});

test("hurt players and already-owned players are never sleepers", () => {
  const hurt = candidate({ name: "On IR", injuryStatus: "IR", isRookie: true, adpConsensus: 150 });
  const owned = candidate({ name: "Already Kept", isRookie: true, adpConsensus: 150 });
  const picks = run([hurt, owned], [owned.id]);
  assert.deepEqual(picks.map((pick) => pick.name), []);
});

test("the list runs deep but still caps at 60", () => {
  // 70 late-priced year-two players, every one carrying a real argument.
  const pool = Array.from({ length: 70 }, (_, index) =>
    candidate({ age: 23, rank: 80 + index, adpConsensus: 80 + index }),
  );
  const picks = run(pool);
  assert.equal(picks.length, 60);
});

test("a single real signal at a late price makes the deep list", () => {
  const starter = candidate({ name: "Healthy Starter", depthRank: 1, adpConsensus: 30 });
  const cuff = candidate({ name: "Quiet Handcuff", depthRank: 2, rank: 140, adpConsensus: 140 });
  const picks = run([starter, cuff]);
  const pick = picks.find((entry) => entry.name === "Quiet Handcuff");
  assert.ok(pick && pick.tags.includes("handcuff"));
});

test("an early-career efficiency flash beats an anonymous veteran at the same price", () => {
  const young = candidate({
    name: "Year Two Leap",
    age: 23,
    rank: 100,
    adpConsensus: 100,
    nextGen: { ryoe: 60, separation: null },
    consistency: { median: 8, ceiling: 24 },
  });
  const veteran = candidate({ name: "Old Depth", age: 29, rank: 100, adpConsensus: 100 });
  const picks = run([young, veteran]);

  assert.equal(picks[0]?.name, "Year Two Leap");
  assert.ok(picks[0].tags.includes("early-career"));
  assert.ok(picks[0].tags.includes("boom"));
  assert.ok(!picks.some((pick) => pick.name === "Old Depth"));
});
