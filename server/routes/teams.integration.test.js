// Teams over HTTP against the real app + test DB: create/list/rename/archive,
// the invite email -> accept-token flow, member removal, and the permission
// matrix (non-member 404s, non-owner 403s, owner-can't-leave 409).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery, listenEphemeral } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.MAIL_PROVIDER;

const { app } = await import("../app.js");
const { resetTeamRateLimits } = await import("./teams.js");
const { createUserSession } = await import("../lib/userAuth.js");

let baseUrl, close;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Three players: an owner, a member-to-be, and a stranger.
const users = {};
async function makeUser(label) {
  const row = await testQuery(
    `insert into app_user (email, email_verified_at, display_name)
       values ($1, now(), $2) returning id`,
    [`team-${stamp}-${label}@example.com`, label]
  );
  const { token } = await createUserSession(row.rows[0].id);
  return { id: row.rows[0].id, cookie: `ffc_session=${token}` };
}

// Console-mailer capture for the invite link.
let mailLog = [];
const realLog = console.log;

before(async () => {
  await ensureSchema();
  users.owner = await makeUser("owner");
  users.member = await makeUser("member");
  users.stranger = await makeUser("stranger");
  ({ baseUrl, close } = await listenEphemeral(app));
  console.log = (...args) => {
    const line = args.join(" ");
    if (line.startsWith("[mailer]")) mailLog.push(line);
    else realLog(...args);
  };
});

after(async () => {
  console.log = realLog;
  await close();
  await testQuery(`delete from team where owner_user_id in (select id from app_user where email like $1)`, [
    `team-${stamp}%`,
  ]);
  await testQuery(`delete from app_user where email like $1`, [`team-${stamp}%`]);
  const { pool } = await import("../db.js");
  await pool.end();
});

beforeEach(() => {
  resetTeamRateLimits();
  mailLog = [];
});

function api(path, { method = "GET", cookie, body } = {}) {
  return fetch(`${baseUrl}/api/teams${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let teamId;

test("everything 401s without a session", async () => {
  assert.equal((await api("/", { method: "POST", body: { name: "X" } })).status, 401);
  assert.equal((await api("/")).status, 401);
});

test("create team makes the creator an owner member", async () => {
  const res = await api("/", { method: "POST", cookie: users.owner.cookie, body: { name: "The Putters" } });
  assert.equal(res.status, 200);
  const body = await res.json();
  teamId = body.team.id;
  assert.equal(body.team.name, "The Putters");
  assert.equal(body.team.ownerUserId, users.owner.id);

  const list = await (await api("/", { cookie: users.owner.cookie })).json();
  assert.equal(list.teams.length, 1);
  assert.equal(list.teams[0].role, "owner");
  assert.equal(list.teams[0].members.length, 1);
  assert.equal(list.teams[0].members[0].role, "owner");
});

test("bad names 400", async () => {
  assert.equal((await api("/", { method: "POST", cookie: users.owner.cookie, body: { name: "" } })).status, 400);
  assert.equal(
    (await api("/", { method: "POST", cookie: users.owner.cookie, body: { name: "x".repeat(41) } })).status,
    400
  );
});

test("invite emails a link; accepting joins the team; token is single-use", async () => {
  const inviteRes = await api(`/${teamId}/invites`, {
    method: "POST",
    cookie: users.owner.cookie,
    body: { email: `team-${stamp}-member@example.com` },
  });
  assert.equal(inviteRes.status, 200);
  const mail = mailLog[mailLog.length - 1] ?? "";
  const token = mail.match(/token=([0-9a-f]{64})/)?.[1];
  assert.ok(token, "invite email should carry the accept token");

  // Pending invite visible to the owner.
  const list = await (await api("/", { cookie: users.owner.cookie })).json();
  assert.equal(list.teams[0].pendingInvites.length, 1);

  const acceptRes = await api("/invites/accept", {
    method: "POST",
    cookie: users.member.cookie,
    body: { token },
  });
  assert.equal(acceptRes.status, 200);
  assert.equal((await acceptRes.json()).team.id, teamId);

  const memberList = await (await api("/", { cookie: users.member.cookie })).json();
  assert.equal(memberList.teams.length, 1);
  assert.equal(memberList.teams[0].role, "member");
  assert.equal(memberList.teams[0].members.length, 2);
  // Members don't see pending invite addresses.
  assert.deepEqual(memberList.teams[0].pendingInvites, []);

  // Token is consumed.
  const again = await api("/invites/accept", {
    method: "POST",
    cookie: users.stranger.cookie,
    body: { token },
  });
  assert.equal(again.status, 410);
});

test("permission matrix: strangers 404, members 403 on owner actions", async () => {
  const s = users.stranger.cookie;
  const m = users.member.cookie;
  assert.equal((await api(`/${teamId}`, { method: "PATCH", cookie: s, body: { name: "Nope" } })).status, 404);
  assert.equal((await api(`/${teamId}`, { method: "PATCH", cookie: m, body: { name: "Nope" } })).status, 403);
  assert.equal((await api(`/${teamId}`, { method: "DELETE", cookie: m })).status, 403);
  assert.equal(
    (await api(`/${teamId}/invites`, { method: "POST", cookie: m, body: { email: "x@y.co" } })).status,
    403
  );
  // Member can't remove someone else.
  assert.equal(
    (await api(`/${teamId}/members/${users.owner.id}`, { method: "DELETE", cookie: m })).status,
    403
  );
});

test("rename by owner works", async () => {
  const res = await api(`/${teamId}`, { method: "PATCH", cookie: users.owner.cookie, body: { name: "Renamed" } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).team.name, "Renamed");
});

test("owner can't leave; member can leave; owner can remove a member", async () => {
  // Owner leaving is a 409 (archive instead).
  assert.equal(
    (await api(`/${teamId}/members/${users.owner.id}`, { method: "DELETE", cookie: users.owner.cookie })).status,
    409
  );
  // Member leaves.
  assert.equal(
    (await api(`/${teamId}/members/${users.member.id}`, { method: "DELETE", cookie: users.member.cookie })).status,
    200
  );
  const memberList = await (await api("/", { cookie: users.member.cookie })).json();
  assert.equal(memberList.teams.length, 0);

  // Re-add via a fresh invite, then owner removes them.
  await api(`/${teamId}/invites`, {
    method: "POST",
    cookie: users.owner.cookie,
    body: { email: `team-${stamp}-member@example.com` },
  });
  const token = (mailLog[mailLog.length - 1] ?? "").match(/token=([0-9a-f]{64})/)?.[1];
  await api("/invites/accept", { method: "POST", cookie: users.member.cookie, body: { token } });
  assert.equal(
    (await api(`/${teamId}/members/${users.member.id}`, { method: "DELETE", cookie: users.owner.cookie })).status,
    200
  );
});

test("archive hides the team from lists and invalidates invites", async () => {
  // Mint an invite BEFORE archiving.
  await api(`/${teamId}/invites`, {
    method: "POST",
    cookie: users.owner.cookie,
    body: { email: `team-${stamp}-stranger@example.com` },
  });
  const token = (mailLog[mailLog.length - 1] ?? "").match(/token=([0-9a-f]{64})/)?.[1];

  assert.equal((await api(`/${teamId}`, { method: "DELETE", cookie: users.owner.cookie })).status, 200);
  const list = await (await api("/", { cookie: users.owner.cookie })).json();
  assert.equal(list.teams.length, 0);

  // Accepting an invite to an archived team fails.
  const res = await api("/invites/accept", { method: "POST", cookie: users.stranger.cookie, body: { token } });
  assert.equal(res.status, 410);
});

test("expired invites 410", async () => {
  const createRes = await api("/", { method: "POST", cookie: users.owner.cookie, body: { name: "Fresh" } });
  const freshId = (await createRes.json()).team.id;
  await api(`/${freshId}/invites`, {
    method: "POST",
    cookie: users.owner.cookie,
    body: { email: `team-${stamp}-member@example.com` },
  });
  const token = (mailLog[mailLog.length - 1] ?? "").match(/token=([0-9a-f]{64})/)?.[1];
  await testQuery(`update team_invite set expires_at = now() - interval '1 minute' where team_id = $1`, [freshId]);
  const res = await api("/invites/accept", { method: "POST", cookie: users.member.cookie, body: { token } });
  assert.equal(res.status, 410);
});
