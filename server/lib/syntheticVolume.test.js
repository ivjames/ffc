import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyOpenHours, projectVolume, WEEKS_PER_YEAR } from "./syntheticVolume.js";

test("weeklyOpenHours: unset/empty/garbage → 0 (fail-closed)", () => {
  assert.equal(weeklyOpenHours(null), 0);
  assert.equal(weeklyOpenHours(undefined), 0);
  assert.equal(weeklyOpenHours({}), 0);
  assert.equal(weeklyOpenHours("nonsense"), 0);
});

test("weeklyOpenHours: sums same-day windows across the week", () => {
  const hours = {
    mon: { open: "12:00", close: "21:00" }, // 9h
    tue: { open: "12:00", close: "21:00" }, // 9h
    wed: "closed",
    sat: { open: "10:00", close: "23:00" }, // 13h
  };
  assert.equal(weeklyOpenHours(hours), 9 + 9 + 13);
});

test("weeklyOpenHours: overnight window wraps past midnight", () => {
  // open 20:00 → close 02:00 is a 6-hour overnight window.
  assert.equal(weeklyOpenHours({ fri: { open: "20:00", close: "02:00" } }), 6);
  // close 24:00 is midnight — a 4-hour window from 20:00.
  assert.equal(weeklyOpenHours({ sun: { open: "20:00", close: "24:00" } }), 4);
});

test("projectVolume: 24/7 ceiling matches n × plays × sweeps/hr × 24 × 365 × avg", () => {
  const courses = [{ hours: null }, { hours: null }];
  const p = projectVolume({ courses, plays: 2, intervalMin: 60, maxPlayers: 4, ignoreHours: true });
  assert.equal(p.avgPlayers, 2.5);
  // 2 courses × 2 plays × 1 sweep/hr × 24 × 365 = 35,040 rounds/yr
  assert.equal(p.max.roundsPerYear, 2 * 2 * 1 * 24 * 365);
  assert.equal(p.max.playersPerYear, p.max.roundsPerYear * 2.5);
  // ignoreHours → effective tracks the 24/7 ceiling.
  assert.equal(p.effective.roundsPerYear, p.max.roundsPerYear);
});

test("projectVolume: gated uses each venue's weekly open hours", () => {
  // 4 courses, each ~71h/week open, hourly, avg 2.5 → the ~70k/yr calibration.
  const hours = {
    sun: { open: "10:00", close: "21:00" },
    mon: { open: "12:00", close: "21:00" },
    tue: { open: "12:00", close: "21:00" },
    wed: { open: "12:00", close: "21:00" },
    thu: { open: "12:00", close: "21:00" },
    fri: { open: "12:00", close: "23:00" },
    sat: { open: "10:00", close: "23:00" },
  };
  const courses = Array.from({ length: 4 }, () => ({ hours }));
  const p = projectVolume({ courses, plays: 2, intervalMin: 60, maxPlayers: 4, ignoreHours: false });

  const wk = weeklyOpenHours(hours); // 71
  const expectedRounds = 4 * 2 * (wk / 1) * WEEKS_PER_YEAR;
  assert.equal(p.gated.roundsPerYear, expectedRounds);
  // effective follows the gated number when ignoreHours is false.
  assert.equal(p.effective.roundsPerYear, p.gated.roundsPerYear);
  // Sanity: lands in the ~70k players/yr neighborhood.
  assert.ok(p.gated.playersPerYear > 60_000 && p.gated.playersPerYear < 80_000);
});

test("projectVolume: gated is 0 when venues have no hours", () => {
  const courses = [{ hours: null }, { hours: {} }];
  const p = projectVolume({ courses, plays: 3, intervalMin: 60, maxPlayers: 4, ignoreHours: false });
  assert.equal(p.gated.roundsPerYear, 0);
  assert.equal(p.effective.roundsPerYear, 0);
});

test("projectVolume: intervalMin 0 yields no fixed annual rate", () => {
  const courses = [{ hours: null }];
  const p = projectVolume({ courses, plays: 1, intervalMin: 0, maxPlayers: 2, ignoreHours: true });
  assert.equal(p.max.roundsPerYear, 0);
  assert.equal(p.gated.roundsPerYear, 0);
});
