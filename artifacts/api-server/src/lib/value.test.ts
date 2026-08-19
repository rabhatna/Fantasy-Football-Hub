import assert from "node:assert/strict";
import { test } from "node:test";

import { consensusValueScores, type ValueScoreInput } from "./value.ts";

function rb(id: string, finish: number | null, adp: number | null): ValueScoreInput {
  return { id, position: "RB", productionFinish: finish, adpConsensus: adp };
}

test("production ahead of price scores positive, behind it negative", () => {
  // Finishes and prices agree except for two players who swap: the one who
  // finished 2nd but is priced 5th is value; the mirror image is a reach.
  const players = [
    rb("rb1", 1, 10),
    rb("rb2", 2, 50), // finished 2nd, priced last
    rb("rb3", 3, 30),
    rb("rb4", 4, 40),
    rb("rb5", 5, 20), // finished 5th, priced 2nd
  ];
  const scores = consensusValueScores(players);

  assert.ok((scores.get("rb2") ?? 0) > 0, "underpriced production should be positive");
  assert.ok((scores.get("rb5") ?? 0) < 0, "overpriced production should be negative");
  // The swap is symmetric, so the magnitudes mirror.
  assert.equal(scores.get("rb2"), -(scores.get("rb5") ?? 0));
});

test("perfect agreement between finish and price scores everyone near zero", () => {
  const players = [rb("a", 1, 5), rb("b", 2, 12), rb("c", 3, 22), rb("d", 4, 35)];
  const scores = consensusValueScores(players);
  for (const [, score] of scores) assert.equal(score, 0);
});

test("players missing a finish or a consensus price are left out, not zeroed", () => {
  const players = [
    rb("priced-only", null, 10),
    rb("finished-only", 2, null),
    rb("both-1", 1, 12),
    rb("both-2", 3, 14),
    rb("both-3", 4, 30),
  ];
  const scores = consensusValueScores(players);
  assert.equal(scores.has("priced-only"), false);
  assert.equal(scores.has("finished-only"), false);
  assert.equal(scores.size, 3);
});

test("positions are scored independently", () => {
  const players = [
    rb("rb1", 1, 40),
    rb("rb2", 2, 50),
    rb("rb3", 3, 60),
    { id: "wr1", position: "WR", productionFinish: 1, adpConsensus: 1 },
    { id: "wr2", position: "WR", productionFinish: 2, adpConsensus: 2 },
    { id: "wr3", position: "WR", productionFinish: 3, adpConsensus: 3 },
  ];
  const scores = consensusValueScores(players);
  // RBs are priced far later than WRs overall, but within-position order
  // matches finishes for both, so nobody is value or reach.
  for (const [, score] of scores) assert.equal(score, 0);
});

test("a one-player position cannot produce a score", () => {
  const scores = consensusValueScores([
    { id: "only-te", position: "TE", productionFinish: 1, adpConsensus: 20 },
  ]);
  assert.equal(scores.size, 0);
});
