// Integration coverage for live trivia (/api/trivia) — the bar-trivia mode.
//
// Two things carry real risk here and get the most attention:
//
//   1. THE ANSWER LEAKING. A player payload that carries the answer index
//      while the question is still open silently turns the whole game into a
//      trust exercise. Nothing about the UI would look wrong.
//   2. ONE ANSWER PER TEAM. Several devices share one entrant at a table; if
//      each could answer, a table could brute-force every choice and score
//      every question.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery, listenEphemeral } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");
const { createUserSession } = await import("../lib/userAuth.js");
const { resetTriviaRateLimits } = await import("./triviaLive.js");
const { BASE_POINTS, MAX_SPEED_BONUS } = await import("../lib/triviaLive.js");

let baseUrl, close;
let locationId;
let hostCookie;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const userEmails = [];
const locationIds = [];
const sessionIds = [];

const json = (res) => res.json();

function post(path, body, cookie) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

let userSeq = 0;
async function player() {
  const email = `trivia-${stamp}-${userSeq++}@example.com`;
  userEmails.push(email);
  const row = await testQuery(
    `insert into app_user (email, email_verified_at) values ($1, now()) returning id`,
    [email]
  );
  const { token } = await createUserSession(row.rows[0].id);
  return `ffc_session=${token}`;
}

/** Create a session and return { id, hostToken, joinCode }. */
async function createSession(overrides = {}) {
  const res = await post(
    "/api/trivia/sessions",
    { locationId, questionCount: 3, ...overrides },
    hostCookie
  );
  assert.equal(res.status, 200, `create failed: ${await res.clone().text()}`);
  const body = await json(res);
  sessionIds.push(body.session.id);
  return { id: body.session.id, hostToken: body.hostToken, joinCode: body.session.joinCode };
}

async function join(joinCode, name, extra = {}) {
  const res = await post("/api/trivia/sessions/join", { joinCode, name, ...extra });
  assert.equal(res.status, 200, `join failed: ${await res.clone().text()}`);
  return json(res);
}

const advance = (id, hostToken) => post(`/api/trivia/sessions/${id}/advance`, { host: hostToken });

/** The current question's correct index, read straight from the DB (the host
 *  API would also serve it, but the DB keeps the test independent of that). */
async function correctChoice(sessionId) {
  const s = await testQuery(
    `select question_ids, current_index from trivia_session where id = $1`,
    [sessionId]
  );
  const { question_ids: ids, current_index: idx } = s.rows[0];
  const q = await testQuery(`select answer from trivia_question where id = $1`, [ids[idx]]);
  return q.rows[0].answer;
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const loc = await testQuery(
    `insert into location (name, slug, tz) values ($1, $2, 'UTC') returning id`,
    [`Trivia ${stamp}`, `trivia-${stamp}`]
  );
  locationId = loc.rows[0].id;
  locationIds.push(locationId);
  hostCookie = await player();
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from trivia_session where id = any($1::uuid[])`, [sessionIds]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from app_user where email = any($1::text[])`, [userEmails]);
});

beforeEach(() => resetTriviaRateLimits());

test("the platform question pack is seeded, so a venue can run a game immediately", async () => {
  const res = await fetch(`${baseUrl}/api/trivia/categories?locationId=${locationId}`);
  const body = await json(res);
  assert.equal(res.status, 200);
  const total = body.categories.reduce((n, c) => n + c.n, 0);
  assert.ok(total >= 3, `expected a seeded bank, got ${total} questions`);
});

test("creating needs an account; joining does not", async () => {
  const anon = await post("/api/trivia/sessions", { locationId, questionCount: 3 });
  assert.equal(anon.status, 401);

  const { joinCode } = await createSession();
  // A walk-up guest with no account can still play — that's the point of a
  // room game.
  const joined = await join(joinCode, "Guest Table");
  assert.ok(joined.participantToken);
});

test("a player mid-question never receives the answer; the host always does", async () => {
  const { id, hostToken, joinCode } = await createSession();
  const { participantToken } = await join(joinCode, "Sneaky");
  await advance(id, hostToken); // lobby -> question

  const playerView = await json(
    await fetch(`${baseUrl}/api/trivia/sessions/${id}?participant=${participantToken}`)
  );
  assert.equal(playerView.session.status, "question");
  assert.ok(playerView.question, "the player sees the question");
  assert.ok(Array.isArray(playerView.question.choices));
  assert.equal(
    playerView.question.answer,
    undefined,
    "the answer must not travel to a phone that can still answer"
  );
  // Belt and braces: nothing anywhere in the serialized player payload.
  assert.ok(!JSON.stringify(playerView).includes('"answer"'));

  const hostView = await json(
    await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`)
  );
  assert.equal(typeof hostView.question.answer, "number", "the host reads it out");
});

test("the answer appears to players only once the question closes", async () => {
  const { id, hostToken, joinCode } = await createSession();
  const { participantToken } = await join(joinCode, "Patient");
  await advance(id, hostToken); // -> question
  await advance(id, hostToken); // -> reveal

  const view = await json(
    await fetch(`${baseUrl}/api/trivia/sessions/${id}?participant=${participantToken}`)
  );
  assert.equal(view.session.status, "reveal");
  assert.equal(typeof view.question.answer, "number");
});

test("a correct answer scores, a wrong one scores nothing", async () => {
  const { id, hostToken, joinCode } = await createSession({ config: { speedBonus: false } });
  const right = await join(joinCode, "Right");
  const wrong = await join(joinCode, "Wrong");
  await advance(id, hostToken);

  const answer = await correctChoice(id);
  await post(`/api/trivia/sessions/${id}/answer`, {
    participant: right.participantToken,
    choice: answer,
  });
  await post(`/api/trivia/sessions/${id}/answer`, {
    participant: wrong.participantToken,
    choice: answer === 0 ? 1 : 0,
  });

  const view = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
  const byName = Object.fromEntries(view.board.map((e) => [e.name, e.score]));
  assert.equal(byName.Right, BASE_POINTS);
  assert.equal(byName.Wrong, 0, "no partial credit for wrong-but-fast");
  assert.equal(view.board[0].name, "Right", "the board sorts by score");
});

test("the speed bonus pays on top of the base, and only when enabled", async () => {
  const { id, hostToken, joinCode } = await createSession({ config: { speedBonus: true } });
  const quick = await join(joinCode, "Quick");
  await advance(id, hostToken);
  await post(`/api/trivia/sessions/${id}/answer`, {
    participant: quick.participantToken,
    choice: await correctChoice(id),
  });

  const view = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
  const score = view.board.find((e) => e.name === "Quick").score;
  assert.ok(score > BASE_POINTS, `a fast answer should beat the base, got ${score}`);
  assert.ok(score <= BASE_POINTS + MAX_SPEED_BONUS);
});

test("one answer per TEAM, however many phones are at the table", async () => {
  const { id, hostToken, joinCode } = await createSession({ config: { speedBonus: false } });
  const first = await join(joinCode, "Table 4", { isTeam: true });
  // A second phone sits down at the same table: same entrant, own token.
  const second = await join(joinCode, null, { entrantId: first.entrant.id });
  assert.equal(second.entrant.id, first.entrant.id);
  assert.notEqual(second.participantToken, first.participantToken);

  await advance(id, hostToken);
  const answer = await correctChoice(id);

  const a = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: first.participantToken,
    choice: answer,
  });
  assert.equal(a.status, 200);
  // Without the per-(session, entrant, question) key this second tap would
  // score again — and a table could just tap every choice.
  const b = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: second.participantToken,
    choice: answer === 0 ? 1 : 0,
  });
  assert.equal(b.status, 409);
  assert.match((await json(b)).error, /already answered/);

  const view = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
  assert.equal(view.board.find((e) => e.name === "Table 4").score, BASE_POINTS);
});

test("answers are refused outside an open question", async () => {
  const { id, hostToken, joinCode } = await createSession();
  const { participantToken } = await join(joinCode, "Eager");

  // Still in the lobby.
  const early = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: participantToken,
    choice: 0,
  });
  assert.equal(early.status, 409);

  await advance(id, hostToken); // -> question
  await advance(id, hostToken); // -> reveal
  const late = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: participantToken,
    choice: 0,
  });
  assert.equal(late.status, 409, "the buzzer has gone");
});

test("the host walks the state machine to a final board", async () => {
  const { id, hostToken, joinCode } = await createSession({ questionCount: 3 });
  await join(joinCode, "Solo");

  // lobby -> (question, reveal) per question -> final. Three questions is
  // seven advances; the bound is generous so a regression that never reaches
  // 'final' fails on the assertion rather than looping forever.
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const body = await json(await advance(id, hostToken));
    seen.push(`${body.session.status}:${body.session.currentIndex}`);
    if (body.session.status === "final") break;
  }
  assert.deepEqual(seen, [
    "question:0",
    "reveal:0",
    "question:1",
    "reveal:1",
    "question:2",
    "reveal:2",
    "final:2",
  ]);

  const done = await advance(id, hostToken);
  assert.equal(done.status, 409, "a finished game cannot be advanced");
});

test("host controls require the host token — a participant token will not do", async () => {
  const { id, joinCode } = await createSession();
  const { participantToken } = await join(joinCode, "Impostor");

  const asPlayer = await post(`/api/trivia/sessions/${id}/advance`, { host: participantToken });
  assert.equal(asPlayer.status, 404);
  const noToken = await post(`/api/trivia/sessions/${id}/advance`, {});
  assert.equal(noToken.status, 404);
});

test("a bad join code, and a full-name collision, behave sensibly", async () => {
  const bad = await post("/api/trivia/sessions/join", { joinCode: "ZZZZZZ", name: "Nobody" });
  assert.equal(bad.status, 404);

  // Two phones typing the same table name join the SAME table rather than
  // colliding on the unique constraint.
  const { joinCode } = await createSession();
  const one = await join(joinCode, "Same Name");
  const two = await join(joinCode, "Same Name");
  assert.equal(one.entrant.id, two.entrant.id);
});

test("a venue cannot deal another client's questions", async () => {
  // A question owned by some other org must never enter this venue's bank.
  const org = await testQuery(
    `insert into org (name, slug) values ($1, $2) returning id`,
    [`Rival ${stamp}`, `rival-${stamp}`]
  );
  const orgId = org.rows[0].id;
  await testQuery(
    `insert into trivia_question (org_id, category, prompt, choices, answer)
     values ($1, 'Secret', $2, '["a","b"]'::jsonb, 0)`,
    [orgId, `rival-only-${stamp}`]
  );
  try {
    const res = await fetch(`${baseUrl}/api/trivia/categories?locationId=${locationId}`);
    const body = await json(res);
    assert.ok(
      !body.categories.some((c) => c.category === "Secret"),
      "another org's category must not appear"
    );
  } finally {
    await testQuery(`delete from trivia_question where org_id = $1`, [orgId]);
    await testQuery(`delete from org where id = $1`, [orgId]);
  }
});
