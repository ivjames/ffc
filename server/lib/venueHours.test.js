// Unit coverage for venue hours: shape validation (weekly, overrides, seasons)
// + "open now" resolution (overrides → season → base weekly) in venue tz.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHours,
  normalizeHoursOverrides,
  normalizeHoursSeasons,
  effectiveDayHours,
  isVenueOpen,
  WEEKDAY_KEYS,
} from "./venueHours.js";

test("normalizeHours: empty/null/undefined → null (unset)", () => {
  assert.deepEqual(normalizeHours(undefined), { value: null });
  assert.deepEqual(normalizeHours(null), { value: null });
  assert.deepEqual(normalizeHours(""), { value: null });
});

test("normalizeHours: valid week passes; null day → 'closed'", () => {
  const r = normalizeHours({ mon: { open: "12:00", close: "21:00" }, tue: "closed", wed: null });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.value, {
    mon: { open: "12:00", close: "21:00" },
    tue: "closed",
    wed: "closed",
  });
});

test("normalizeHours: close may be 24:00; rejects bad shapes", () => {
  assert.equal(normalizeHours({ fri: { open: "18:00", close: "24:00" } }).error, undefined);
  assert.match(normalizeHours([]).error, /object keyed by weekday/);
  assert.match(normalizeHours({ funday: "closed" }).error, /unknown day key/);
  assert.match(normalizeHours({ mon: { open: "9:00", close: "21:00" } }).error, /open must be/);
  assert.match(normalizeHours({ mon: { open: "12:00", close: "25:00" } }).error, /close must be/);
  assert.match(normalizeHours({ mon: { open: "12:00", close: "12:00" } }).error, /cannot be equal/);
});

test("normalizeHoursOverrides: keyed by valid YYYY-MM-DD", () => {
  assert.deepEqual(normalizeHoursOverrides(null), { value: null });
  const r = normalizeHoursOverrides({
    "2026-08-18": "closed",
    "2026-08-28": { open: "11:00", close: "19:00" },
  });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.value["2026-08-18"], "closed");
  assert.deepEqual(r.value["2026-08-28"], { open: "11:00", close: "19:00" });
  assert.match(normalizeHoursOverrides({ "2026-13-40": "closed" }).error, /invalid date key/);
  assert.match(normalizeHoursOverrides({ "2026-08-28": { open: "9:0", close: "19:00" } }).error, /open must be/);
});

test("normalizeHoursSeasons: array of {from,to,weekly}", () => {
  assert.deepEqual(normalizeHoursSeasons(null), { value: null });
  const r = normalizeHoursSeasons([
    { from: "2026-09-09", to: "2026-12-31", weekly: { mon: "closed", tue: "closed", wed: { open: "12:00", close: "20:00" } }, label: "Fall" },
  ]);
  assert.equal(r.error, undefined);
  assert.equal(r.value[0].label, "Fall");
  assert.deepEqual(r.value[0].weekly.mon, "closed");
  assert.match(normalizeHoursSeasons("nope").error, /must be an array/);
  assert.match(normalizeHoursSeasons([{ from: "2026-12-31", to: "2026-01-01", weekly: { mon: "closed" } }]).error, /from must be <= to/);
  assert.match(normalizeHoursSeasons([{ from: "bad", to: "2026-01-01", weekly: {} }]).error, /from must be YYYY-MM-DD/);
});

const TZ = "America/Los_Angeles";
const upland = {
  mon: { open: "12:00", close: "21:00" },
  tue: { open: "12:00", close: "21:00" },
  wed: { open: "12:00", close: "21:00" },
  thu: { open: "12:00", close: "21:00" },
  fri: { open: "12:00", close: "23:00" },
  sat: { open: "11:00", close: "23:00" },
  sun: { open: "11:00", close: "21:00" },
};
const sched = (over) => ({ weekly: upland, ...over });

test("isVenueOpen: open during listed base hours (venue tz)", () => {
  // 2026-08-12T20:00Z = Wed 13:00 PDT → within Wed 12:00–21:00
  assert.equal(isVenueOpen(sched(), TZ, new Date("2026-08-12T20:00:00Z")), true);
});

test("isVenueOpen: closed before open and at/after close", () => {
  assert.equal(isVenueOpen(sched(), TZ, new Date("2026-08-12T18:00:00Z")), false); // Wed 11:00
  assert.equal(isVenueOpen(sched(), TZ, new Date("2026-08-13T04:00:00Z")), false); // Wed 21:00 (close)
});

test("isVenueOpen: unknown schedule / missing tz → false (fail-closed)", () => {
  const at = new Date("2026-08-12T20:00:00Z");
  assert.equal(isVenueOpen(null, TZ, at), false);
  assert.equal(isVenueOpen({}, TZ, at), false);
  assert.equal(isVenueOpen(sched(), null, at), false);
  assert.equal(isVenueOpen(sched(), "", at), false);
});

test("isVenueOpen: a per-date override wins over the weekly pattern", () => {
  // Wed 2026-08-12 is normally 12:00–21:00; override it closed.
  const closed = sched({ overrides: { "2026-08-12": "closed" } });
  assert.equal(isVenueOpen(closed, TZ, new Date("2026-08-12T20:00:00Z")), false); // Wed 13:00
  // Override to a late 14:00 open: Wed 13:00 now closed, Wed 15:00 open.
  const late = sched({ overrides: { "2026-08-12": { open: "14:00", close: "21:00" } } });
  assert.equal(isVenueOpen(late, TZ, new Date("2026-08-12T20:00:00Z")), false); // Wed 13:00
  assert.equal(isVenueOpen(late, TZ, new Date("2026-08-12T22:00:00Z")), true); // Wed 15:00
});

test("isVenueOpen: a season changes the weekly pattern over a date range", () => {
  // Tukwila-style: closed Mon/Tue from 2026-09-09. 2026-09-14 is a Monday.
  const s = sched({
    seasons: [{ from: "2026-09-09", to: "2026-12-31", weekly: { ...upland, mon: "closed", tue: "closed" } }],
  });
  // Mon 2026-09-14 13:00 PDT (20:00Z) → closed by the season.
  assert.equal(isVenueOpen(s, TZ, new Date("2026-09-14T20:00:00Z")), false);
  // Before the season (Mon 2026-08-31 13:00) → base weekly still open.
  assert.equal(isVenueOpen(s, TZ, new Date("2026-08-31T20:00:00Z")), true);
});

test("effectiveDayHours: overrides beat seasons beat weekly", () => {
  const s = {
    weekly: upland,
    seasons: [{ from: "2026-09-01", to: "2026-09-30", weekly: { ...upland, wed: "closed" } }],
    overrides: { "2026-09-16": { open: "10:00", close: "12:00" } },
  };
  // 2026-09-16 is a Wednesday. Override present → override wins.
  assert.deepEqual(effectiveDayHours(s, "2026-09-16", WEEKDAY_KEYS.indexOf("wed")), { open: "10:00", close: "12:00" });
  // 2026-09-09 Wed, no override, season closes Wed → "closed".
  assert.equal(effectiveDayHours(s, "2026-09-09", WEEKDAY_KEYS.indexOf("wed")), "closed");
  // 2026-08-19 Wed, before season → base weekly.
  assert.deepEqual(effectiveDayHours(s, "2026-08-19", WEEKDAY_KEYS.indexOf("wed")), { open: "12:00", close: "21:00" });
});

test("isVenueOpen: overnight carryover respects the PREVIOUS date's effective hours", () => {
  const wedNight = { weekly: { wed: { open: "20:00", close: "02:00" } } };
  assert.equal(isVenueOpen(wedNight, TZ, new Date("2026-08-13T06:00:00Z")), true); // Wed 23:00 (today)
  assert.equal(isVenueOpen(wedNight, TZ, new Date("2026-08-13T08:00:00Z")), true); // Thu 01:00 (carryover)
  assert.equal(isVenueOpen(wedNight, TZ, new Date("2026-08-12T08:00:00Z")), false); // Wed 01:00 (no prior overnight)

  // A lone Thursday overnight must NOT open Thursday's own early morning.
  const thuNight = { weekly: { thu: { open: "20:00", close: "02:00" } } };
  assert.equal(isVenueOpen(thuNight, TZ, new Date("2026-08-13T08:00:00Z")), false); // Thu 01:00
  assert.equal(isVenueOpen(thuNight, TZ, new Date("2026-08-14T05:00:00Z")), true); // Thu 22:00

  // Carryover must honor an OVERRIDE on the previous date, not just weekly.
  // Override Wed 2026-08-12 to an overnight window; Thu 01:00 then carries over.
  const ovNight = { weekly: upland, overrides: { "2026-08-12": { open: "20:00", close: "02:00" } } };
  assert.equal(isVenueOpen(ovNight, TZ, new Date("2026-08-13T08:00:00Z")), true); // Thu 01:00 from Wed override
});
