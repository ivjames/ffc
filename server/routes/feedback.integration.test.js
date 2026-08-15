// Integration coverage for reviewer commentary (routes/feedback.js) and its
// Master Control surface (routes/admin/feedback.js). Like the photo booth, no
// vision mock here on purpose: nothing in this pipeline may touch the model
// layer, so the suite runs with no ANTHROPIC_API_KEY set and would fail loudly
// if an AI call ever crept in.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { access, mkdtemp, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";
import { BUDGET_LOCKS } from "../lib/diskBudget.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const APP_TOKEN = `feedback-test-token-${Date.now()}`;
process.env.APP_TOKEN = APP_TOKEN;

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-feedback-test-"));
process.env.FEEDBACK_DIR = uploadDir;

const { app } = await import("../app.js");

let baseUrl;
let close;
let locationId;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// Every row this file writes is tagged with the stamp so cleanup can find them
// without disturbing rows from parallel test files.
const tag = `[feedback-test ${stamp}]`;

function file(body) {
  return fetch(`${baseUrl}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fileBody(overrides = {}) {
  return {
    body: `${tag} the hole numbers are hard to read in sunlight`,
    screenPath: "/golf/play",
    reviewer: "Sam the reviewer",
    deviceId: "device-abc-123",
    appBuild: "abc1234",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    ...overrides,
  };
}

const SHOT = Buffer.from("feedback-test-screenshot");

function withShot(overrides = {}) {
  return fileBody({
    imageBase64: SHOT.toString("base64"),
    mediaType: "image/png",
    ...overrides,
  });
}

function adminGet(path) {
  return fetch(`${baseUrl}/api/admin/feedback${path}`, {
    headers: { "x-app-token": APP_TOKEN },
  });
}

function adminPost(path, body) {
  return fetch(`${baseUrl}/api/admin/feedback${path}`, {
    method: "POST",
    headers: { "x-app-token": APP_TOKEN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Feedback Venue ${stamp}`, `feedback-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from reviewer_feedback where body like $1`, [`%${stamp}%`]);
  await testQuery(`delete from admin_audit where entity = 'reviewer_feedback'`);
  await testQuery(`delete from location where id = $1`, [locationId]);
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

test("a comment files with its screen context and shows up in Master Control", async () => {
  const res = await file(fileBody({ locationId }));
  assert.equal(res.status, 201);
  const saved = await res.json();
  assert.ok(saved.ok && saved.id && saved.createdAt);
  assert.equal(saved.hasScreenshot, false, "no image sent -> comment only");

  const row = await testQuery(
    `select screen_path, reviewer, device_id, location_id, app_build, user_agent,
            status, screenshot_path
       from reviewer_feedback where id = $1`,
    [saved.id]
  );
  assert.equal(row.rows[0].screen_path, "/golf/play");
  assert.equal(row.rows[0].reviewer, "Sam the reviewer");
  assert.equal(row.rows[0].device_id, "device-abc-123");
  assert.equal(row.rows[0].location_id, locationId);
  assert.equal(row.rows[0].app_build, "abc1234");
  assert.equal(row.rows[0].status, "open", "new notes start open");
  assert.equal(row.rows[0].screenshot_path, null);

  // The admin surface returns it with the venue name resolved.
  const list = await (await adminGet("?limit=200")).json();
  const found = list.find((n) => n.id === saved.id);
  assert.ok(found, "the note must appear in the admin list");
  assert.equal(found.screenPath, "/golf/play");
  assert.equal(found.appBuild, "abc1234");
  assert.equal(found.hasScreenshot, false);
  assert.equal(found.locationName, `Feedback Venue ${stamp}`);
});

test("a screenshot rides along: stored on disk, served back to the operator", async () => {
  const saved = await (await file(withShot({ locationId }))).json();
  assert.equal(saved.hasScreenshot, true);

  const row = await testQuery(
    `select screenshot_path, media_type, bytes from reviewer_feedback where id = $1`,
    [saved.id]
  );
  assert.equal(row.rows[0].media_type, "image/png");
  assert.equal(row.rows[0].bytes, SHOT.length);
  await access(row.rows[0].screenshot_path);

  const img = await adminGet(`/${saved.id}/screenshot`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), SHOT.toString());

  // A comment-only note has no bytes to serve.
  const bare = await (await file(fileBody())).json();
  assert.equal((await adminGet(`/${bare.id}/screenshot`)).status, 404);
});

test("the comment is required; a malformed screenshot is refused outright", async () => {
  assert.equal((await file(fileBody({ body: "   " }))).status, 400, "blank comment");
  assert.equal((await file(fileBody({ body: undefined }))).status, 400, "missing comment");
  assert.equal(
    (await file(fileBody({ body: `${tag} ${"x".repeat(4100)}` }))).status,
    400,
    "over the 4000-char ceiling"
  );
  // A claimed screenshot must be well-formed — silently storing a broken image
  // would leave the reviewer thinking their evidence went through.
  assert.equal(
    (await file(withShot({ mediaType: "application/pdf" }))).status,
    400,
    "unsupported media type"
  );
  assert.equal(
    (await file(withShot({ imageBase64: "" , mediaType: "image/png" }))).status,
    201,
    "an empty image string is 'no screenshot', not an error"
  );
});

test("client-stamped context is truncated, never a reason to reject the note", async () => {
  const saved = await (
    await file(
      fileBody({
        userAgent: "U".repeat(900),
        screenPath: `/golf/${"deep/".repeat(200)}`,
        reviewer: "R".repeat(200),
      })
    )
  ).json();
  assert.equal(saved.ok, true, "a long user-agent must not cost the reviewer their words");

  const row = await testQuery(
    `select user_agent, screen_path, reviewer from reviewer_feedback where id = $1`,
    [saved.id]
  );
  assert.equal(row.rows[0].user_agent.length, 400);
  assert.equal(row.rows[0].screen_path.length, 300);
  assert.equal(row.rows[0].reviewer.length, 80);
});

test("an unknown venue stores null rather than failing the filing", async () => {
  const saved = await (
    await file(fileBody({ locationId: "00000000-0000-0000-0000-000000000000" }))
  ).json();
  assert.equal(saved.ok, true);
  const row = await testQuery(`select location_id from reviewer_feedback where id = $1`, [
    saved.id,
  ]);
  assert.equal(row.rows[0].location_id, null);
});

test("the screenshot disk budget drops the image but keeps the comment", async () => {
  // 0 MB budget: any screenshot exceeds it. Losing a reviewer's words because
  // the image quota is spent would be the wrong failure.
  process.env.FEEDBACK_DISK_BUDGET_MB = "0";
  try {
    const res = await file(withShot({ locationId }));
    assert.equal(res.status, 201, "the note still files");
    const saved = await res.json();
    assert.equal(saved.hasScreenshot, false);
    assert.equal(saved.screenshotDropped, true, "the client is told the shot was dropped");
    const row = await testQuery(
      `select body, screenshot_path from reviewer_feedback where id = $1`,
      [saved.id]
    );
    assert.ok(row.rows[0].body.includes("sunlight"), "the comment survived");
    assert.equal(row.rows[0].screenshot_path, null);
  } finally {
    delete process.env.FEEDBACK_DISK_BUDGET_MB;
  }
});

test("the screenshot budget is reserved under a lock, and only for screenshots", async () => {
  // The budget is only a ceiling if the "is there room?" read and the row that
  // CONSUMES that room commit together — otherwise concurrent uploads all read
  // the same sum(bytes), all conclude there's room, and all store.
  //
  // Firing a burst of HTTP uploads does NOT prove this: the payload size that
  // widens the racy window also staggers arrival, so the interleaving never
  // reliably happens and such a test passes with or without the fix. So test
  // the mechanism instead — hold the advisory lock from another connection and
  // assert the upload actually waits on it. Remove the lock from the route and
  // this fails immediately.
  const holder = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await holder.connect();
  await holder.query("select pg_advisory_lock($1)", [BUDGET_LOCKS.feedback]);
  try {
    let uploadSettled = false;
    const upload = file(withShot()).then((r) => {
      uploadSettled = true;
      return r.json();
    });

    // A comment-only note takes no lock — the words never queue behind an
    // image quota.
    const commentOnly = await (await file(fileBody({ body: `${tag} words only` }))).json();
    assert.equal(commentOnly.ok, true);

    await new Promise((r) => setTimeout(r, 400));
    assert.equal(uploadSettled, false, "the screenshot upload must wait for the reservation lock");

    await holder.query("select pg_advisory_unlock($1)", [BUDGET_LOCKS.feedback]);
    const saved = await upload;
    assert.equal(saved.hasScreenshot, true, "and completes once the lock is free");
  } finally {
    await holder.end();
  }
});

test("admin: gated, triaged reversibly with an audit trail, filterable, deletable", async () => {
  // Every admin endpoint needs the token.
  assert.equal((await fetch(`${baseUrl}/api/admin/feedback`)).status, 401);
  assert.equal(
    (await fetch(`${baseUrl}/api/admin/feedback/${crypto.randomUUID()}/remove`, { method: "POST" }))
      .status,
    401
  );

  const saved = await (await file(withShot({ locationId }))).json();

  // Resolve: stamps who and when, and drops out of the open filter.
  const resolved = await (await adminPost(`/${saved.id}/status`, { status: "resolved" })).json();
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.resolvedAt && resolved.resolvedBy);

  const open = await (await adminGet("?status=open&limit=200")).json();
  assert.equal(open.find((n) => n.id === saved.id), undefined, "no longer open");
  const done = await (await adminGet("?status=resolved&limit=200")).json();
  assert.ok(done.find((n) => n.id === saved.id), "listed under resolved");

  // Re-open: reversible, and the resolution stamps clear.
  const reopened = await (await adminPost(`/${saved.id}/status`, { status: "open" })).json();
  assert.equal(reopened.status, "open");
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.resolvedBy, null);

  assert.equal(
    (await adminPost(`/${saved.id}/status`, { status: "wontfix" })).status,
    400,
    "status is a two-state flag, not free text"
  );

  const audits = await testQuery(
    `select action from admin_audit where entity_id = $1 order by created_at`,
    [saved.id]
  );
  assert.deepEqual(
    audits.rows.map((r) => r.action),
    ["feedback.resolved", "feedback.open"]
  );

  // Delete takes the row AND the screenshot off disk.
  const path = (
    await testQuery(`select screenshot_path from reviewer_feedback where id = $1`, [saved.id])
  ).rows[0].screenshot_path;
  assert.equal((await adminPost(`/${saved.id}/remove`)).status, 200);
  await assert.rejects(access(path), "the screenshot must be gone from disk");
  const gone = await testQuery(`select 1 from reviewer_feedback where id = $1`, [saved.id]);
  assert.equal(gone.rowCount, 0);
});

test("admin list: newest first, keyset-paginated, and validates its inputs", async () => {
  const first = await (await file(fileBody({ body: `${tag} page one note` }))).json();
  const second = await (await file(fileBody({ body: `${tag} page two note` }))).json();

  const page = await (await adminGet("?limit=1")).json();
  assert.equal(page.length, 1);
  assert.equal(page[0].id, second.id, "newest first");

  const older = await (
    await adminGet(`?limit=200&before=${encodeURIComponent(page[0].createdAt)}`)
  ).json();
  assert.ok(
    older.some((n) => n.id === first.id),
    "the cursor pages back to the older note"
  );
  assert.equal(
    older.find((n) => n.id === second.id),
    undefined,
    "the cursor row itself is excluded"
  );

  assert.equal((await adminGet("?limit=0")).status, 400);
  assert.equal((await adminGet("?limit=501")).status, 400);
  assert.equal((await adminGet("?before=nonsense")).status, 400);
  assert.equal((await adminGet("?status=nonsense")).status, 400);
});
