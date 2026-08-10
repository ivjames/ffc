// Integration coverage for POST /api/rounds/claim — retroactively attaching a
// device's rounds to the signed-in account ("sign in to keep your scores").
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");
const { createUserSession } = await import("../lib/userAuth.js");

let baseUrl;
let close;
let courseId;
const appUserIds = [];
const roundIds = [];

async function makeUserCookie(email) {
  const row = await testQuery(
    `insert into app_user (email, email_verified_at) values ($1, now()) returning id`,
    [email]
  );
  appUserIds.push(row.rows[0].id);
  const { token } = await createUserSession(row.rows[0].id);
  return { id: row.rows[0].id, cookie: `ffc_session=${token}` };
}

async function makeRound(clientId, appUserId = null) {
  const row = await testQuery(
    `insert into round (course_id, player_tags, client_id, app_user_id, completed_at)
       values ($1, $2, $3, $4, now()) returning id`,
    [courseId, ["JIM"], clientId, appUserId]
  );
  roundIds.push(row.rows[0].id);
  return row.rows[0].id;
}

function claim(body, cookie) {
  return fetch(`${baseUrl}/api/rounds/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const loc = await testQuery(
    `insert into location (name, slug) values ('Claim Test', $1) returning id`,
    [`claim-${Date.now()}`]
  );
  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ('C', 'space', $1, $2) returning id`,
    [Array(18).fill(3), loc.rows[0].id]
  );
  courseId = course.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from round where id = any($1::uuid[])`, [roundIds]);
  await testQuery(`delete from course where id = $1`, [courseId]);
  await testQuery(`delete from user_session where app_user_id = any($1::uuid[])`, [appUserIds]);
  await testQuery(`delete from app_user where id = any($1::uuid[])`, [appUserIds]);
});

test("requires a signed-in session", async () => {
  assert.equal((await claim({ clientIds: ["x"] })).status, 401);
});

test("validates the body", async () => {
  const { cookie } = await makeUserCookie(`claim-a-${Date.now()}@e.com`);
  assert.equal((await claim({}, cookie)).status, 400);
  // Empty / all-garbage list is a clean 0, not an error.
  assert.equal((await (await claim({ clientIds: [] }, cookie)).json()).claimed, 0);
});

test("claims this device's unowned rounds, and only those", async () => {
  const me = await makeUserCookie(`claim-b-${Date.now()}@e.com`);
  const other = await makeUserCookie(`claim-c-${Date.now()}@e.com`);
  const mineId = `cid-mine-${Date.now()}`;
  const otherId = `cid-other-${Date.now()}`;
  await makeRound(mineId, null); // unowned — claimable
  await makeRound(otherId, other.id); // already owned by someone else

  const res = await claim({ clientIds: [mineId, otherId, "does-not-exist"] }, me.cookie);
  assert.equal((await res.json()).claimed, 1); // only the unowned, existing one

  const mineOwner = (
    await testQuery("select app_user_id from round where client_id = $1", [mineId])
  ).rows[0].app_user_id;
  assert.equal(mineOwner, me.id);
  // The other account's round is untouched.
  const otherOwner = (
    await testQuery("select app_user_id from round where client_id = $1", [otherId])
  ).rows[0].app_user_id;
  assert.equal(otherOwner, other.id);
});

test("never claims a shared-game round (one canonical round, many players)", async () => {
  const me = await makeUserCookie(`claim-e-${Date.now()}@e.com`);
  const sharedId = `shared:game-${Date.now()}`;
  await makeRound(sharedId, null); // canonical shared round, unowned
  const res = await claim({ clientIds: [sharedId] }, me.cookie);
  assert.equal((await res.json()).claimed, 0);
  const owner = (
    await testQuery("select app_user_id from round where client_id = $1", [sharedId])
  ).rows[0].app_user_id;
  assert.equal(owner, null); // stays shared/unowned
});

test("a repeat claim is idempotent (0 the second time)", async () => {
  const me = await makeUserCookie(`claim-d-${Date.now()}@e.com`);
  const cid = `cid-idem-${Date.now()}`;
  await makeRound(cid, null);
  assert.equal((await (await claim({ clientIds: [cid] }, me.cookie)).json()).claimed, 1);
  assert.equal((await (await claim({ clientIds: [cid] }, me.cookie)).json()).claimed, 0);
});
