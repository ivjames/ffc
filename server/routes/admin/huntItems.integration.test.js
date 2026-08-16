// Integration coverage for the hunt-item admin surface (routes/admin/huntItems.js):
// item CRUD (incl. the played-data delete guard), the vetting image pipeline
// (people-screen → disk → DB, bytes, removal), and audit rows.
//
// lib/itemImageScreen.js (the real descriptor call) is mocked via node:test's
// mock.module — registered before app.js is imported, same arrangement as the
// vision mock in routes/hunt.integration.test.js.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const APP_TOKEN = `hunt-items-test-token-${Date.now()}`;
process.env.APP_TOKEN = APP_TOKEN;

const imageDir = await mkdtemp(join(tmpdir(), "ffc-hunt-item-images-test-"));
process.env.HUNT_ITEM_IMAGE_DIR = imageDir;

const screenMock = mock.fn(async () => ({
  peoplePresent: false,
  subject: "test windmill",
  provider: "mock-descriptor",
  inputTokens: 300,
  outputTokens: 20,
  cost: 0.000105,
}));

mock.module("../../lib/itemImageScreen.js", {
  namedExports: {
    isScreeningConfigured: () => true,
    screenItemImage: screenMock,
  },
});

const { app } = await import("../../app.js");

let baseUrl;
let close;
let locationId;
let courseId;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function call(method, path, body) {
  return fetch(`${baseUrl}/api/admin/hunt-items${path}`, {
    method,
    headers: { "x-app-token": APP_TOKEN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const uploadBody = (extra = {}) => ({
  imageBase64: Buffer.from("vetting-image-bytes").toString("base64"),
  mediaType: "image/jpeg",
  ...extra,
});

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Hunt Admin Venue ${stamp}`, `hunt-admin-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, 'test', $2, $3) returning id`,
    ["Hunt Admin Course", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from hunt_scan where course_id = $1`, [courseId]);
  await testQuery(
    `delete from hunt_find where item_id in (select id from hunt_item where course_id = $1)`,
    [courseId]
  );
  await testQuery(`delete from hunt_item where course_id = $1`, [courseId]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from location where id = $1`, [locationId]);
  await testQuery(`delete from admin_audit where entity in ('hunt_item', 'hunt_item_image')`);
  await rmDir(imageDir, { recursive: true, force: true });
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("the surface is admin-gated", async () => {
  const res = await fetch(`${baseUrl}/api/admin/hunt-items`);
  assert.equal(res.status, 401);
});

test("create validates, persists, audits, and rejects a duplicate slug with 409", async () => {
  const bad = await call("POST", "", { courseId, slug: "BAD SLUG", name: "x" });
  assert.equal(bad.status, 400);

  const res = await call("POST", "", {
    courseId,
    slug: "windmill",
    name: "The windmill",
    hint: "red roof",
    extraPrompt: "Credit only the RED windmill.",
    countable: false,
  });
  assert.equal(res.status, 200);
  const { item } = await res.json();
  assert.equal(item.slug, "windmill");
  assert.equal(item.extraPrompt, "Credit only the RED windmill.");
  assert.equal(item.active, true);

  const dup = await call("POST", "", { courseId, slug: "windmill", name: "Again" });
  assert.equal(dup.status, 409);

  const auditRow = await testQuery(
    `select action from admin_audit where entity = 'hunt_item' and entity_id = $1`,
    [item.id]
  );
  assert.equal(auditRow.rows[0].action, "hunt_item.create");
});

test("list carries course/location context, image count, and thumbnail id", async () => {
  const created = await (
    await call("POST", "", { courseId, slug: "list-item", name: "A listed thing" })
  ).json();

  const list = await (await call("GET", "")).json();
  const row = list.items.find((r) => r.id === created.item.id);
  assert.ok(row, "created item appears in the list");
  assert.equal(row.courseName, "Hunt Admin Course");
  assert.equal(row.locationName, `Hunt Admin Venue ${stamp}`);
  assert.equal(row.imageCount, 0);
  assert.equal(row.thumbImageId, null);

  // Courses ride along too — including ones with no items yet — so the UI
  // can offer "add the first item" on every course.
  const course = list.courses.find((c) => c.id === courseId);
  assert.ok(course, "the course itself is listed");
  assert.equal(course.locationName, `Hunt Admin Venue ${stamp}`);
});

test("patch edits fields (extraPrompt, active) and audits", async () => {
  const created = await (
    await call("POST", "", { courseId, slug: "patch-item", name: "Patch me" })
  ).json();
  const id = created.item.id;

  const res = await call("PATCH", `/${id}`, {
    extraPrompt: "Only the big one counts.",
    active: false,
    countable: true,
  });
  assert.equal(res.status, 200);
  const { item } = await res.json();
  assert.equal(item.extraPrompt, "Only the big one counts.");
  assert.equal(item.active, false);
  assert.equal(item.countable, true);
  assert.equal(item.name, "Patch me", "unpatched fields survive the merge");

  // Clearing works too: empty string normalizes to null.
  const cleared = await (await call("PATCH", `/${id}`, { extraPrompt: "" })).json();
  assert.equal(cleared.item.extraPrompt, null);

  const auditRows = await testQuery(
    `select action from admin_audit where entity = 'hunt_item' and entity_id = $1 order by created_at`,
    [id]
  );
  assert.deepEqual(
    auditRows.rows.map((r) => r.action),
    ["hunt_item.create", "hunt_item.update", "hunt_item.update"]
  );
});

test("image upload screens for people, stores the file, and returns the scan burn", async () => {
  const created = await (
    await call("POST", "", { courseId, slug: "imaged-item", name: "Has images" })
  ).json();
  const id = created.item.id;

  screenMock.mock.resetCalls();
  const res = await call("POST", `/${id}/images`, uploadBody({ note: "front angle" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(screenMock.mock.callCount(), 1);
  assert.equal(json.image.subject, "test windmill");
  assert.equal(json.image.note, "front angle");
  // Exact billed tokens + computed cost ride back to the operator.
  assert.equal(json.scan.inputTokens, 300);
  assert.equal(json.scan.outputTokens, 20);
  assert.equal(json.scan.cost, 0.000105);

  const dbRow = await testQuery(
    `select image_path, media_type from hunt_item_image where id = $1`,
    [json.image.id]
  );
  assert.equal(dbRow.rows[0].media_type, "image/jpeg");
  await access(dbRow.rows[0].image_path); // file is on disk

  // The billed screen is PERSISTED as a hunt_scan kind='screen' row with the
  // exact token fields — not just echoed on the response (CLAUDE.md metering
  // rule; the hunt-usage rollup attributes it to the item's org via course_id).
  const meter = await testQuery(
    `select kind, round_client_id, player_tag, course_id, model,
            input_tokens, output_tokens, cost_usd
       from hunt_scan where item_id = $1`,
    [id]
  );
  assert.equal(meter.rowCount, 1);
  assert.equal(meter.rows[0].kind, "screen");
  assert.equal(meter.rows[0].round_client_id, null, "an admin screen has no round");
  assert.equal(meter.rows[0].player_tag, null, "an admin screen has no player");
  assert.equal(meter.rows[0].course_id, courseId);
  assert.equal(meter.rows[0].model, "mock-descriptor");
  assert.equal(meter.rows[0].input_tokens, 300);
  assert.equal(meter.rows[0].output_tokens, 20);
  assert.equal(meter.rows[0].cost_usd, 0.000105);

  // The list/detail now surface it.
  const detail = await (await call("GET", `/${id}`)).json();
  assert.equal(detail.images.length, 1);
  assert.equal(detail.item.courseName, "Hunt Admin Course");
  const list = await (await call("GET", "")).json();
  const row = list.items.find((r) => r.id === id);
  assert.equal(row.imageCount, 1);
  assert.equal(row.thumbImageId, json.image.id);

  // And the bytes endpoint serves it.
  const img = await call("GET", `/images/${json.image.id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), "vetting-image-bytes");
});

test("an image with people in frame is rejected and nothing is stored", async (t) => {
  t.after(() => {
    screenMock.mock.mockImplementation(async () => ({
      peoplePresent: false,
      subject: "test windmill",
      provider: "mock-descriptor",
      inputTokens: 300,
      outputTokens: 20,
      cost: 0.000105,
    }));
  });
  screenMock.mock.mockImplementation(async () => ({
    peoplePresent: true,
    subject: "person by windmill",
    provider: "mock-descriptor",
    inputTokens: 310,
    outputTokens: 22,
    cost: 0.00011,
  }));
  const created = await (
    await call("POST", "", { courseId, slug: "people-item", name: "People test" })
  ).json();
  const id = created.item.id;

  const res = await call("POST", `/${id}/images`, uploadBody());
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.peoplePresent, true);
  assert.match(json.error, /people/i);
  // The rejected screen was still a billed call — its burn is reported.
  assert.equal(json.scan.inputTokens, 310);

  const rows = await testQuery(`select id from hunt_item_image where item_id = $1`, [id]);
  assert.equal(rows.rowCount, 0, "no row for a rejected image");

  // ...and still metered: the tokens were billed even though nothing stored.
  const meter = await testQuery(
    `select kind, input_tokens, output_tokens, cost_usd from hunt_scan where item_id = $1`,
    [id]
  );
  assert.equal(meter.rowCount, 1);
  assert.equal(meter.rows[0].kind, "screen");
  assert.equal(meter.rows[0].input_tokens, 310);
  assert.equal(meter.rows[0].output_tokens, 22);
  assert.equal(meter.rows[0].cost_usd, 0.00011);
});

test("image removal deletes the file and the row, and audits", async () => {
  const created = await (
    await call("POST", "", { courseId, slug: "rm-image-item", name: "Remove my image" })
  ).json();
  const id = created.item.id;
  const up = await (await call("POST", `/${id}/images`, uploadBody())).json();
  const imagePath = (
    await testQuery(`select image_path from hunt_item_image where id = $1`, [up.image.id])
  ).rows[0].image_path;

  const res = await call("DELETE", `/images/${up.image.id}`);
  assert.equal(res.status, 200);
  await assert.rejects(access(imagePath), "file must be gone from disk");
  const rows = await testQuery(`select id from hunt_item_image where id = $1`, [up.image.id]);
  assert.equal(rows.rowCount, 0);
  assert.equal((await call("GET", `/images/${up.image.id}/image`)).status, 404);

  const auditRow = await testQuery(
    `select action from admin_audit where entity = 'hunt_item_image' and entity_id = $1
      order by created_at desc limit 1`,
    [up.image.id]
  );
  assert.equal(auditRow.rows[0].action, "hunt_item_image.remove");
});

test("delete removes an unplayed item and its image files; a played item 409s", async () => {
  // Unplayed: delete succeeds and takes the vetting files with it.
  const unplayed = await (
    await call("POST", "", { courseId, slug: "del-item", name: "Delete me" })
  ).json();
  const up = await (await call("POST", `/${unplayed.item.id}/images`, uploadBody())).json();
  const imagePath = (
    await testQuery(`select image_path from hunt_item_image where id = $1`, [up.image.id])
  ).rows[0].image_path;

  const res = await call("DELETE", `/${unplayed.item.id}`);
  assert.equal(res.status, 200);
  await assert.rejects(access(imagePath), "vetting file must be gone from disk");
  const itemRows = await testQuery(`select id from hunt_item where id = $1`, [unplayed.item.id]);
  assert.equal(itemRows.rowCount, 0);

  // Played: a recorded find makes the delete a 409 and everything survives.
  const played = await (
    await call("POST", "", { courseId, slug: "played-item", name: "Played" })
  ).json();
  await testQuery(
    `insert into hunt_find (round_client_id, player_tag, item_id, verified)
       values ($1, 'AAA', $2, true)`,
    [`hunt-admin-round-${stamp}`, played.item.id]
  );
  const kept = await (await call("POST", `/${played.item.id}/images`, uploadBody())).json();

  const del = await call("DELETE", `/${played.item.id}`);
  assert.equal(del.status, 409);
  assert.match((await del.json()).error, /deactivate/);
  const keptItem = await testQuery(`select id from hunt_item where id = $1`, [played.item.id]);
  assert.equal(keptItem.rowCount, 1, "item survives");
  const keptImagePath = (
    await testQuery(`select image_path from hunt_item_image where id = $1`, [kept.image.id])
  ).rows[0].image_path;
  await access(keptImagePath); // vetting set survives too
});
