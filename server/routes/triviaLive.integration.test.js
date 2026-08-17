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

test("the answer is absent from the player's SSE FRAME, not just their render", async () => {
  // The REST snapshot test above proves the payload shape; this proves the
  // wire. Publishing one `{player, host}` frame to a shared channel put the
  // correct answer in front of every phone in the room — the client picking
  // `payload.player` is a rendering choice, and anyone can open devtools.
  const { id, hostToken, joinCode } = await createSession();
  const { participantToken } = await join(joinCode, "Wiretap");

  const frames = [];
  const controller = new AbortController();
  const stream = fetch(
    `${baseUrl}/api/trivia/sessions/${id}/events?participant=${participantToken}`,
    { signal: controller.signal }
  ).then(async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        frames.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // aborted below — that's the exit path
    }
  });

  // Let the stream open, then move the game into a live question.
  await new Promise((r) => setTimeout(r, 150));
  await advance(id, hostToken);
  await new Promise((r) => setTimeout(r, 250));
  controller.abort();
  await stream;

  const wire = frames.join("");
  assert.ok(wire.includes('"prompt"'), `expected the question on the wire, got: ${wire.slice(0, 300)}`);
  assert.ok(!wire.includes('"answer"'), "the answer index must never reach a player's stream");
  assert.ok(!wire.includes('"host"'), "and neither must the host payload");
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

test("the countdown actually closes answers, not just the host advancing", async () => {
  // With only a status check, the configured question length was decorative:
  // while a host chatted before hitting reveal, the timer sat at 0:00 on every
  // phone and answers were still accepted — which deletes the speed bonus as a
  // mechanic, because waiting costs nothing.
  const { id, hostToken, joinCode } = await createSession({
    config: { questionSeconds: 5, speedBonus: false },
  });
  const late = await join(joinCode, "Late");
  await advance(id, hostToken); // -> question

  // Backdate the question's open time past its window + grace, leaving the
  // session in 'question' exactly as a slow host would.
  await testQuery(
    `update trivia_session set asked_at = now() - interval '30 seconds' where id = $1`,
    [id]
  );

  const res = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: late.participantToken,
    choice: await correctChoice(id),
  });
  assert.equal(res.status, 409);
  assert.match((await json(res)).error, /time/i);

  const view = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
  assert.equal(view.board.find((e) => e.name === "Late").score, 0, "a late answer scores nothing");
});

test("an answer inside the window is still accepted despite network slack", async () => {
  // The deadline carries a grace allowance; a tap that landed in time must not
  // be thrown away by its own latency.
  const { id, hostToken, joinCode } = await createSession({
    config: { questionSeconds: 20, speedBonus: false },
  });
  const onTime = await join(joinCode, "OnTime");
  await advance(id, hostToken);

  const res = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: onTime.participantToken,
    choice: await correctChoice(id),
  });
  assert.equal(res.status, 200);
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

test("a bad join code 404s", async () => {
  const bad = await post("/api/trivia/sessions/join", { joinCode: "ZZZZZZ", name: "Nobody" });
  assert.equal(bad.status, 404);
});

test("a name collision merges only when BOTH sides mean 'that table'", async () => {
  const { joinCode } = await createSession();

  // Two people who happen to share a name are two players, not one table.
  // Merging them would pool their scores and — because one entrant may answer
  // once — make the second one's answer bounce with "already answered".
  const soloA = await join(joinCode, "Same Name");
  const soloB = await join(joinCode, "Same Name");
  assert.notEqual(soloA.entrant.id, soloB.entrant.id, "two solo players stay separate");
  assert.notEqual(soloB.entrant.name, soloA.entrant.name, "and are told apart on the board");

  // A second phone sitting down at an existing TABLE is the case that merges,
  // and only when both sides say so.
  const { joinCode: code2 } = await createSession();
  const table = await join(code2, "Table 7", { isTeam: true });
  const alsoTable = await join(code2, "Table 7", { isTeam: true });
  assert.equal(alsoTable.entrant.id, table.entrant.id, "same table, one score");

  // A solo player who types an existing table's name is not joining it.
  const notTable = await join(code2, "Table 7");
  assert.notEqual(notTable.entrant.id, table.entrant.id);
});

test("both players at a table can still be told apart from the room", async () => {
  // Regression guard for the disambiguation: names must stay unique per
  // session, or the board shows two identical rows.
  const { joinCode } = await createSession();
  const names = new Set();
  for (let i = 0; i < 3; i++) {
    const r = await join(joinCode, "Dave");
    assert.ok(!names.has(r.entrant.name), `duplicate name issued: ${r.entrant.name}`);
    names.add(r.entrant.name);
  }
});

test("a max-length name still disambiguates instead of 500ing", async () => {
  // Appending " (2)" and THEN truncating to the 32-char limit hands back the
  // original name, so the "disambiguated" insert collides with the row it was
  // meant to differ from. The base has to be trimmed to make room.
  const { joinCode } = await createSession();
  const longName = "X".repeat(32); // exactly MAX_ENTRANT_NAME
  const first = await join(joinCode, longName);
  const second = await join(joinCode, longName);
  assert.notEqual(second.entrant.id, first.entrant.id);
  assert.notEqual(second.entrant.name, first.entrant.name);
  assert.ok(second.entrant.name.length <= 32, "and stays within the column's limit");
});

test("an answer racing the host's reveal cannot roll the room back", async () => {
  // The participant lookup resolves the session as it was a moment ago. If the
  // host advances in the gap, a naive handler scores an answer against a closed
  // question and then rebroadcasts a stale status: "question", yanking every
  // phone in the room back out of the reveal.
  const { id, hostToken, joinCode } = await createSession({ config: { speedBonus: false } });
  const racer = await join(joinCode, "Racer");
  await advance(id, hostToken); // -> question

  // Fire the answer and the advance together; whichever order they land in,
  // the session must end up revealed and the board must stay consistent.
  const [answerRes] = await Promise.all([
    post(`/api/trivia/sessions/${id}/answer`, {
      participant: racer.participantToken,
      choice: await correctChoice(id),
    }),
    advance(id, hostToken), // -> reveal
  ]);

  const view = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
  assert.equal(view.session.status, "reveal", "the room stays revealed");
  // The answer either landed before the close (200) or was refused (409) —
  // both are correct. What must NOT happen is a 500 or a rolled-back status.
  assert.ok([200, 409].includes(answerRes.status), `unexpected ${answerRes.status}`);
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
