import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLocation, withLabel } from "./validateLocation.js";

function validBody(overrides = {}) {
  return { name: "Upland", slug: "upland", ...overrides };
}

test("normalizeLocation accepts a minimal valid body and defaults sortOrder/tz", () => {
  const result = normalizeLocation(validBody());
  assert.equal(result.error, undefined);
  assert.equal(result.row.name, "Upland");
  assert.equal(result.row.slug, "upland");
  assert.equal(result.row.sortOrder, 0);
  assert.equal(result.row.tz, null);
  assert.equal(result.row.orgId, null);
});

test("normalizeLocation rejects a non-object / array body", () => {
  assert.equal(normalizeLocation(null).status, 400);
  assert.equal(normalizeLocation([]).status, 400);
  assert.equal(normalizeLocation("x").status, 400);
});

test("normalizeLocation requires a non-empty name within 200 chars", () => {
  assert.match(normalizeLocation(validBody({ name: "" })).error, /name is required/);
  assert.match(
    normalizeLocation(validBody({ name: "x".repeat(201) })).error,
    /name is required/
  );
});

test("normalizeLocation requires a lowercase kebab slug", () => {
  assert.match(normalizeLocation(validBody({ slug: "Upland" })).error, /slug must be/);
  assert.match(normalizeLocation(validBody({ slug: "up--land" })).error, /slug must be/);
  assert.match(normalizeLocation(validBody({ slug: "-upland" })).error, /slug must be/);
  assert.equal(normalizeLocation(validBody({ slug: "north-40" })).error, undefined);
});

test("normalizeLocation range-checks lat/lng and requires them together", () => {
  assert.match(normalizeLocation(validBody({ lat: 91, lng: 0 })).error, /lat must be/);
  assert.match(normalizeLocation(validBody({ lat: 0, lng: 181 })).error, /lng must be/);
  assert.match(
    normalizeLocation(validBody({ lat: 34 })).error,
    /lat and lng must be provided together/
  );
});

test("normalizeLocation derives tz from coordinates when tz is omitted", () => {
  const result = normalizeLocation(
    validBody({ lat: 34.08867, lng: -117.67946 })
  );
  assert.equal(result.error, undefined);
  assert.equal(result.row.tz, "America/Los_Angeles");
});

test("normalizeLocation prefers an explicit valid tz over derivation", () => {
  const result = normalizeLocation(
    validBody({ lat: 34.08867, lng: -117.67946, tz: "America/New_York" })
  );
  assert.equal(result.row.tz, "America/New_York");
});

test("normalizeLocation rejects an invalid explicit tz", () => {
  assert.match(normalizeLocation(validBody({ tz: "PST" })).error, /not a valid IANA zone/);
});

test("normalizeLocation validates geofenceKm is a positive number", () => {
  assert.match(normalizeLocation(validBody({ geofenceKm: 0 })).error, /geofenceKm/);
  assert.match(normalizeLocation(validBody({ geofenceKm: -1 })).error, /geofenceKm/);
  assert.equal(normalizeLocation(validBody({ geofenceKm: 2 })).row.geofenceKm, 2);
});

test("normalizeLocation validates id and orgId as uuids when provided", () => {
  assert.match(normalizeLocation(validBody({ id: "not-a-uuid" })).error, /id must be a uuid/);
  assert.match(
    normalizeLocation(validBody({ orgId: "not-a-uuid" })).error,
    /orgId must be a uuid/
  );
});

test("withLabel adds a derived tzLabel, null when tz is unset", () => {
  assert.equal(withLabel({ tz: "America/Los_Angeles" }).tzLabel, "Pacific Time (PT)");
  assert.equal(withLabel({ tz: null }).tzLabel, null);
});
