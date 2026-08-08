import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, normalizeProfile, EMAIL_RE } from "./validateUser.js";

test("normalizeEmail lowercases, trims, and rejects junk", () => {
  assert.equal(normalizeEmail("  Player@Example.COM "), "player@example.com");
  assert.equal(normalizeEmail("player@example.com"), "player@example.com");
  assert.equal(normalizeEmail("no-at-sign"), null);
  assert.equal(normalizeEmail("no@tld"), null);
  assert.equal(normalizeEmail("two words@example.com"), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(42), null);
  assert.equal(normalizeEmail(`${"x".repeat(250)}@example.com`), null); // > 254 chars
});

test("EMAIL_RE matches the admin console's shape check", () => {
  assert.ok(EMAIL_RE.test("a@b.co"));
  assert.ok(!EMAIL_RE.test("a@b"));
});

test("normalizeProfile validates each field and drops unknown keys", () => {
  assert.deepEqual(normalizeProfile(undefined), { row: {} });
  assert.deepEqual(normalizeProfile(null), { row: {} });
  assert.deepEqual(normalizeProfile({}), { row: {} });
  assert.deepEqual(normalizeProfile({ junk: 1 }), { row: {} });
  // phone was dropped (never used by anything) — a stale client sending it is
  // just an unknown key now, not an error.
  assert.deepEqual(normalizeProfile({ phone: "(415) 555-1234" }), { row: {} });
  assert.deepEqual(normalizeProfile({ displayName: "  Sam  " }), { row: { displayName: "Sam" } });
  assert.deepEqual(normalizeProfile({ defaultTag: "ACE" }), { row: { defaultTag: "ACE" } });
  assert.deepEqual(
    normalizeProfile({ displayName: "", defaultTag: null }),
    { row: { displayName: null, defaultTag: null } } // explicit clears
  );
  assert.ok(normalizeProfile({ displayName: "x".repeat(41) }).error);
  assert.ok(normalizeProfile({ defaultTag: "toolong" }).error);
  assert.ok(normalizeProfile({ defaultTag: "FUK" }).error); // blocklist applies
  assert.ok(normalizeProfile([]).error);
  assert.ok(normalizeProfile("str").error);
});
