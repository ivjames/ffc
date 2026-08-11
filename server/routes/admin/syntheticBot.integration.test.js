// Integration coverage for /api/admin/synthetic-bot — the load-bot control
// plane. These tests never actually spawn the bot: SYNTHETIC_BOT_KEY is left
// unset, so /start stops at the 409 key guard. That keeps the suite hermetic
// (no child process, no self-directed traffic) while still exercising auth,
// validation, the key guard, status shape, and the projection math end to end.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "synthetic-bot-test-token";
delete process.env.SYNTHETIC_BOT_KEY; // feature OFF — /start must 409, never spawn

const { app } = await import("../../app.js");

let baseUrl;
let close;
let locationId;

// ~71 open hours/week — the Upland-style schedule used in the calibration.
const HOURS = {
  sun: { open: "10:00", close: "21:00" },
  mon: { open: "12:00", close: "21:00" },
  tue: { open: "12:00", close: "21:00" },
  wed: { open: "12:00", close: "21:00" },
  thu: { open: "12:00", close: "21:00" },
  fri: { open: "12:00", close: "23:00" },
  sat: { open: "10:00", close: "23:00" },
};

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "synthetic-bot-test-token",
      ...opts.headers,
    },
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug, tz, hours) values ($1, $2, $3, $4) returning id`,
    [`Bot Test Venue ${stamp}`, `bot-test-${stamp}`, "America/Los_Angeles", HOURS]
  );
  locationId = loc.rows[0].id;
  // Four courses at this venue — the 4-course calibration target.
  for (let i = 0; i < 4; i++) {
    await testQuery(
      `insert into course (name, theme, pars, location_id, sort_order) values ($1, 'test', $2, $3, $4)`,
      [`Bot Test Course ${i}`, Array(18).fill(3), locationId, i]
    );
  }
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from course where location_id = $1`, [locationId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("status + projection + start/stop require admin auth", async () => {
  for (const [method, path] of [
    ["GET", "/api/admin/synthetic-bot/status"],
    ["POST", "/api/admin/synthetic-bot/projection"],
    ["POST", "/api/admin/synthetic-bot/start"],
    ["POST", "/api/admin/synthetic-bot/stop"],
  ]) {
    const res = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test("GET /status reports key unset, control allowed, courses, idle runner", async () => {
  const res = await api("/api/admin/synthetic-bot/status");
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.keySet, false, "no SYNTHETIC_BOT_KEY in the test env");
  assert.equal(body.canControl, true, "APP_TOKEN authenticates as super_admin");
  assert.equal(body.policy.countsOnBoard, true); // defaults
  assert.equal(body.policy.mintsRewards, true);

  const mine = body.courses.filter((c) => c.locationId === locationId);
  assert.equal(mine.length, 4);
  assert.equal(mine[0].weeklyOpenHours, 71);
  assert.equal(typeof mine[0].openNow, "boolean");

  assert.equal(body.runner.running, false);
  assert.equal(body.runner.pid, null);
});

test("POST /projection computes gated players/yr for a cadence", async () => {
  const res = await api("/api/admin/synthetic-bot/projection", {
    method: "POST",
    body: JSON.stringify({
      playsPerCourse: 2,
      intervalMin: 60,
      maxPlayers: 4,
      locationId,
      ignoreHours: false,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.courseCount, 4);
  assert.equal(body.avgPlayers, 2.5);
  // 4 courses × 2 plays × 71h/wk × 52.14 wks × 2.5 players ≈ 74k/yr.
  assert.ok(
    body.gated.playersPerYear > 70_000 && body.gated.playersPerYear < 78_000,
    `gated players/yr ~74k, got ${body.gated.playersPerYear}`
  );
  // ignoreHours:false → effective follows the gated projection.
  assert.equal(body.effective.playersPerYear, body.gated.playersPerYear);
});

test("POST /projection rejects out-of-range knobs with 400", async () => {
  for (const bad of [
    { playsPerCourse: 0, intervalMin: 60, maxPlayers: 4 },
    { playsPerCourse: 2, intervalMin: 0, maxPlayers: 4 },
    { playsPerCourse: 2, intervalMin: 60, maxPlayers: 9 },
    { playsPerCourse: 2, intervalMin: 60, maxPlayers: 4, locationId: "not-a-uuid" },
  ]) {
    const res = await api("/api/admin/synthetic-bot/projection", {
      method: "POST",
      body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
});

test("POST /start 409s when SYNTHETIC_BOT_KEY is unset (never spawns)", async () => {
  const res = await api("/api/admin/synthetic-bot/start", {
    method: "POST",
    body: JSON.stringify({ playsPerCourse: 2, intervalMin: 60, maxPlayers: 4, locationId }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /SYNTHETIC_BOT_KEY/);
});

test("POST /start validates params before the key guard (400)", async () => {
  const res = await api("/api/admin/synthetic-bot/start", {
    method: "POST",
    body: JSON.stringify({ playsPerCourse: 999, intervalMin: 60, maxPlayers: 4 }),
  });
  assert.equal(res.status, 400);
});

test("POST /stop is idempotent when nothing is running", async () => {
  const res = await api("/api/admin/synthetic-bot/stop", { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.runner.running, false);
});
