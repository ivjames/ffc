import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHuntItem } from "./validateHuntItem.js";

const COURSE_ID = "a1111111-1111-4111-8111-111111111111";

function validBody(overrides = {}) {
  return {
    courseId: COURSE_ID,
    slug: "windmill",
    name: "The windmill",
    ...overrides,
  };
}

test("normalizeHuntItem accepts a minimal valid body and applies defaults", () => {
  const result = normalizeHuntItem(validBody());
  assert.equal(result.error, undefined);
  assert.equal(result.row.hint, null);
  assert.equal(result.row.extraPrompt, null);
  assert.equal(result.row.sortOrder, 0);
  assert.equal(result.row.active, true);
  assert.equal(result.row.countable, false);
});

test("normalizeHuntItem rejects a non-object body", () => {
  assert.match(normalizeHuntItem(null).error, /must be an object/);
  assert.match(normalizeHuntItem("x").error, /must be an object/);
});

test("normalizeHuntItem requires a uuid courseId", () => {
  assert.match(normalizeHuntItem(validBody({ courseId: "nope" })).error, /courseId/);
  assert.match(normalizeHuntItem(validBody({ courseId: undefined })).error, /courseId/);
});

test("normalizeHuntItem enforces the slug shape", () => {
  for (const slug of ["", "Has Caps", "spa ce", "-leading", "a".repeat(41)]) {
    assert.match(normalizeHuntItem(validBody({ slug })).error, /slug/, `slug ${JSON.stringify(slug)}`);
  }
  assert.equal(normalizeHuntItem(validBody({ slug: "green-door-2" })).error, undefined);
});

test("normalizeHuntItem requires a non-empty name and trims it", () => {
  assert.match(normalizeHuntItem(validBody({ name: "" })).error, /name/);
  assert.match(normalizeHuntItem(validBody({ name: "   " })).error, /name/);
  assert.match(normalizeHuntItem(validBody({ name: "x".repeat(121) })).error, /name/);
  assert.equal(normalizeHuntItem(validBody({ name: "  Padded  " })).row.name, "Padded");
});

test("normalizeHuntItem normalizes empty hint/extraPrompt to null and bounds them", () => {
  const result = normalizeHuntItem(validBody({ hint: "  ", extraPrompt: "" }));
  assert.equal(result.row.hint, null);
  assert.equal(result.row.extraPrompt, null);
  assert.match(normalizeHuntItem(validBody({ hint: "x".repeat(501) })).error, /hint/);
  assert.match(normalizeHuntItem(validBody({ extraPrompt: "x".repeat(2001) })).error, /extraPrompt/);
  assert.match(normalizeHuntItem(validBody({ extraPrompt: 42 })).error, /extraPrompt/);
});

test("normalizeHuntItem validates sortOrder and the boolean flags", () => {
  assert.match(normalizeHuntItem(validBody({ sortOrder: 1.5 })).error, /sortOrder/);
  assert.match(normalizeHuntItem(validBody({ active: "yes" })).error, /active/);
  assert.match(normalizeHuntItem(validBody({ countable: 1 })).error, /countable/);
  const result = normalizeHuntItem(
    validBody({ sortOrder: 30, active: false, countable: true })
  );
  assert.equal(result.row.sortOrder, 30);
  assert.equal(result.row.active, false);
  assert.equal(result.row.countable, true);
});
