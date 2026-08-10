// Unit coverage for venue hours: shape validation + "open now" in venue tz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHours, isVenueOpen } from "./venueHours.js";

test("normalizeHours: empty/null/undefined → null (unset)", () => {
  assert.deepEqual(normalizeHours(undefined), { value: null });
  assert.deepEqual(normalizeHours(null), { value: null });
  assert.deepEqual(normalizeHours(""), { value: null });
});

test("normalizeHours: valid week passes; null day → 'closed'", () => {
  const r = normalizeHours({
    mon: { open: "12:00", close: "21:00" },
    tue: "closed",
    wed: null,
  });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.value, {
    mon: { open: "12:00", close: "21:00" },
    tue: "closed",
    wed: "closed",
  });
});

test("normalizeHours: close may be 24:00", () => {
  assert.equal(normalizeHours({ fri: { open: "18:00", close: "24:00" } }).error, undefined);
});

test("normalizeHours: rejects bad shapes", () => {
  assert.match(normalizeHours([]).error, /object keyed by weekday/);
  assert.match(normalizeHours({ funday: "closed" }).error, /unknown day key/);
  assert.match(normalizeHours({ mon: { open: "9:00", close: "21:00" } }).error, /open must be/);
  assert.match(normalizeHours({ mon: { open: "12:00", close: "25:00" } }).error, /close must be/);
  assert.match(normalizeHours({ mon: { open: "12:00", close: "12:00" } }).error, /cannot be equal/);
  assert.match(normalizeHours({ mon: 5 }).error, /must be \{open,close\}/);
});

// Fixed instants so the tz math is deterministic. America/Los_Angeles is PDT
// (UTC-7) in August. 2026-08-12 is a Wednesday.
const upland = {
  mon: { open: "12:00", close: "21:00" },
  tue: { open: "12:00", close: "21:00" },
  wed: { open: "12:00", close: "21:00" },
  thu: { open: "12:00", close: "21:00" },
  fri: { open: "12:00", close: "23:00" },
  sat: { open: "11:00", close: "23:00" },
  sun: { open: "11:00", close: "21:00" },
};
const TZ = "America/Los_Angeles";

test("isVenueOpen: open during listed hours (venue tz)", () => {
  // 2026-08-12T20:00Z = Wed 13:00 PDT → within Wed 12:00–21:00
  assert.equal(isVenueOpen(upland, TZ, new Date("2026-08-12T20:00:00Z")), true);
});

test("isVenueOpen: closed before open and at/after close", () => {
  // Wed 11:00 PDT (18:00Z) → before 12:00 open
  assert.equal(isVenueOpen(upland, TZ, new Date("2026-08-12T18:00:00Z")), false);
  // Wed 21:00 PDT (2026-08-13T04:00Z) → exactly close → closed (half-open)
  assert.equal(isVenueOpen(upland, TZ, new Date("2026-08-13T04:00:00Z")), false);
});

test("isVenueOpen: unknown/unset hours → false (fail-closed)", () => {
  assert.equal(isVenueOpen(null, TZ, new Date("2026-08-12T20:00:00Z")), false);
  assert.equal(isVenueOpen({}, TZ, new Date("2026-08-12T20:00:00Z")), false);
});

test("isVenueOpen: 'closed' day → false", () => {
  assert.equal(
    isVenueOpen({ wed: "closed" }, TZ, new Date("2026-08-12T20:00:00Z")),
    false
  );
});

test("isVenueOpen: overnight close wraps past midnight", () => {
  const bar = { wed: { open: "20:00", close: "02:00" } };
  // Wed 23:00 PDT (2026-08-13T06:00Z) → open (after 20:00)
  assert.equal(isVenueOpen(bar, TZ, new Date("2026-08-13T06:00:00Z")), true);
  // Wed 12:00 PDT (19:00Z) → closed (before 20:00, and Wed's early-AM window
  // belongs to Tue's overnight, which isn't defined here)
  assert.equal(isVenueOpen(bar, TZ, new Date("2026-08-12T19:00:00Z")), false);
});
