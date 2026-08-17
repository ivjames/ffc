// Integration coverage for POST /api/challenges/:id/invite — the challenge
// code's first delivery path that isn't the player's own voice.
//
// What matters here is not "an email was composed" but that the envelope can't
// be aimed by anyone but the challenger, and can't be aimed at a challenge
// that's already settled:
//   - A CHALLENGE ID IS STILL NOT A CAPABILITY. Guessing one must not let a
//     stranger mail its code out.
//   - THE OPPONENT SLOT IS SINGLE-USE. Inviting into a taken or expired
//     challenge sends someone a link to a dead end.
//   - THE MAIL CARRIES THE JOIN LINK FOR THE VENUE HOST THE PLAYER IS ON, not
//     the global fallback — a link to another venue's host signs them in
//     there and leaves them signed out at their own (lib/appOrigin.js).
//
// Every request goes through hostRequest with a venue Host, because that host
// is what resolves the tenant (and therefore the location, the mail
// attribution, and the link origin) — undici's fetch can't set Host at all.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery } from "../test-support/testDb.js";
import { hostRequest } from "../test-support/hostRequest.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.MAIL_PROVIDER; // console provider — the message lands in stdout
process.env.PLATFORM_FQDN = "ffc.test";
// A distinctive fallback, so "the link used the request's host" is provable by
// the fallback's ABSENCE rather than by a lucky match.
process.env.PUBLIC_APP_URL = "https://fallback.example";

const { app } = await import("../app.js");
const { createUserSession } = await import("../lib/userAuth.js");
const { clearTenantCache } = await import("../lib/tenant.js");
const { resetChallengeRateLimits } = await import("./challenges.js");

let locationId, orgSlug, venueHost;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const cleanup = { locations: [], orgs: [] };

// Console-mailer capture: in dev the console provider logs the whole message,
// which is how the link and the code get asserted without a fake provider.
let mailLog = [];
const realLog = console.log;

function call(method, path, body, cookie, host = venueHost) {
  return hostRequest(app, {
    method,
    path: `/api/challenges${path}`,
    host,
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
    ...(body === undefined ? {} : { body }),
  });
}

let userSeq = 0;
async function player(tag) {
  const email = `chalinv-${stamp}-${userSeq++}@example.com`;
  const row = await testQuery(
    `insert into app_user (email, email_verified_at, default_tag, display_name)
       values ($1, now(), $2, $3) returning id`,
    [email, tag, tag]
  );
  const { token } = await createUserSession(row.rows[0].id);
  return { id: row.rows[0].id, cookie: `ffc_session=${token}` };
}

async function create(cookie) {
  const res = await call("POST", "/", { locationId, game: "skeeball" }, cookie);
  assert.equal(res.status, 200, `create failed: ${res.text}`);
  return res.body.challenge;
}

let challenger, opponent, stranger;

before(async () => {
  await ensureSchema();
  orgSlug = `chalinv-org-${stamp}`;
  venueHost = `${orgSlug}.ffc.test`;
  const org = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Chal Invite Org ${stamp}`,
    orgSlug,
  ]);
  cleanup.orgs.push(org.rows[0].id);
  const loc = await testQuery(
    `insert into location (name, slug, tz, org_id) values ($1, $2, 'UTC', $3) returning id`,
    [`Chal Invite ${stamp}`, `chalinv-${stamp}`, org.rows[0].id]
  );
  locationId = loc.rows[0].id;
  cleanup.locations.push(locationId);
  clearTenantCache(); // the org above was created after the process started

  challenger = await player("CHA");
  opponent = await player("OPP");
  stranger = await player("STR");

  console.log = (...args) => {
    const line = args.join(" ");
    if (line.startsWith("[mailer]")) mailLog.push(line);
    else realLog(...args);
  };
});

after(async () => {
  console.log = realLog;
  await testQuery(`delete from mail_send where recipient like $1`, [`rival-${stamp}%`]);
  await testQuery(`delete from challenge where location_id = any($1::uuid[])`, [cleanup.locations]);
  await testQuery(`delete from game_score where location_id = any($1::uuid[])`, [cleanup.locations]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [cleanup.locations]);
  await testQuery(`delete from app_user where email like $1`, [`chalinv-${stamp}%`]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [cleanup.orgs]);
  const { pool } = await import("../db.js");
  await pool.end();
});

beforeEach(() => {
  resetChallengeRateLimits();
  mailLog = [];
});

test("the invite mails a venue-host join link carrying the code, and meters the send", async () => {
  const challenge = await create(challenger.cookie);
  const to = `rival-${stamp}-a@example.com`;

  const res = await call("POST", `/${challenge.id}/invite`, { email: to }, challenger.cookie);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { ok: true });

  const message = mailLog.join("\n");
  // The link lands on the join screen with the code pre-filled — the whole
  // point of mailing it rather than reciting it — on the venue's own host.
  assert.match(
    message,
    new RegExp(`http://${orgSlug}\\.ffc\\.test/arcade/challenges\\?code=${challenge.inviteCode}`)
  );
  assert.doesNotMatch(message, /fallback\.example/);
  assert.match(message, /Skee-?Ball/i);
  assert.match(message, /CHA/); // who is challenging them

  const metered = await testQuery(
    `select kind, org_slug as "orgSlug" from mail_send where recipient = $1`,
    [to]
  );
  assert.equal(metered.rowCount, 1);
  assert.equal(metered.rows[0].kind, "challenge_invite");
  // Attributed to the tenant, so one venue can't spend another's mail budget.
  assert.equal(metered.rows[0].orgSlug, orgSlug);
});

test("only the challenger may invite, and only into an unclaimed challenge", async () => {
  const challenge = await create(challenger.cookie);
  const to = `rival-${stamp}-b@example.com`;

  // Anonymous: no session, no invite.
  assert.equal((await call("POST", `/${challenge.id}/invite`, { email: to })).status, 401);

  // A stranger who guessed the id gets the same answer as a nonexistent one.
  const guessed = await call("POST", `/${challenge.id}/invite`, { email: to }, stranger.cookie);
  assert.equal(guessed.status, 404);

  // The opponent is a party, but the slot they'd be advertising is their own.
  const joined = await call("POST", "/join", { inviteCode: challenge.inviteCode }, opponent.cookie);
  assert.equal(joined.status, 200, joined.text);
  const byOpponent = await call("POST", `/${challenge.id}/invite`, { email: to }, opponent.cookie);
  assert.equal(byOpponent.status, 403);

  // And now that it's claimed, the challenger can't send anyone to a dead end.
  const taken = await call("POST", `/${challenge.id}/invite`, { email: to }, challenger.cookie);
  assert.equal(taken.status, 409);
  assert.match(taken.body.error, /already took/);

  assert.deepEqual(mailLog, []); // none of the above sent anything
});

test("an expired challenge can't be advertised", async () => {
  const challenge = await create(challenger.cookie);
  await testQuery(`update challenge set expires_at = now() - interval '1 day' where id = $1`, [
    challenge.id,
  ]);

  const res = await call(
    "POST",
    `/${challenge.id}/invite`,
    { email: `rival-${stamp}-c@example.com` },
    challenger.cookie
  );
  assert.equal(res.status, 409);
  assert.match(res.body.error, /closed/);
  assert.deepEqual(mailLog, []);
});

test("a bad address is rejected before anything is sent", async () => {
  const challenge = await create(challenger.cookie);
  for (const email of ["not-an-address", "", null, 42]) {
    const res = await call("POST", `/${challenge.id}/invite`, { email }, challenger.cookie);
    assert.equal(res.status, 400, `accepted ${JSON.stringify(email)}`);
  }
  assert.deepEqual(mailLog, []);
});

test("a failing provider is reported, not swallowed — the code can still be read aloud", async () => {
  const challenge = await create(challenger.cookie);
  const to = `rival-${stamp}-d@example.com`;
  // resend with no key: sendMail returns ok:false without touching the network.
  process.env.MAIL_PROVIDER = "resend";
  try {
    const res = await call("POST", `/${challenge.id}/invite`, { email: to }, challenger.cookie);
    assert.equal(res.status, 502);
    assert.equal(res.body.ok, false);
  } finally {
    delete process.env.MAIL_PROVIDER;
  }
  // A failed send is not metered — it spent no quota.
  const metered = await testQuery(`select 1 from mail_send where recipient = $1`, [to]);
  assert.equal(metered.rowCount, 0);
});

test("invites are rate limited per user", async () => {
  const challenge = await create(challenger.cookie);
  const send = () =>
    call("POST", `/${challenge.id}/invite`, { email: `rival-${stamp}-e@example.com` }, challenger.cookie);
  for (let i = 0; i < 5; i++) assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 429);
});
