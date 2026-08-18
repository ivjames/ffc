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
const { resetTriviaRateLimits, tickAutopilot, autoAdvanceIfDue, SESSION_FIELDS } =
  await import("./triviaLive.js");
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

/** The current question's correct index, read from the session's own PINNED
 *  copy — which is what the server scores against, and what makes this
 *  independent of anything an admin does to the bank mid-game. */
async function correctChoice(sessionId) {
  const s = await testQuery(
    `select questions, current_index from trivia_session where id = $1`,
    [sessionId]
  );
  const { questions, current_index: idx } = s.rows[0];
  return questions[idx].answer;
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

test("NOBODY receives the answer mid-question, the host included", async () => {
  // The host used to be handed the answer from the moment the question opened,
  // on the reasoning that an MC reads it out. They don't need it then — they
  // announce it at the reveal — and that one privilege was the only thing that
  // made a room worth opening for its own sake, which is what forced hosting
  // behind a staff gate it never really needed.
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
  assert.equal(
    hostView.question.answer,
    undefined,
    "the host is holding the room's only early copy of the answer — so don't give them one"
  );
  assert.ok(!JSON.stringify(hostView).includes('"answer"'));

  // And at the reveal it reaches everyone at once.
  await advance(id, hostToken);
  const revealed = await json(
    await fetch(`${baseUrl}/api/trivia/sessions/${id}?participant=${participantToken}`)
  );
  assert.equal(typeof revealed.question.answer, "number", "the reveal is for the whole room");
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
  assert.ok(!wire.includes('"answer"'), "the answer index must never reach an open question's stream");
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

test("an edit to the bank cannot change a question already in play", async () => {
  // The bank stays editable while a game runs — it's the same admin screen a
  // manager tidies up between rounds. Re-reading it per request meant an edit
  // could land mid-question: two players a second apart scored against
  // different correct choices, and the prompt on every phone in the room
  // replaced between the ask and the reveal. A game deals its cards once.
  const { id, hostToken, joinCode } = await createSession({
    questionCount: 3,
    config: { speedBonus: false },
  });
  const { participantToken } = await join(joinCode, "Steady");
  await advance(id, hostToken); // -> question

  const asked = await json(
    await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`)
  );
  const dealtAnswer = await correctChoice(id);
  const dealtId = (
    await testQuery(`select question_ids, current_index from trivia_session where id = $1`, [id])
  ).rows[0];
  const liveId = dealtId.question_ids[dealtId.current_index];

  // The bank is shared by the whole suite, so the edit is put back afterwards
  // — this test is about the session's copy, not about damaging the pack.
  const original = (
    await testQuery(`select prompt, choices, answer from trivia_question where id = $1`, [liveId])
  ).rows[0];
  try {
    // The manager rewrites the question under the room, answer and all.
    await testQuery(
      `update trivia_question set prompt = $2, choices = $3::jsonb, answer = $4 where id = $1`,
      [liveId, "Rewritten mid-round", JSON.stringify(["a", "b", "c", "d"]), 3]
    );

    const after = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
    assert.equal(
      after.question.prompt,
      asked.question.prompt,
      "the room keeps the question it was asked"
    );
    assert.deepEqual(after.question.choices, asked.question.choices);
    assert.equal(await correctChoice(id), dealtAnswer, "and the answer it was dealt");

    // And the scoring agrees with what the players were shown, not the edit.
    const correct = await post(`/api/trivia/sessions/${id}/answer`, {
      participant: participantToken,
      choice: dealtAnswer,
    });
    assert.equal(correct.status, 200);
    const board = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
    assert.equal(board.board.find((e) => e.name === "Steady").score, BASE_POINTS);
  } finally {
    await testQuery(
      `update trivia_question set prompt = $2, choices = $3::jsonb, answer = $4 where id = $1`,
      [liveId, original.prompt, JSON.stringify(original.choices), original.answer]
    );
  }
});

test("a solo player's entrant cannot be joined by someone else in the room", async () => {
  const { id, hostToken, joinCode } = await createSession({ config: { speedBonus: false } });
  const victim = await join(joinCode, "Dana");
  // The rival is an ordinary participant — and every phone in the room is sent
  // the full board, entrant ids included, so knowing Dana's id takes no
  // privilege at all. Only the `is_team` clause stands between that and
  // minting a token bound to her entrant.
  await join(joinCode, "Rival");

  const stolen = await post("/api/trivia/sessions/join", {
    joinCode,
    entrantId: victim.entrant.id,
  });
  assert.equal(stolen.status, 404, "a solo entrant is not something you can join");

  // And the consequence that made it worth a test: one entrant answers once,
  // so a successful theft would let the rival spend Dana's turn on a wrong
  // choice before she ever taps.
  await advance(id, hostToken);
  const answer = await correctChoice(id);
  const hers = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: victim.participantToken,
    choice: answer,
  });
  assert.equal(hers.status, 200);
  const view = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
  assert.equal(view.board.find((e) => e.name === "Dana").score, BASE_POINTS);
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

test("a running room stops if the venue loses the arcade module", async () => {
  const { id, hostToken, joinCode } = await createSession();
  const seated = await join(joinCode, "Seated");
  await advance(id, hostToken); // -> question

  await testQuery(`update location set modules = $1::jsonb where id = $2`, [
    JSON.stringify({ arcade: false }),
    locationId,
  ]);
  try {
    // Joining, answering, and advancing all mutate a room that outlives its
    // create call, so each rechecks rather than trusting setup.
    const late = await post("/api/trivia/sessions/join", { joinCode, name: "TooLate" });
    assert.equal(late.status, 403);

    const answered = await post(`/api/trivia/sessions/${id}/answer`, {
      participant: seated.participantToken,
      choice: 0,
    });
    assert.equal(answered.status, 403);

    const stepped = await advance(id, hostToken);
    assert.equal(stepped.status, 403);
  } finally {
    await testQuery(`update location set modules = '{}'::jsonb where id = $1`, [locationId]);
  }
});

test("a session past its TTL expires even for clients that never re-join", async () => {
  // expireIfStale used to run only on join/snapshot, and a room's clients hold
  // an SSE connection rather than re-fetching — so the TTL never fired for the
  // people actually in the game, and a host could resume a day-old session.
  const { id, hostToken, joinCode } = await createSession();
  const seated = await join(joinCode, "Overnight");
  await advance(id, hostToken); // -> question

  await testQuery(
    `update trivia_session set created_at = now() - interval '13 hours' where id = $1`,
    [id]
  );

  const answered = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: seated.participantToken,
    choice: 0,
  });
  assert.equal(answered.status, 409);
  const stepped = await advance(id, hostToken);
  assert.equal(stepped.status, 409);
});

test("a stale advance cannot resurrect a room the host just ended", async () => {
  // The host taps "next question" and then "End early" before the first lands.
  // An unpredicated update would write its stale next-state over 'final'.
  const { id, hostToken, joinCode } = await createSession();
  await join(joinCode, "Witness");
  await advance(id, hostToken); // -> question

  const [, ended] = await Promise.all([
    advance(id, hostToken),
    post(`/api/trivia/sessions/${id}/end`, { host: hostToken }),
  ]);
  assert.equal(ended.status, 200);

  const view = await json(await fetch(`${baseUrl}/api/trivia/sessions/${id}?host=${hostToken}`));
  assert.equal(view.session.status, "final", "the room stays closed");
});

test("expiry reaches the room, not just the request that noticed it", async () => {
  // The phones hold an SSE connection, so a 409 that nobody broadcasts leaves
  // them rendering a live-looking question where every tap is dead.
  const { id, hostToken, joinCode } = await createSession();
  const seated = await join(joinCode, "Stranded");
  await advance(id, hostToken);
  await testQuery(
    `update trivia_session set created_at = now() - interval '13 hours' where id = $1`,
    [id]
  );

  await post(`/api/trivia/sessions/${id}/answer`, {
    participant: seated.participantToken,
    choice: 0,
  });

  const view = await json(
    await fetch(`${baseUrl}/api/trivia/sessions/${id}?participant=${seated.participantToken}`)
  );
  assert.equal(view.session.status, "abandoned", "the session really is closed");
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

// --- Running unattended -----------------------------------------------------
//
// A host is a pacing convenience, not a dependency: the lobby starts once it
// has waited for stragglers, questions close when their time is up, and
// reveals give way to the next question. A game whose host walks off still
// reaches a final board rather than stranding a room.

/** Drag a session's current deadline into the past. */
const expireDeadline = (id) =>
  testQuery(`update trivia_session set auto_at = now() - interval '1 second' where id = $1`, [id]);

test("the lobby's clock starts when the first player joins, not when the room is made", async () => {
  const { id, joinCode } = await createSession({ config: { lobbySeconds: 60 } });
  const before = await testQuery(`select auto_at from trivia_session where id = $1`, [id]);
  assert.equal(before.rows[0].auto_at, null, "a room nobody joins never starts itself");

  await join(joinCode, "First");
  const after = await testQuery(`select auto_at from trivia_session where id = $1`, [id]);
  assert.ok(after.rows[0].auto_at, "the wait begins with the first arrival");

  // A later arrival must not push the start back, or a busy room never begins.
  await join(joinCode, "Second");
  const later = await testQuery(`select auto_at from trivia_session where id = $1`, [id]);
  assert.deepEqual(later.rows[0].auto_at, after.rows[0].auto_at);
});

test("a room with no host still runs itself to a final board", async () => {
  const { id, joinCode } = await createSession({
    questionCount: 3,
    config: { questionSeconds: 5, revealSeconds: 5, lobbySeconds: 10, speedBonus: false },
  });
  const { participantToken } = await join(joinCode, "Alone");

  const phase = async () => {
    const view = await json(
      await fetch(`${baseUrl}/api/trivia/sessions/${id}?participant=${participantToken}`)
    );
    return view.session.status;
  };
  assert.equal(await phase(), "lobby");

  // Nobody taps anything — the clock does all of it.
  const seen = [];
  for (let i = 0; i < 12; i++) {
    await expireDeadline(id);
    await tickAutopilot();
    const now = await phase();
    seen.push(now);
    if (now === "final") break;
  }
  assert.equal(seen.at(-1), "final", `never finished, walked: ${seen.join(" -> ")}`);
  assert.ok(seen.includes("question"), "and it dealt questions on the way");
  assert.ok(seen.includes("reveal"), "and revealed them");
});

test("a phase past its deadline advances on read, even with the ticker down", async () => {
  // The lazy check is the belt to the ticker's braces: a phone reconnecting to
  // a room nobody has touched sees where the CLOCK says the game is, rather
  // than where it was parked.
  const { id, joinCode } = await createSession({
    config: { questionSeconds: 5, revealSeconds: 5, lobbySeconds: 10 },
  });
  const { participantToken } = await join(joinCode, "Reconnecting");
  await expireDeadline(id);

  const view = await json(
    await fetch(`${baseUrl}/api/trivia/sessions/${id}?participant=${participantToken}`)
  );
  assert.equal(view.session.status, "question", "the read moved it along");
  assert.ok(view.question, "and dealt the first question");
});

test("the host's button and the clock cannot both move the same question", async () => {
  // The host tap is the same transition made early, predicated on the phase it
  // was computed from — so whichever lands first wins and the loser finds
  // nothing to apply, rather than writing a stale next-state.
  //
  // This used to fire both actors through `Promise.all` and assert the room
  // sat on the reveal. That starts them together but does NOT make them
  // compute from the same phase: the route re-reads the session, so on a
  // loaded machine the clock's write can commit BEFORE the request's own
  // SELECT, and the tap then legitimately computes the next transition
  // (reveal -> question 1) instead of a duplicate reveal. It failed in the
  // deploy gate on code that was behaving correctly. Both orderings are pinned
  // explicitly now — see the sibling test for the clock-first half.
  const { id, hostToken, joinCode } = await createSession({
    questionCount: 3,
    config: { questionSeconds: 5, revealSeconds: 5, lobbySeconds: 10 },
  });
  await join(joinCode, "Racer");
  await advance(id, hostToken); // -> question 0
  await expireDeadline(id);

  // The row the clock is holding when it wakes to find this room overdue —
  // read the way the ticker reads it, so the transition below is the real one.
  const clockHeld = (
    await testQuery(`select ${SESSION_FIELDS} from trivia_session where id = $1`, [id])
  ).rows[0];
  assert.equal(clockHeld.status, "question");
  assert.equal(clockHeld.currentIndex, 0);

  // The host's tap lands first and makes the transition.
  const tapped = await advance(id, hostToken);
  assert.equal(tapped.status, 200);
  const body = await json(tapped);
  assert.equal(body.session.status, "reveal", "the tap made the transition");
  assert.equal(body.session.currentIndex, 0, "and the room did not skip a question");

  // Now the clock's transition lands, still holding the phase it read before
  // the tap. Driven through autoAdvanceIfDue — the function the ticker calls
  // per due row — rather than a hand-written UPDATE: re-stating the predicate
  // here would only test this file's SQL, and would stay green if applyPhase
  // ever stopped predicating on the phase it was computed from.
  const late = await autoAdvanceIfDue(clockHeld);
  assert.equal(late, null, "one transition, not two");

  const now = (
    await testQuery(`select status, current_index from trivia_session where id = $1`, [id])
  ).rows[0];
  assert.equal(now.status, "reveal", "the room is where the host's tap left it");
  assert.equal(now.current_index, 0);
});

test("a host tap that lands after the clock moves the room on, not twice", async () => {
  // The other ordering, pinned rather than left to chance: the clock reveals,
  // and the tap arrives after. The button is a shortcut for the NEXT
  // transition, computed from the phase the request actually finds — so it
  // opens question 1. What it must never do is re-apply the reveal, skip a
  // question, or land on a phase the room never passed through.
  //
  // Worth knowing: a tap this close behind the clock performs "next question"
  // while the host's screen still reads "Close answers & reveal", so the room
  // sees the answer only for as long as the round trip took. Making the tap
  // carry the phase the HOST saw would close that gap; today the server reads
  // its own.
  const { id, hostToken, joinCode } = await createSession({
    questionCount: 3,
    config: { questionSeconds: 5, revealSeconds: 5, lobbySeconds: 10 },
  });
  await join(joinCode, "Latecomer");
  await advance(id, hostToken); // -> question 0
  await expireDeadline(id);

  await tickAutopilot(); // the clock reveals question 0
  const revealed = (
    await testQuery(`select status, current_index from trivia_session where id = $1`, [id])
  ).rows[0];
  assert.equal(revealed.status, "reveal");
  assert.equal(revealed.current_index, 0);

  const body = await json(await advance(id, hostToken));
  assert.equal(body.session.status, "question", "the tap made the next transition");
  assert.equal(body.session.currentIndex, 1, "exactly one step past the reveal");
});

test("a stalled actor cannot drag the room back a question", async () => {
  // Status alone is not a version: it comes round again on every question. An
  // actor holding (question, 0) that stalls while the room moves on to
  // (question, 1) would match the predicate and apply its stale transition —
  // reverting current_index and revealing the answer to the wrong question in
  // front of everybody.
  const { id, hostToken, joinCode } = await createSession({
    questionCount: 3,
    config: { questionSeconds: 5, revealSeconds: 5, lobbySeconds: 10 },
  });
  await join(joinCode, "Bystander");
  await advance(id, hostToken); // -> question 0
  const stale = (
    await testQuery(`select status, current_index from trivia_session where id = $1`, [id])
  ).rows[0];
  assert.equal(stale.current_index, 0);

  // The room moves on while our stalled actor still believes in question 0.
  await advance(id, hostToken); // -> reveal 0
  await advance(id, hostToken); // -> question 1

  // Now the stalled transition lands. It must find nothing to update.
  const applied = await testQuery(
    `update trivia_session set status = 'reveal', current_index = 0
      where id = $1 and status = $2 and current_index = $3 returning id`,
    [id, stale.status, stale.current_index]
  );
  assert.equal(applied.rowCount, 0, "the predicate rejected a transition from a spent phase");

  const now = (
    await testQuery(`select status, current_index from trivia_session where id = $1`, [id])
  ).rows[0];
  assert.equal(now.current_index, 1, "the room is still on the question it was asking");
  assert.equal(now.status, "question");
});

test("the network grace outlives the clock that closes the question", async () => {
  // The grace window is for latency, not for thinking time — so the phase must
  // not close before it. Closing exactly on the configured length would flip
  // the session to reveal while a tap made at 19.9s was in flight, and the
  // answer handler would refuse it on status before ever reaching the grace
  // calculation. Whether a slow tap counted would then depend on how the
  // ticker's second lined up.
  const { id, hostToken, joinCode } = await createSession({
    config: { questionSeconds: 5, revealSeconds: 5, lobbySeconds: 10, speedBonus: false },
  });
  const { participantToken } = await join(joinCode, "Laggy");
  await advance(id, hostToken); // -> question

  const row = (
    await testQuery(`select asked_at, auto_at from trivia_session where id = $1`, [id])
  ).rows[0];
  const graceMs = new Date(row.auto_at).getTime() - new Date(row.asked_at).getTime() - 5000;
  assert.ok(graceMs > 0, `the clock must not close before the grace, got ${graceMs}ms`);

  // A tap inside the grace still scores, and the ticker has not closed the
  // phase out from under it.
  await testQuery(
    `update trivia_session set asked_at = now() - interval '5100 milliseconds' where id = $1`,
    [id]
  );
  await tickAutopilot();
  const late = await post(`/api/trivia/sessions/${id}/answer`, {
    participant: participantToken,
    choice: await correctChoice(id),
  });
  assert.equal(late.status, 200, "a tap inside the grace is still a tap inside the grace");
});
