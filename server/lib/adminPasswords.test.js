import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, verifyDummyPassword } from "./adminPasswords.js";

test("hashPassword produces a salt:hash pair, never the plaintext", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.ok(!stored.includes("correct horse battery staple"));
});

test("hashPassword salts each call independently (same password, different stored values)", () => {
  const a = hashPassword("same-password");
  const b = hashPassword("same-password");
  assert.notEqual(a, b);
});

test("verifyPassword accepts the correct password and rejects a wrong one", () => {
  const stored = hashPassword("my-secret-password");
  assert.equal(verifyPassword("my-secret-password", stored), true);
  assert.equal(verifyPassword("wrong-password", stored), false);
});

test("verifyPassword rejects malformed/missing stored values instead of throwing", () => {
  assert.equal(verifyPassword("x", null), false);
  assert.equal(verifyPassword("x", undefined), false);
  assert.equal(verifyPassword("x", ""), false);
  assert.equal(verifyPassword("x", "no-colon-here"), false);
});

test("verifyDummyPassword runs without throwing (timing-uniformity helper)", () => {
  assert.doesNotThrow(() => verifyDummyPassword("whatever"));
});
