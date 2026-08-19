import assert from "node:assert/strict";
import { test } from "node:test";

import { positionalNeeds, recommend, type RecommendablePlayer } from "./recommend.ts";

const ROSTER = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 };

let nextId = 0;
function player(overrides: Partial<RecommendablePlayer>): RecommendablePlayer {
  nextId += 1;
  return {
    id: `p-${nextId}`,
    name: `Player ${nextId}`,
    team: "KC",
    position: "RB",
    rank: nextId,
    tier: 3,
    adp: 30,
    adpConsensus: 30,
    adpConsensusStdev: 4,
    valueScore: 0,
    valueScoreConsensus: 0,
    projectedPoints: 200,
    ppg: null,
    injuryStatus: null,
    byeWeek: 7,
    ...overrides,
  };
}

function inputFor(players: RecommendablePlayer[], overrides: Record<string, unknown> = {}) {
  return {
    players,
    unavailableIds: new Set<string>(),
    myRoster: [],
    roster: ROSTER,
    myNextPicks: [6, 19, 30],
    ...overrides,
  };
}

test("positional needs saturate and spill into flex", () => {
  const needs = positionalNeeds(ROSTER, [
    { position: "RB" },
    { position: "RB" },
    { position: "RB" }, // third RB eats the flex
    { position: "QB" },
  ]);
  assert.deepEqual(needs, { QB: 0, RB: 0, WR: 2, TE: 1, FLEX: 0 });
});

test("a player about to be sniped outranks an identical safe one", () => {
  const urgent = player({ name: "Urgent", adpConsensus: 10, adpConsensusStdev: 3 });
  const safe = player({ name: "Safe", adpConsensus: 80, adpConsensusStdev: 3 });
  const result = recommend(inputFor([urgent, safe], { myNextPicks: [6, 19] }));

  assert.equal(result[0].name, "Urgent");
  const reason = result[0].reasons.find((text) => text.includes("your next pick"));
  assert.ok(reason, "urgency should be explained");
});

test("a filled position falls behind an open one", () => {
  const rb = player({ position: "RB", name: "The RB" });
  const wr = player({ position: "WR", name: "The WR" });
  // RBs and flex are full; WR is wide open.
  const myRoster = [
    { position: "RB", byeWeek: 5 },
    { position: "RB", byeWeek: 6 },
    { position: "TE", byeWeek: 9 },
  ];
  const result = recommend(inputFor([rb, wr], { myRoster }));
  assert.equal(result[0].name, "The WR");
});

test("unavailable players and keepers never appear", () => {
  const kept = player({ name: "Kept" });
  const free = player({ name: "Free" });
  const result = recommend(inputFor([kept, free], { unavailableIds: new Set([kept.id]) }));
  assert.deepEqual(result.map((entry) => entry.name), ["Free"]);
});

test("an injury designation drags a player down hard", () => {
  const hurt = player({ name: "Hurt", injuryStatus: "IR", valueScoreConsensus: 1.5 });
  const healthy = player({ name: "Healthy", valueScoreConsensus: 0 });
  const result = recommend(inputFor([hurt, healthy]));

  assert.equal(result[0].name, "Healthy");
  const hurtEntry = result.find((entry) => entry.name === "Hurt");
  assert.ok(hurtEntry && hurtEntry.components.injury < 0);
  assert.ok(hurtEntry.reasons.some((text) => text.includes("IR")));
});

test("a tier cliff is called out with the drop", () => {
  const lastOfTier = player({ name: "Cliff", tier: 2, projectedPoints: 260 });
  const nextTier = player({ name: "After the drop", tier: 3, projectedPoints: 200 });
  const result = recommend(inputFor([lastOfTier, nextTier]));

  const cliff = result.find((entry) => entry.name === "Cliff");
  assert.ok(cliff);
  assert.ok(
    cliff.reasons.some((text) => text.includes("tier 2") && text.includes("60-pt drop")),
    `expected a tier-cliff reason, got: ${cliff.reasons.join(" | ")}`,
  );
});

test("bye overlap with a same-position starter is penalised and explained", () => {
  const clash = player({ name: "Clash", byeWeek: 9 });
  const clear = player({ name: "Clear", byeWeek: 11 });
  const myRoster = [{ position: "RB", byeWeek: 9 }];
  const result = recommend(inputFor([clash, clear], { myRoster }));

  assert.equal(result[0].name, "Clear");
  const clashEntry = result.find((entry) => entry.name === "Clash");
  assert.ok(clashEntry && clashEntry.components.bye < 0);
});

test("a player with nothing known contributes no invented reasons", () => {
  const unknown = player({
    name: "Mystery",
    adpConsensus: null,
    adpConsensusStdev: null,
    valueScore: null,
    valueScoreConsensus: null,
    projectedPoints: null,
    ppg: null,
    injuryStatus: null,
    byeWeek: null,
  });
  const result = recommend(inputFor([unknown]));
  assert.equal(result.length, 1);
  // The only reason should be the roster need, which is real.
  assert.deepEqual(result[0].reasons, ["Fills an open RB spot"]);
});

test("a full roster recommends nothing", () => {
  assert.deepEqual(recommend(inputFor([player({})], { myNextPicks: [] })), []);
});
