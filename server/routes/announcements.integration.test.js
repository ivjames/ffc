// Integration coverage for announcements (punchlist #1): the public live feed
// (GET /api/announcements) and the Master Control CRUD (/api/admin/announcements).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "announcements-test-token";

const { app } = await import("../app.js");

let baseUrl;
let close;
let locationId;
const announcementIds = [];

function admin(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "announcements-test-token",
      ...opts.headers,
    },
  });
}

async function createAnnouncement(body) {
  const res = await admin("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.announcement?.id) announcementIds.push(json.announcement.id);
  return { res, json };
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Announce Venue ${stamp}`, `announce-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(
    `delete from admin_audit where entity = 'announcement' and entity_id = any($1::uuid[])`,
    [announcementIds]
  );
  await testQuery(`delete from announcement where id = any($1::uuid[])`, [announcementIds]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  const { pool } = await import("../db.js");
  await pool.end();
});

test("admin create validates title, window, and locationId", async () => {
  const noTitle = await admin("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify({ title: "" }),
  });
  assert.equal(noTitle.status, 400);

  const badWindow = await admin("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify({
      title: "Backwards window",
      startsAt: "2026-08-02T00:00:00Z",
      endsAt: "2026-08-01T00:00:00Z",
    }),
  });
  assert.equal(badWindow.status, 400);
  assert.match((await badWindow.json()).error, /endsAt must be after startsAt/);

  const badLoc = await admin("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify({ title: "Bad loc", locationId: "nope" }),
  });
  assert.equal(badLoc.status, 400);

  const missingLoc = await admin("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify({ title: "Ghost loc", locationId: "00000000-0000-4000-8000-000000000000" }),
  });
  assert.equal(missingLoc.status, 400);
});

test("admin create/update/archive round-trips and audits", async () => {
  const { res, json } = await createAnnouncement({
    title: "Taco Tuesday",
    body: "Half-price tacos at the snack bar",
    locationId,
  });
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  const id = json.announcement.id;

  const upd = await admin("/api/admin/announcements", {
    method: "POST",
    body: JSON.stringify({ id, title: "Taco Wednesday", locationId }),
  });
  assert.equal(upd.status, 200);
  assert.equal((await upd.json()).announcement.title, "Taco Wednesday");

  const arch = await admin(`/api/admin/announcements/${id}/archive`, { method: "POST" });
  assert.equal(arch.status, 200);

  const list = await (await admin("/api/admin/announcements")).json();
  assert.ok(!list.some((a) => a.id === id), "archived announcement hidden by default");
  const withArchived = await (await admin("/api/admin/announcements?archived=1")).json();
  assert.ok(withArchived.some((a) => a.id === id), "archived=1 includes it");

  await admin(`/api/admin/announcements/${id}/unarchive`, { method: "POST" });
  const audit = await testQuery(
    `select action from admin_audit where entity = 'announcement' and entity_id = $1 order by created_at`,
    [id]
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["announcement.create", "announcement.update", "announcement.archive", "announcement.unarchive"]
  );
});

test("public feed filters by window, location, and archive state", async () => {
  const now = Date.now();
  const { json: live } = await createAnnouncement({
    title: "Live global",
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 60_000).toISOString(),
  });
  const { json: future } = await createAnnouncement({
    title: "Future global",
    startsAt: new Date(now + 60_000).toISOString(),
  });
  const { json: expired } = await createAnnouncement({
    title: "Expired global",
    endsAt: new Date(now - 60_000).toISOString(),
  });
  const { json: pinned } = await createAnnouncement({
    title: "Pinned to venue",
    locationId,
  });
  const { json: archived } = await createAnnouncement({ title: "Archived global" });
  await admin(`/api/admin/announcements/${archived.announcement.id}/archive`, { method: "POST" });

  // No locationId: only live global rows.
  const bare = await (await fetch(`${baseUrl}/api/announcements`)).json();
  const bareIds = bare.map((a) => a.id);
  assert.ok(bareIds.includes(live.announcement.id), "live global shown");
  assert.ok(!bareIds.includes(future.announcement.id), "future hidden");
  assert.ok(!bareIds.includes(expired.announcement.id), "expired hidden");
  assert.ok(!bareIds.includes(archived.announcement.id), "archived hidden");
  assert.ok(!bareIds.includes(pinned.announcement.id), "location-pinned hidden without locationId");

  // With locationId: global + that venue's.
  const scoped = await (
    await fetch(`${baseUrl}/api/announcements?locationId=${locationId}`)
  ).json();
  const scopedIds = scoped.map((a) => a.id);
  assert.ok(scopedIds.includes(live.announcement.id));
  assert.ok(scopedIds.includes(pinned.announcement.id), "location-pinned shown for its venue");

  const bad = await fetch(`${baseUrl}/api/announcements?locationId=nope`);
  assert.equal(bad.status, 400);
});

test("admin surface requires auth", async () => {
  const res = await fetch(`${baseUrl}/api/admin/announcements`);
  assert.equal(res.status, 401);
});
