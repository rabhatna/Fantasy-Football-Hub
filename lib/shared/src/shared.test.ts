import assert from "node:assert/strict";
import { test } from "node:test";

import { isUnavailableStatus } from "./index.ts";

test("unavailable statuses match regardless of case or padding", () => {
  assert.equal(isUnavailableStatus("IR"), true);
  assert.equal(isUnavailableStatus("ir"), true);
  assert.equal(isUnavailableStatus(" Doubtful "), true);
  assert.equal(isUnavailableStatus("PUP"), true);
  assert.equal(isUnavailableStatus("out"), true);
});

test("unknown is not unavailable", () => {
  assert.equal(isUnavailableStatus(null), false);
  assert.equal(isUnavailableStatus(undefined), false);
  assert.equal(isUnavailableStatus(""), false);
});

test("statuses that keep a player draftable are not unavailable", () => {
  assert.equal(isUnavailableStatus("Questionable"), false);
  assert.equal(isUnavailableStatus("Active"), false);
  assert.equal(isUnavailableStatus("Suspended"), false);
  assert.equal(isUnavailableStatus("Did Not Report"), false);
});
