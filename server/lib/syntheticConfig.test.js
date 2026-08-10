// Unit coverage for the synthetic-round runtime policy (no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  syntheticMintsRewards,
  syntheticCountsOnBoard,
  boardSyntheticFilter,
  resolveSynthetic,
} from "./syntheticConfig.js";

test("flags default to ON (full-path testing)", () => {
  assert.equal(syntheticMintsRewards({}), true);
  assert.equal(syntheticCountsOnBoard({}), true);
});

test("only falsey spellings turn a flag off; anything else stays on", () => {
  for (const off of ["false", "0", "no", "off", "FALSE", " Off "]) {
    assert.equal(syntheticMintsRewards({ SYNTHETIC_MINT_REWARDS: off }), false, off);
    assert.equal(syntheticCountsOnBoard({ SYNTHETIC_COUNT_ON_BOARD: off }), false, off);
  }
  for (const on of ["true", "1", "yes", "", undefined, "anything"]) {
    assert.equal(syntheticMintsRewards({ SYNTHETIC_MINT_REWARDS: on }), true, String(on));
  }
});

test("boardSyntheticFilter is empty by default, excludes when off", () => {
  assert.equal(boardSyntheticFilter("r", {}), "");
  assert.equal(
    boardSyntheticFilter("r", { SYNTHETIC_COUNT_ON_BOARD: "false" }),
    "and not r.synthetic"
  );
  // alias is honoured (caller-chosen literal)
  assert.equal(
    boardSyntheticFilter("rr", { SYNTHETIC_COUNT_ON_BOARD: "0" }),
    "and not rr.synthetic"
  );
});

test("resolveSynthetic: absent/false request is a normal real round", () => {
  assert.deepEqual(resolveSynthetic(undefined, undefined, {}), { ok: true, synthetic: false });
  assert.deepEqual(resolveSynthetic(false, "whatever", {}), { ok: true, synthetic: false });
  // Only the boolean literal true counts as a request — truthy junk does not.
  assert.deepEqual(resolveSynthetic("true", "x", { SYNTHETIC_BOT_KEY: "k" }), {
    ok: true,
    synthetic: false,
  });
});

test("resolveSynthetic: synthetic:true is rejected when the feature is off (no key set)", () => {
  const r = resolveSynthetic(true, "anything", {});
  assert.equal(r.ok, false);
  assert.match(r.error, /not enabled/);
});

test("resolveSynthetic: synthetic:true needs the matching key", () => {
  const env = { SYNTHETIC_BOT_KEY: "s3cret" };
  assert.equal(resolveSynthetic(true, "wrong", env).ok, false);
  assert.equal(resolveSynthetic(true, undefined, env).ok, false);
  assert.deepEqual(resolveSynthetic(true, "s3cret", env), { ok: true, synthetic: true });
});
