import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTag, validateTags, BLOCKLIST } from "./sanitize.js";

test("isValidTag accepts exactly 3 uppercase alphanumeric chars", () => {
  assert.equal(isValidTag("ABC"), true);
  assert.equal(isValidTag("A1B"), true);
  assert.equal(isValidTag("007"), true);
});

test("isValidTag rejects wrong length, lowercase, and non-string input", () => {
  assert.equal(isValidTag("AB"), false);
  assert.equal(isValidTag("ABCD"), false);
  assert.equal(isValidTag("abc"), false); // exact-bytes check, not case-insensitive
  assert.equal(isValidTag(""), false);
  assert.equal(isValidTag(null), false);
  assert.equal(isValidTag(undefined), false);
  assert.equal(isValidTag(123), false);
});

test("isValidTag rejects every blocklisted combo", () => {
  for (const bad of BLOCKLIST) {
    assert.equal(isValidTag(bad), false, `expected ${bad} to be blocked`);
  }
});

test("isValidTag does not blocklist a lowercase blocked combo (exact-bytes rule)", () => {
  // Documents the intentional behavior in the docstring: since the DB/clients
  // always send uppercase tags, a lowercased blocklist entry is NOT caught here
  // — it's rejected instead by the TAG_RE charset check (lowercase isn't A-Z0-9).
  assert.equal(isValidTag("ass".toUpperCase()), false); // "ASS" -> blocked
  assert.equal(isValidTag("ass"), false); // lowercase -> charset rejects it anyway
});

test("validateTags requires an array of 1..4 valid tags", () => {
  assert.deepEqual(validateTags(["ABC"]), { ok: true });
  assert.deepEqual(validateTags(["ABC", "DEF", "GHI", "JKL"]), { ok: true });
  assert.equal(validateTags("ABC").ok, false);
  assert.equal(validateTags([]).ok, false);
  assert.equal(validateTags(["A", "B", "C", "D", "E"]).ok, false);
});

test("validateTags rejects if any single tag is invalid or blocked", () => {
  const result = validateTags(["ABC", "FUK"]);
  assert.equal(result.ok, false);
  assert.match(result.error, /FUK/);
});
