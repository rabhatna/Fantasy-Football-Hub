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

test("a QB round gate keeps quarterbacks out of the early rounds entirely", () => {
  const slots = run({ tuning: { qbFromRound: 8 } });
  for (const slot of slots.filter((entry) => entry.round < 8)) {
    assert.ok(
      slot.options.every((option) => option.position !== "QB"),
      `round ${slot.round} proposed a QB despite the gate`,
    );
  }
  // The starting QB still gets planned once the gate opens.
  const laterQb = slots.some(
    (slot) => slot.round >= 8 && slot.options.some((option) => option.position === "QB"),
  );
  assert.ok(laterQb);
});

test("position bias leans the plan without breaking it", () => {
  const neutral = run();
  const teHeavy = run({ tuning: { positionBias: { TE: 1.5, RB: 0.5 } } });
  const count = (slots: ReturnType<typeof run>, position: string) =>
    slots.filter((slot) => slot.options[0]?.position === position).length;
  assert.ok(count(teHeavy, "TE") >= count(neutral, "TE"));
  assert.ok(count(teHeavy, "RB") <= count(neutral, "RB"));
});

test("safe risk raises the availability floor; upside lowers it", () => {
  const safe = run({ tuning: { risk: "safe" } });
  const upside = run({ tuning: { risk: "upside" } });
  const minAvailability = (slots: ReturnType<typeof run>) =>
    Math.min(...slots.flatMap((slot) => slot.options.map((option) => option.availability)));
  assert.ok(minAvailability(safe) >= 0.4);
  assert.ok(minAvailability(upside) < minAvailability(safe));
});

test("options per slot is respected and clamped", () => {
  const two = run({ tuning: { optionsPerSlot: 2 } });
  assert.ok(two.filter((slot) => slot.note === null).every((slot) => slot.options.length <= 2));
  const clamped = run({ tuning: { optionsPerSlot: 99 } });
  assert.ok(clamped.every((slot) => slot.options.length <= 6));
});

test("a starred player beats his identical twin and says why", () => {
  const players = board() as (ReturnType<typeof player> & { targeted?: boolean })[];
  // Two same-priced WRs mid-board; star the second one.
  const twins = players.filter((entry) => entry.position === "WR" && entry.adp > 55 && entry.adp < 70);
  twins[1].targeted = true;
  const slots = run({ players });
  const slot = slots.find((entry) => entry.options.some((option) => option.playerId === twins[1].id));
  assert.ok(slot, "the starred player made the plan");
  const option = slot.options.find((entry) => entry.playerId === twins[1].id);
  assert.ok(option?.targeted);
  assert.ok(option?.signals.includes("your guy"));
});

test("a starred longshot is forced into the slot nearest his price", () => {
  const players = board() as (ReturnType<typeof player> & {
    targeted?: boolean;
    projectedPoints: number;
  })[];
  // A late-priced player projected so badly he would never crack the options.
  const longshot = players.find((entry) => entry.adp === 90)!;
  longshot.targeted = true;
  longshot.projectedPoints = 1;
  const slots = run({ players });
  const planned = slots.find((slot) =>
    slot.options.some((option) => option.playerId === longshot.id),
  );
  assert.ok(planned, "the starred longshot was planned somewhere");
  // ...and not rounds before his price: pick + reach/2 must reach ADP 90.
  assert.ok(planned.overall + 12 >= 90);
});

test("O-line shading hits low-target backs only, and names itself", () => {
  const players = board() as (ReturnType<typeof player> & {
    oLineScore?: number | null;
    targetsPerGame?: number | null;
  })[];
  for (const entry of players) {
    if (entry.position !== "RB") continue;
    entry.oLineScore = 80;
    entry.targetsPerGame = 1;
  }
  const slots = run({ players });
  const rbOptions = slots.flatMap((slot) => slot.options).filter((o) => o.position === "RB");
  assert.ok(rbOptions.some((option) => option.signals.includes("elite line")));

  // A pass-catching back on the same line carries no line signal.
  const insulated = board() as typeof players;
  for (const entry of insulated) {
    if (entry.position !== "RB") continue;
    entry.oLineScore = 80;
    entry.targetsPerGame = 5;
  }
  const insulatedOptions = run({ players: insulated })
    .flatMap((slot) => slot.options)
    .filter((option) => option.position === "RB");
  assert.ok(insulatedOptions.every((option) => !option.signals.includes("elite line")));
});

test("regression flags and sleeper scores surface as signals", () => {
  const players = board() as (ReturnType<typeof player> & {
    tdOverExpected?: number | null;
    sleeperScore?: number | null;
    sleeperTags?: string[];
    isRookie?: boolean;
  })[];
  const rebound = players.find((entry) => entry.adp === 40)!;
  rebound.tdOverExpected = -4;
  const sleeper = players.find((entry) => entry.adp === 80)!;
  sleeper.sleeperScore = 0.5;
  sleeper.sleeperTags = ["rookie"];
  sleeper.isRookie = true;

  const options = run({ players }).flatMap((slot) => slot.options);
  assert.ok(options.find((o) => o.playerId === rebound.id)?.signals.includes("TD rebound"));
  const sleeperOption = options.find((o) => o.playerId === sleeper.id);
  assert.ok(sleeperOption?.signals.includes("sleeper"));
  assert.ok(sleeperOption?.isRookie);
});

test("a starred player priced before the first pick rides slot one as a faller", () => {
  const players = board() as (ReturnType<typeof player> & { targeted?: boolean })[];
  // Picks start at overall 12 (a late first-round slot): the board's very
  // first player (ADP 1) is realistically gone — about 3% survival.
  const faller = players[0];
  faller.targeted = true;
  const slots = run({
    players,
    myNextPicks: Array.from({ length: 15 }, (_, index) => ({
      round: index + 1,
      overall: index * 12 + 12,
    })),
  });
  const first = slots[0];
  const option = first.options.find((entry) => entry.playerId === faller.id);
  assert.ok(option, "the faller is planned in the first slot");
  assert.ok(option.signals.includes("if he falls"));
  assert.ok(option.signals.includes("your guy"));
  // ...but never as the primary: a 1-in-50 flyer must not displace the pick.
  assert.notEqual(first.options[0]?.playerId, faller.id);
  // And he appears exactly once across the plan.
  const appearances = slots.flatMap((slot) =>
    slot.options.filter((entry) => entry.playerId === faller.id),
  );
  assert.equal(appearances.length, 1);
});

test("two starred fallers both ride the first pick together", () => {
  const players = board() as (ReturnType<typeof player> & { targeted?: boolean })[];
  players[0].targeted = true; // ADP 1
  players[1].targeted = true; // ADP 2
  const slots = run({
    players,
    myNextPicks: Array.from({ length: 15 }, (_, index) => ({
      round: index + 1,
      overall: index * 12 + 12,
    })),
  });
  const firstIds = slots[0].options.map((option) => option.playerId);
  assert.ok(firstIds.includes(players[0].id));
  assert.ok(firstIds.includes(players[1].id));
});

test("an unstarred player below the availability floor still vanishes", () => {
  const slots = run();
  const first = slots[0];
  // Nobody in the first slot should carry the faller flag without a star.
  assert.ok(first.options.every((option) => !option.signals.includes("if he falls")));
});

test("empty tuning reproduces the stock plan exactly", () => {
  // The factory's ids differ between boards, so compare the plan's shape:
  // same rounds, same positions, prices and odds in the same order.
  const shape = (slots: ReturnType<typeof run>) =>
    slots.map((slot) => ({
      round: slot.round,
      note: slot.note,
      options: slot.options.map((option) => ({
        position: option.position,
        adp: option.adp,
        availability: option.availability,
        role: option.role,
      })),
    }));
  assert.deepEqual(shape(run({ tuning: {} })), shape(run()));
});
