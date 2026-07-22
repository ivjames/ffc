import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCourse } from "./validateCourse.js";

const VALID_PARS = Array(18).fill(3);

function validSeed(overrides = {}) {
  return {
    name: "Blue Course",
    theme: "california",
    pars: VALID_PARS,
    ...overrides,
  };
}

test("normalizeCourse accepts a minimal valid seed and defaults holeCount/sortOrder", () => {
  const result = normalizeCourse(validSeed());
  assert.equal(result.error, undefined);
  assert.equal(result.row.holeCount, 18);
  assert.equal(result.row.sortOrder, 0);
  assert.equal(result.row.locationId, null);
  assert.deepEqual(result.row.pars, VALID_PARS);
});

test("normalizeCourse rejects a non-object seed", () => {
  assert.match(normalizeCourse(null).error, /must be an object/);
  assert.match(normalizeCourse("x").error, /must be an object/);
});

test("normalizeCourse requires name and theme", () => {
  assert.match(normalizeCourse(validSeed({ name: "" })).error, /name is required/);
  assert.match(normalizeCourse(validSeed({ theme: undefined })).error, /theme is required/);
});

test("normalizeCourse requires holeCount to be a positive integer", () => {
  assert.match(normalizeCourse(validSeed({ holeCount: 0 })).error, /holeCount/);
  assert.match(normalizeCourse(validSeed({ holeCount: 1.5 })).error, /holeCount/);
});

test("normalizeCourse requires pars to be length-18 with values 2..4", () => {
  assert.match(normalizeCourse(validSeed({ pars: [3, 3] })).error, /length 18/);
  assert.match(
    normalizeCourse(validSeed({ pars: Array(18).fill(5) })).error,
    /2\.\.4/
  );
  assert.match(
    normalizeCourse(validSeed({ pars: Array(18).fill(1) })).error,
    /2\.\.4/
  );
});

test("normalizeCourse validates optional id and locationId as non-empty strings", () => {
  assert.match(normalizeCourse(validSeed({ id: "" })).error, /id must be a uuid/);
  assert.match(normalizeCourse(validSeed({ id: 123 })).error, /id must be a uuid/);
  assert.match(
    normalizeCourse(validSeed({ locationId: "" })).error,
    /locationId must be a uuid/
  );
  const ok = normalizeCourse(validSeed({ locationId: "loc-1" }));
  assert.equal(ok.error, undefined);
  assert.equal(ok.row.locationId, "loc-1");
});

test("normalizeCourse validates sortOrder is an integer when present", () => {
  assert.match(normalizeCourse(validSeed({ sortOrder: 1.5 })).error, /sortOrder/);
  const ok = normalizeCourse(validSeed({ sortOrder: 5 }));
  assert.equal(ok.row.sortOrder, 5);
});

test("normalizeCourse error messages point at the given index", () => {
  const result = normalizeCourse(validSeed({ name: "" }), 3);
  assert.match(result.error, /seed\[3\]/);
});
