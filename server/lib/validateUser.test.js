import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, normalizePhone, normalizeProfile, EMAIL_RE } from "./validateUser.js";

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

test("normalizePhone strips separators and normalizes to E.164-ish", () => {
  assert.equal(normalizePhone("+14155551234"), "+14155551234");
  assert.equal(normalizePhone("(415) 555-1234"), "+14155551234"); // bare 10-digit -> +1
  assert.equal(normalizePhone("415.555.1234"), "+14155551234");
  assert.equal(normalizePhone("4155551234"), "+14155551234");
  assert.equal(normalizePhone("+442071234567"), "+442071234567");
  assert.equal(normalizePhone("442071234567"), "+442071234567"); // non-10-digit keeps its digits
  assert.equal(normalizePhone("1234567"), "+1234567"); // 7-digit minimum
  assert.equal(normalizePhone("123456"), null); // too short
  assert.equal(normalizePhone("1".repeat(16)), null); // too long
  assert.equal(normalizePhone("555-CALL-NOW"), null); // letters
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
});

test("normalizeProfile validates each field and drops unknown keys", () => {
  assert.deepEqual(normalizeProfile(undefined), { row: {} });
  assert.deepEqual(normalizeProfile(null), { row: {} });
  assert.deepEqual(normalizeProfile({}), { row: {} });
  assert.deepEqual(normalizeProfile({ junk: 1 }), { row: {} });
  assert.deepEqual(normalizeProfile({ phone: "(415) 555-1234" }), { row: { phone: "+14155551234" } });
  assert.deepEqual(normalizeProfile({ displayName: "  Sam  " }), { row: { displayName: "Sam" } });
  assert.deepEqual(normalizeProfile({ defaultTag: "ACE" }), { row: { defaultTag: "ACE" } });
  assert.deepEqual(
    normalizeProfile({ phone: null, displayName: "", defaultTag: null }),
    { row: { phone: null, displayName: null, defaultTag: null } } // explicit clears
  );
  assert.ok(normalizeProfile({ phone: "nope" }).error);
  assert.ok(normalizeProfile({ displayName: "x".repeat(41) }).error);
  assert.ok(normalizeProfile({ defaultTag: "toolong" }).error);
  assert.ok(normalizeProfile({ defaultTag: "FUK" }).error); // blocklist applies
  assert.ok(normalizeProfile([]).error);
  assert.ok(normalizeProfile("str").error);
});
