import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { normalizeName, parseSnapshot } from "./index.ts";
import { normalize, percent, weightedAverage } from "./fields.ts";

const masterCsv = path.resolve(
  fileURLToPath(import.meta.url),
  "..", "..", "..", "..",
  "datasets/2026-08-14/master.csv",
);

const snapshot = parseSnapshot(await readFile(masterCsv, "utf8"));

describe("field readers", () => {
  test("blank stays null instead of collapsing to zero", () => {
    for (const blank of ["", "  ", "nan", "NA", "None"]) {
      assert.equal(percent({ x: blank }, "x"), null);
    }
    assert.equal(percent({ x: "0" }, "x"), 0, "a real zero must survive as zero");
  });

  test("normalize clamps out-of-range values rather than exceeding the scale", () => {
    assert.equal(normalize(2.2, 2.2, 3.7), 0);
    assert.equal(normalize(3.7, 2.2, 3.7), 100);
    assert.equal(normalize(9, 2.2, 3.7), 100);
    assert.equal(normalize(0.09, 0.09, 0.27, { invert: true }), 100);
    assert.equal(normalize(null, 0, 1), null);
  });

  test("weightedAverage renormalises over present parts only", () => {
    assert.equal(
      weightedAverage([
        { value: 100, weight: 0.5 },
        { value: null, weight: 0.5 },
      ]),
      100,
      "a missing component must not drag the score toward zero",
    );
    assert.equal(weightedAverage([{ value: null, weight: 1 }]), null);
  });

  test("normalizeName matches across suffixes, case and punctuation", () => {
    assert.equal(normalizeName("Ja'Marr Chase"), normalizeName("JaMarr Chase"));
    assert.equal(normalizeName("Marvin Harrison Jr."), normalizeName("marvin harrison"));
    assert.equal(normalizeName("Amon-Ra St. Brown"), "amonra st brown");
    // Spreadsheet users write surnames first; a board edited in Excel must
    // still re-link.
    assert.equal(normalizeName("Lamb, CeeDee"), normalizeName("CeeDee Lamb"));
  });
});

describe("snapshot", () => {
  test("loads all 250 players with no skipped rows", () => {
    assert.deepEqual(snapshot.skipped, []);
    assert.equal(snapshot.players.length, 250);
  });

  test("player ids are stable gsis ids, unique across the board", () => {
    const ids = new Set(snapshot.players.map((player) => player.id));
    assert.equal(ids.size, 250);
    assert.match(snapshot.players[0].id, /^00-\d{7}$/);
  });

  test("the board is real players, not generated names", () => {
    const top = snapshot.players.slice(0, 3).map((player) => player.name);
    assert.ok(
      top.every((name) => typeof name === "string" && name.length > 0),
      "expected real names",
    );
    // The generator paired first and last name pools, producing collisions like
    // "Mack Robinson" and "DK Jones". Nothing that came out of it should remain.
    const names = new Set(snapshot.players.map((player) => player.name));
    for (const fabricated of ["Mack Robinson", "Matt Lee", "DK Jones", "Samaje Ekeler"]) {
      assert.ok(!names.has(fabricated), `${fabricated} is a generated name and must be gone`);
    }
  });

  test("rookies keep null production rather than a fabricated zero", () => {
    const rookies = snapshot.players.filter((player) => player.isRookie);
    assert.ok(rookies.length > 0, "expected rookies in a 2026 board");

    const withoutProduction = rookies.filter((player) => player.ppg === null);
    assert.ok(withoutProduction.length > 0);

    for (const rookie of withoutProduction) {
      assert.equal(rookie.ppg, null);
      assert.equal(rookie.productionFinish, null);
      assert.equal(rookie.durabilityScore, null, "no snaps means durability is unknown, not 0");
      assert.equal(rookie.consistency.floor, null);
    }
  });

  test("next-gen metrics are null for positions they are not recorded for", () => {
    const backs = snapshot.players.filter((player) => player.position === "RB");
    const receivers = snapshot.players.filter((player) => player.position === "WR");

    assert.ok(backs.every((player) => player.nextGen.separation === null));
    assert.ok(receivers.every((player) => player.nextGen.ryoe === null));

    // ...but the metrics that *do* apply are actually populated for some.
    assert.ok(backs.some((player) => player.nextGen.ryoe !== null));
    assert.ok(receivers.some((player) => player.nextGen.separation !== null));
  });

  test("value score keeps its real sign and magnitude in standard deviations", () => {
    const scores = snapshot.players
      .map((player) => player.valueScore)
      .filter((score): score is number => score !== null);

    assert.ok(scores.some((score) => score < 0), "expected negatively valued players");
    assert.ok(Math.min(...scores) > -5 && Math.max(...scores) < 5, "expected z-score scale");
  });

  test("every player carries a bye week and an ADP", () => {
    assert.ok(snapshot.players.every((player) => player.adp > 0));
    const withBye = snapshot.players.filter((player) => player.byeWeek !== null);
    assert.ok(withBye.length >= 249);
  });

  test("share uses carries for backs and targets for receivers, and skips passers", () => {
    assert.ok(snapshot.players.filter((p) => p.position === "QB").every((p) => p.share === null));
    assert.ok(snapshot.players.some((p) => p.position === "RB" && (p.share ?? 0) > 0));
    assert.ok(snapshot.players.some((p) => p.position === "WR" && (p.share ?? 0) > 0));
  });

  test("injury status is null everywhere, because the dataset has none", () => {
    assert.ok(snapshot.players.every((player) => player.injuryStatus === null));
  });
});

describe("teams", () => {
  test("produces all 32 teams with readable names", () => {
    assert.equal(snapshot.teams.length, 32);
    const detroit = snapshot.teams.find((team) => team.team === "DET");
    assert.equal(detroit?.fullName, "Detroit Lions");
  });

  test("composite scores use the full range under real inputs", () => {
    const scores = snapshot.teams
      .map((team) => team.compositeScore)
      .filter((score): score is number => score !== null);

    assert.equal(scores.length, 32);
    // The previous calibration was built for generated data and pinned every
    // real team near or below zero. Guard against regressing to that.
    assert.ok(Math.min(...scores) > 0, "no team should score zero on real data");
    assert.ok(Math.max(...scores) > 55, "the best line should score well");
    assert.ok(Math.max(...scores) - Math.min(...scores) > 25, "expected real spread");
  });

  test("teams are ranked best line first and tiered", () => {
    const scores = snapshot.teams.map((team) => team.compositeScore ?? -1);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.ok(snapshot.teams.every((team) => team.tier !== "Unrated"));
  });

  test("percentages are percentages, not fractions", () => {
    for (const team of snapshot.teams) {
      assert.ok((team.snapContinuity ?? 0) > 1, `${team.team} continuity looks like a fraction`);
      assert.ok((team.stuffRate ?? 0) > 1, `${team.team} stuff rate looks like a fraction`);
    }
  });
});
