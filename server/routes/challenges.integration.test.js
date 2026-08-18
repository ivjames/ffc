// Integration coverage for head-to-head challenges (/api/challenges).
//
// The rules worth pinning down are the ones that decide a rivalry:
//   - ONE ROUND EACH. Without it a player replays until the score is good
//     enough, and every challenge is won by whoever cared more.
//   - THE WINNER COMES FROM THE GAME'S OWN DIRECTION. A go-kart challenge is
//     won by the FASTER lap; using the default comparator would hand it to the
//     slowest driver, and nothing in the UI would look wrong.
//   - A CHALLENGE ID IS NOT A CAPABILITY. A stranger who guesses one must not
//     be able to read it or add a round to it.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery, listenEphemeral } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");
const { createUserSession } = await import("../lib/userAuth.js");
const { resetChallengeRateLimits } = await import("./challenges.js");

let baseUrl, close, locationId;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const userEmails = [];
const locationIds = [];

let sessionSeq = 0;
const sid = () => `chal-sess-${stamp}-${sessionSeq++}`;

function call(method, path, body, cookie) {
  return fetch(`${baseUrl}/api/challenges${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

let userSeq = 0;
async function player(tag) {
  const email = `chal-${stamp}-${userSeq++}@example.com`;
  userEmails.push(email);
  const row = await testQuery(
    `insert into app_user (email, email_verified_at, default_tag) values ($1, now(), $2) returning id`,
    [email, tag]
  );
  const id = row.rows[0].id;
  const { token } = await createUserSession(id);
  return { cookie: `ffc_session=${token}`, id };
}

async function create(cookie, over = {}) {
  const res = await call("POST", "/", { locationId, game: "skeeball", ...over }, cookie);
  assert.equal(res.status, 200, `create failed: ${await res.clone().text()}`);
  return (await res.json()).challenge;
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const loc = await testQuery(
    `insert into location (name, slug, tz) values ($1, $2, 'UTC') returning id`,
    [`Chal ${stamp}`, `chal-${stamp}`]
  );
  locationId = loc.rows[0].id;
  locationIds.push(locationId);
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from game_score where location_id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from challenge where location_id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from app_user where email = any($1::text[])`, [userEmails]);
});

beforeEach(() => resetChallengeRateLimits());

test("a challenge needs an account and a known game", async () => {
  const anon = await call("POST", "/", { locationId, game: "skeeball" });
  assert.equal(anon.status, 401);

  const { cookie } = await player("AAA");
  const bad = await call("POST", "/", { locationId, game: "coinpusher" }, cookie);
  assert.equal(bad.status, 400);
  // A variant game must name one, exactly as the boards require.
  const noVariant = await call("POST", "/", { locationId, game: "gokarts" }, cookie);
  assert.equal(noVariant.status, 400);
});

test("the full async flow: A plays, sends the code, B answers it later", async () => {
  const a = await player("AAA");
  const b = await player("BBB");
  const challenge = await create(a.cookie);
  assert.equal(challenge.status, "open");
  assert.ok(challenge.inviteCode);

  // A plays first, before anyone has taken the challenge.
  const aPlay = await call("POST", `/${challenge.id}/play`, { score: 320, sessionId: sid() }, a.cookie);
  assert.equal(aPlay.status, 200);
  const afterA = await aPlay.json();
  assert.equal(afterA.challenge.status, "open", "one entry is not a result");
  assert.equal(afterA.winnerId, null);

  // B takes the code, plays, and the challenge resolves.
  const joined = await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie);
  assert.equal(joined.status, 200);
  const bPlay = await call("POST", `/${challenge.id}/play`, { score: 410, sessionId: sid() }, b.cookie);
  const result = await bPlay.json();
  assert.equal(result.challenge.status, "complete");
  assert.equal(result.winnerId, b.id, "410 beats 320 on a points game");
  assert.equal(result.youWon, true);

  // And A sees the same outcome from their side.
  const aView = await (await call("GET", `/${challenge.id}`, null, a.cookie)).json();
  assert.equal(aView.winnerId, b.id);
  assert.equal(aView.youWon, false);
});

test("on a LOW-direction game the faster lap wins", async () => {
  // The whole reason the winner is read from the game's registry entry: with
  // the default comparator this challenge would go to the slower driver.
  const a = await player("FST");
  const b = await player("SLW");
  const challenge = await create(a.cookie, { game: "gokarts", variant: "speedway" });
  await call("POST", `/${challenge.id}/play`, { score: 18_400, sessionId: sid() }, a.cookie);
  await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie);
  const res = await call("POST", `/${challenge.id}/play`, { score: 25_900, sessionId: sid() }, b.cookie);

  const result = await res.json();
  assert.equal(result.challenge.status, "complete");
  assert.equal(result.winnerId, a.id, "18.4s beats 25.9s");
});

test("one round each — no replaying until the score is good enough", async () => {
  const a = await player("ONE");
  const b = await player("TWO");
  const challenge = await create(a.cookie);
  const first = await call("POST", `/${challenge.id}/play`, { score: 100, sessionId: sid() }, a.cookie);
  assert.equal(first.status, 200);

  const again = await call("POST", `/${challenge.id}/play`, { score: 999, sessionId: sid() }, a.cookie);
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /already played/);

  await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie);
  await call("POST", `/${challenge.id}/play`, { score: 200, sessionId: sid() }, b.cookie);
  const view = await (await call("GET", `/${challenge.id}`, null, a.cookie)).json();
  assert.equal(view.challenger.score, 100, "the first round stands");
  assert.equal(view.winnerId, b.id);
});

test("a tie is a tie, not a win for whoever played first", async () => {
  const a = await player("TIE");
  const b = await player("TIB");
  const challenge = await create(a.cookie);
  await call("POST", `/${challenge.id}/play`, { score: 250, sessionId: sid() }, a.cookie);
  await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie);
  const res = await call("POST", `/${challenge.id}/play`, { score: 250, sessionId: sid() }, b.cookie);

  const result = await res.json();
  assert.equal(result.tied, true);
  assert.equal(result.winnerId, null);
  assert.equal(result.youWon, false);
});

test("a challenge round also lands on the venue's high score board", async () => {
  const a = await player("BRD");
  const challenge = await create(a.cookie);
  const session = sid();
  await call("POST", `/${challenge.id}/play`, { score: 777, sessionId: session }, a.cookie);

  const board = await fetch(
    `${baseUrl}/api/game-scores/board?game=skeeball&locationId=${locationId}&limit=50`
  );
  const { board: rows } = await board.json();
  assert.ok(
    rows.some((r) => r.userId === a.id && r.score === 777),
    "a challenge round is a real round"
  );
});

test("a challenge round is not its own previous best", async () => {
  // Two paths write the same (game, sessionId) board row — this one and
  // POST /api/game-scores — and both are idempotent. If the challenge write
  // lands first, an unfiltered previous-best read sees the round that just
  // happened and reports it as the score to beat, silently suppressing the
  // personal-best celebration depending on which request won.
  const a = await player("PBS");
  const challenge = await create(a.cookie);
  const shared = sid();
  await call("POST", `/${challenge.id}/play`, { score: 500, sessionId: shared }, a.cookie);

  // Now the board write for the same round arrives (the end screen's own post).
  const res = await fetch(`${baseUrl}/api/game-scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: a.cookie },
    body: JSON.stringify({ locationId, game: "skeeball", score: 500, sessionId: shared }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.previousBest, null, "this round is not the score it had to beat");
  assert.equal(body.isPersonalBest, true, "so the celebration still fires");
});

test("a stranger can neither read nor play someone else's challenge", async () => {
  const a = await player("OWN");
  const stranger = await player("NOS");
  const challenge = await create(a.cookie);

  // 404, not 403 — a non-party has no business learning the id is real.
  const read = await call("GET", `/${challenge.id}`, null, stranger.cookie);
  assert.equal(read.status, 404);

  const play = await call("POST", `/${challenge.id}/play`, { score: 999, sessionId: sid() }, stranger.cookie);
  assert.equal(play.status, 403);
});

test("you cannot take your own challenge, and only one person can take it", async () => {
  const a = await player("SLF");
  const b = await player("FST2");
  const c = await player("LTE");
  const challenge = await create(a.cookie);

  const self = await call("POST", "/join", { inviteCode: challenge.inviteCode }, a.cookie);
  assert.equal(self.status, 409);
  assert.match((await self.json()).error, /your own/);

  assert.equal((await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie)).status, 200);
  const late = await call("POST", "/join", { inviteCode: challenge.inviteCode }, c.cookie);
  assert.equal(late.status, 409);
  assert.match((await late.json()).error, /already took/);
});

test("an expired challenge cannot be joined or played", async () => {
  const a = await player("EXP");
  const b = await player("EXB");
  const challenge = await create(a.cookie);
  await testQuery(`update challenge set expires_at = now() - interval '1 day' where id = $1`, [
    challenge.id,
  ]);

  const join = await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie);
  assert.equal(join.status, 409);
  const play = await call("POST", `/${challenge.id}/play`, { score: 10, sessionId: sid() }, a.cookie);
  assert.equal(play.status, 409);
});

test("retrying a submit whose response was lost returns the round, not a refusal", async () => {
  // The client keeps its marker armed through a transient failure — losing a
  // round to a dropped response would be worse than a duplicate. So the retry
  // arrives with the SAME session id, and answering it with the same 409 that
  // means "you already played" turns the retry into the thing that loses the
  // round: the marker clears on a definitive-looking refusal and the result
  // never appears.
  const a = await player("RTA");
  const b = await player("RTB");
  const challenge = await create(a.cookie);
  await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie);

  const round = sid();
  const first = await call("POST", `/${challenge.id}/play`, { score: 42, sessionId: round }, a.cookie);
  assert.equal(first.status, 200);

  const retry = await call("POST", `/${challenge.id}/play`, { score: 42, sessionId: round }, a.cookie);
  assert.equal(retry.status, 200, "the same round replayed is the same outcome");
  const view = await retry.json();
  assert.equal(view.challenger.score, 42);

  // A genuinely different round is still refused — this is the one-round rule,
  // and it is the whole reason the endpoint is not simply an upsert.
  const second = await call("POST", `/${challenge.id}/play`, { score: 99, sessionId: sid() }, a.cookie);
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /already played/);

  // And the score stands at what was actually played.
  const after = await (await call("GET", `/${challenge.id}`, null, a.cookie)).json();
  assert.equal(after.challenger.score, 42);
});

test("a replayed round cannot move a settled challenge's completion", async () => {
  const a = await player("RPA");
  const b = await player("RPB");
  const challenge = await create(a.cookie);
  await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie);

  const round = sid();
  await call("POST", `/${challenge.id}/play`, { score: 10, sessionId: round }, a.cookie);
  await call("POST", `/${challenge.id}/play`, { score: 20, sessionId: sid() }, b.cookie);

  const settled = await testQuery(`select status, completed_at from challenge where id = $1`, [
    challenge.id,
  ]);
  assert.equal(settled.rows[0].status, "complete");

  const replay = await call("POST", `/${challenge.id}/play`, { score: 10, sessionId: round }, a.cookie);
  assert.equal(replay.status, 200);
  const again = await testQuery(`select status, completed_at from challenge where id = $1`, [
    challenge.id,
  ]);
  assert.equal(again.rows[0].status, "complete");
  assert.deepEqual(
    again.rows[0].completed_at,
    settled.rows[0].completed_at,
    "the settled time is when it settled, not when someone's phone retried"
  );
});

test("the list expires stale challenges instead of offering a round that will be refused", async () => {
  // The TTL is applied lazily, and /mine was the one read that never applied
  // it — so a week-old challenge kept its stored 'open' status, sorted into
  // the Open section, and offered a "Play your round" button that /play then
  // refused with a 409.
  const a = await player("MEX");
  const stale = await create(a.cookie);
  await testQuery(`update challenge set expires_at = now() - interval '1 day' where id = $1`, [
    stale.id,
  ]);

  const { challenges } = await (await call("GET", "/mine", null, a.cookie)).json();
  const listed = challenges.find((c) => c.challenge.id === stale.id);
  assert.equal(listed.challenge.status, "expired");

  // Persisted, not merely reported: the row itself is settled now.
  const row = await testQuery(`select status from challenge where id = $1`, [stale.id]);
  assert.equal(row.rows[0].status, "expired");
});

test("/mine lists both sides' challenges, open ones first", async () => {
  const a = await player("MIN");
  const b = await player("MIO");
  const mineOpen = await create(a.cookie);
  const theirs = await create(b.cookie);
  await call("POST", "/join", { inviteCode: theirs.inviteCode }, a.cookie);

  const res = await call("GET", "/mine", null, a.cookie);
  const { challenges } = await res.json();
  const ids = challenges.map((c) => c.challenge.id);
  assert.ok(ids.includes(mineOpen.id), "one I issued");
  assert.ok(ids.includes(theirs.id), "one I accepted");

  // Open challenges sort ahead of finished ones — the list is a to-do list of
  // live rivalries, not a history.
  const statuses = challenges.map((c) => c.challenge.status);
  const lastOpen = statuses.lastIndexOf("open");
  const firstClosed = statuses.findIndex((s) => s !== "open");
  if (lastOpen !== -1 && firstClosed !== -1) {
    assert.ok(lastOpen < firstClosed, `open challenges come first, got ${statuses.join(",")}`);
  }
});

test("an open challenge stops working if the venue loses the arcade module", async () => {
  // Entitlements are rechecked on every mutation, not assumed from creation:
  // a challenge is open for a week, so it easily outlives the module.
  const a = await player("ENT");
  const b = await player("ENU");
  const challenge = await create(a.cookie);

  await testQuery(`update location set modules = $1::jsonb where id = $2`, [
    JSON.stringify({ arcade: false }),
    locationId,
  ]);
  try {
    const join = await call("POST", "/join", { inviteCode: challenge.inviteCode }, b.cookie);
    assert.equal(join.status, 403);
    const play = await call("POST", `/${challenge.id}/play`, { score: 10, sessionId: sid() }, a.cookie);
    assert.equal(play.status, 403);
  } finally {
    await testQuery(`update location set modules = '{}'::jsonb where id = $1`, [locationId]);
  }
});

test("a bad invite code 404s", async () => {
  const { cookie } = await player("BAD");
  const res = await call("POST", "/join", { inviteCode: "ZZZZZZ" }, cookie);
  assert.equal(res.status, 404);
});
