import { test } from "node:test";
import assert from "node:assert/strict";
import { clampTs, TS_CLAMP_AHEAD_MS } from "./lww.js";

test("clampTs passes sane timestamps through", () => {
  const now = 1_700_000_000_000;
  assert.equal(clampTs(now - 5_000, now), now - 5_000); // past is fine (offline queue)
  assert.equal(clampTs(now, now), now);
  assert.equal(clampTs(now + 60_000, now), now + 60_000); // small skew tolerated
});

test("clampTs caps far-future clocks so a cell can't be locked forever", () => {
  const now = 1_700_000_000_000;
  const limit = now + TS_CLAMP_AHEAD_MS;
  assert.equal(clampTs(now + TS_CLAMP_AHEAD_MS + 1, now), limit);
  assert.equal(clampTs(now + 365 * 24 * 60 * 60 * 1000, now), limit);
});
