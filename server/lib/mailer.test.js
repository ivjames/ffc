import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDailyCap } from "./mailer.js";

test("blank/unset/garbage MAIL_DAILY_CAP falls back to the default", () => {
  // .env.example ships `MAIL_DAILY_CAP=` — an empty string must NOT become 0.
  assert.equal(resolveDailyCap(""), 500);
  assert.equal(resolveDailyCap("   "), 500);
  assert.equal(resolveDailyCap(undefined), 500);
  assert.equal(resolveDailyCap(null), 500);
  assert.equal(resolveDailyCap("not-a-number"), 500);
});

test("a real number overrides, and an explicit 0 is the kill switch", () => {
  assert.equal(resolveDailyCap("42"), 42);
  assert.equal(resolveDailyCap("0"), 0);
});
