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

test("isVenueOpen: missing tz → false (fail-closed, no assumed zone)", () => {
  const at = new Date("2026-08-12T20:00:00Z");
  assert.equal(isVenueOpen(upland, null, at), false);
  assert.equal(isVenueOpen(upland, undefined, at), false);
  assert.equal(isVenueOpen(upland, "", at), false);
});

test("isVenueOpen: 'closed' day → false", () => {
  assert.equal(
    isVenueOpen({ wed: "closed" }, TZ, new Date("2026-08-12T20:00:00Z")),
    false
  );
});

test("isVenueOpen: overnight window — pre-midnight is today, post-midnight is yesterday's", () => {
  const wedNight = { wed: { open: "20:00", close: "02:00" } }; // Wed 20:00 → Thu 02:00
  // Wed 23:00 PDT (2026-08-13T06:00Z) → open (pre-midnight, today's window)
  assert.equal(isVenueOpen(wedNight, TZ, new Date("2026-08-13T06:00:00Z")), true);
  // Thu 01:00 PDT (2026-08-13T08:00Z) → open (carryover from Wed's overnight)
  assert.equal(isVenueOpen(wedNight, TZ, new Date("2026-08-13T08:00:00Z")), true);
  // Wed 01:00 PDT (2026-08-12T08:00Z) → closed (Wed opens 20:00; no prior-day
  // overnight defined to carry into Wed morning)
  assert.equal(isVenueOpen(wedNight, TZ, new Date("2026-08-12T08:00:00Z")), false);
});

test("isVenueOpen: an overnight window never opens its OWN early-morning hours (P1)", () => {
  // Only Thursday has 20:00–02:00. Thu 01:00 must be CLOSED — the post-midnight
  // slice belongs to a Wednesday window, which isn't defined here. (Regression
  // for the bug where the current day's `close` was checked after midnight.)
  const thuNight = { thu: { open: "20:00", close: "02:00" } };
  assert.equal(isVenueOpen(thuNight, TZ, new Date("2026-08-13T08:00:00Z")), false); // Thu 01:00
  assert.equal(isVenueOpen(thuNight, TZ, new Date("2026-08-14T05:00:00Z")), true); // Thu 22:00
});
