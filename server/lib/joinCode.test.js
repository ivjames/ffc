import { test } from "node:test";
import assert from "node:assert/strict";
import { generateJoinCode, normalizeJoinCode, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "./joinCode.js";

test("generated codes are 6 chars from the unambiguous alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateJoinCode();
    assert.equal(code.length, JOIN_CODE_LENGTH);
    for (const ch of code) assert.ok(JOIN_CODE_ALPHABET.includes(ch), `bad char ${ch}`);
    // The lookalike letters are never emitted.
    assert.ok(!/[ILOU]/.test(code));
  }
});

test("normalize uppercases, strips separators, and maps lookalikes", () => {
  assert.equal(normalizeJoinCode("abc234"), "ABC234");
  assert.equal(normalizeJoinCode(" AB C-234 "), "ABC234");
  assert.equal(normalizeJoinCode("OIL234"), "011234"); // O->0, I->1, L->1
  assert.equal(normalizeJoinCode("abc23"), null); // too short
  assert.equal(normalizeJoinCode("abc2345"), null); // too long
  assert.equal(normalizeJoinCode("ABC23U"), null); // U excluded and unmapped
  assert.equal(normalizeJoinCode("ABC23!"), null);
  assert.equal(normalizeJoinCode(""), null);
  assert.equal(normalizeJoinCode(null), null);
});

test("round-trip: every generated code normalizes to itself", () => {
  for (let i = 0; i < 100; i++) {
    const code = generateJoinCode();
    assert.equal(normalizeJoinCode(code), code);
  }
});
