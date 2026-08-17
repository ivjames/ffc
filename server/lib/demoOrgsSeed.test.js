// Offline validation of deploy/demo-orgs.seed.json against the REAL request
// validators, so a bad edit to the seed fails the deploy test gate instead of
// blowing up on the droplet mid-`ffc seed-demo`. No DB, no network — this is
// exactly what the admin API would do to each payload the seeder sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UUID_RE, SLUG_RE, normalizeLocation } from "./validateLocation.js";
import { normalizeCourse } from "./validateCourse.js";
import { normalizeBranding } from "./branding.js";
import { isReservedOrgSlug } from "./reservedSlugs.js";

const seed = JSON.parse(
  await readFile(new URL("../../deploy/demo-orgs.seed.json", import.meta.url), "utf8"),
);

test("seed has at least two orgs with unique, valid, unreserved slugs and ids", () => {
  assert.ok(Array.isArray(seed.orgs) && seed.orgs.length >= 2, "need >= 2 demo orgs");
  const ids = new Set();
  const slugs = new Set();
  for (const org of seed.orgs) {
    assert.match(org.id, UUID_RE, `${org.slug}: org id must be a uuid`);
    assert.ok(!ids.has(org.id), `duplicate org id ${org.id}`);
    ids.add(org.id);
    assert.match(org.slug, SLUG_RE, `org slug ${org.slug}`);
    assert.ok(org.slug.length <= 64, `org slug ${org.slug} too long`);
    assert.ok(!isReservedOrgSlug(org.slug), `org slug ${org.slug} is reserved`);
    assert.ok(!slugs.has(org.slug), `duplicate org slug ${org.slug}`);
    slugs.add(org.slug);
    assert.ok(
      typeof org.name === "string" && org.name.trim().length > 0 && org.name.length <= 200,
      `${org.slug}: name 1..200 chars`,
    );
    assert.ok(Number.isInteger(org.sortOrder), `${org.slug}: sortOrder integer`);
  }
});

test("every org's branding passes normalizeBranding", () => {
  for (const org of seed.orgs) {
    const b = normalizeBranding(org.branding);
    assert.equal(b.error, undefined, `${org.slug}: ${b.error}`);
  }
});

test("every location passes normalizeLocation (pos, hours, tz, coords included)", () => {
  for (const org of seed.orgs) {
    assert.ok(org.locations.length >= 1, `${org.slug}: needs a location`);
    for (const { courses, ...loc } of org.locations) {
      assert.match(loc.id, UUID_RE, `${org.slug}/${loc.slug}: location id must be a uuid`);
      const result = normalizeLocation({ ...loc, orgId: org.id });
      assert.equal(result.error, undefined, `${org.slug}/${loc.slug}: ${result.error}`);
      assert.ok(Array.isArray(courses) && courses.length >= 1, `${org.slug}/${loc.slug}: needs a course`);
    }
  }
});

test("every course passes normalizeCourse (18 pars, 2..4)", () => {
  for (const org of seed.orgs) {
    for (const loc of org.locations) {
      for (const course of loc.courses) {
        assert.match(course.id, UUID_RE, `${course.name}: course id must be a uuid`);
        const result = normalizeCourse({ ...course, locationId: loc.id });
        assert.equal(result.error, undefined, `${org.slug}/${course.name}: ${result.error}`);
      }
    }
  }
});

test("the pos matrix stays differentiated (the demo contrast is the point)", () => {
  // One org exercises ordering + loyalty, another loyalty-only — together with
  // Bullwinkle's real config and pos-less venues this covers the capability
  // matrix. A future edit shouldn't quietly collapse that.
  const allLocs = seed.orgs.flatMap((o) => o.locations);
  assert.ok(
    allLocs.some((l) => l.pos?.ordering && l.pos?.loyalty),
    "need a venue with ordering + loyalty",
  );
  assert.ok(
    allLocs.some((l) => !l.pos?.ordering && l.pos?.loyalty),
    "need a loyalty-only venue",
  );
  for (const l of allLocs) {
    assert.ok(!JSON.stringify(l.pos ?? null).includes("apiBase"),
      `${l.slug}: apiBase must stay unset so the /ce mock fallback applies`);
  }
});
