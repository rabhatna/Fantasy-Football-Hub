import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  DEFAULT_LEAGUE_SETTINGS,
  LeagueSettingsStore,
  sanitizeLeagueSettings,
} from "./settings.ts";

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "settings-test-"));
  filePath = path.join(dir, "league-settings.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a missing file reads as the defaults", async () => {
  const store = new LeagueSettingsStore(filePath);
  assert.deepEqual(await store.read(), DEFAULT_LEAGUE_SETTINGS);
});

test("write round-trips and survives a re-read from disk", async () => {
  const store = new LeagueSettingsStore(filePath);
  const custom = {
    ...DEFAULT_LEAGUE_SETTINGS,
    teamCount: 10,
    draftSlot: 3,
    scoring: "half_ppr" as const,
    roster: { ...DEFAULT_LEAGUE_SETTINGS.roster, WR: 3 },
  };
  await store.write(custom);
  assert.deepEqual(await store.read(), custom);

  const fresh = new LeagueSettingsStore(filePath);
  assert.deepEqual(await fresh.read(), custom);
});

test("broken JSON on disk falls back to defaults instead of throwing", async () => {
  await writeFile(filePath, "{not json", "utf8");
  const store = new LeagueSettingsStore(filePath);
  assert.deepEqual(await store.read(), DEFAULT_LEAGUE_SETTINGS);
});

test("invalidate picks up an external edit", async () => {
  const store = new LeagueSettingsStore(filePath);
  await store.write(DEFAULT_LEAGUE_SETTINGS);
  const onDisk = JSON.parse(await readFile(filePath, "utf8"));
  onDisk.teamCount = 14;
  await writeFile(filePath, JSON.stringify(onDisk), "utf8");

  assert.equal((await store.read()).teamCount, 12); // still cached
  store.invalidate();
  assert.equal((await store.read()).teamCount, 14);
});

test("sanitize repairs mangled fields one at a time", () => {
  const repaired = sanitizeLeagueSettings({
    teamCount: "twelve",
    scoring: "superflex",
    draftType: "auction",
    draftSlot: 99,
    roster: { QB: 1, RB: -2, WR: 3 },
  });
  assert.equal(repaired.teamCount, 12); // default: not a number
  assert.equal(repaired.scoring, "ppr"); // default: unknown format
  assert.equal(repaired.draftType, "auction"); // kept: valid
  assert.equal(repaired.draftSlot, 12); // clamped to teamCount
  assert.equal(repaired.roster.RB, 2); // default: negative
  assert.equal(repaired.roster.WR, 3); // kept: valid
  assert.equal(repaired.roster.BENCH, 6); // default: missing
});
