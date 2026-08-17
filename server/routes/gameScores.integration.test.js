// Integration coverage for arcade high scores (/api/game-scores) — the boards
// the mini-games rank on. The contract worth pinning down here isn't CRUD, it's
// RANKING: the arcade's games don't share a play style, so the same code has to
// sort a go-kart lap (lower wins) and a skee-ball total (higher wins)
// correctly, keep each player to their single best run, and refuse to compare
// runs that aren't comparable (two different go-kart tracks).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery, listenEphemeral } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");
const { createUserSession } = await import("../lib/userAuth.js");

let baseUrl;
let close;
let locationId;
let otherLocationId;
const locationIds = [];
const userEmails = [];

let sessionSeq = 0;
const session = () => `score-sess-${Date.now()}-${sessionSeq++}`;

function post(body, cookie) {
  return fetch(`${baseUrl}/api/game-scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function board(query, cookie) {
  return fetch(`${baseUrl}/api/game-scores/board?${new URLSearchParams(query)}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

let userSeq = 0;
/** A signed-in player. Returns { cookie, id, tag }. */
async function player(tag) {
  const email = `game-scores-${Date.now()}-${userSeq++}@example.com`;
  userEmails.push(email);
  const row = await testQuery(
    `insert into app_user (email, email_verified_at, default_tag) values ($1, now(), $2) returning id`,
    [email, tag]
  );
  const id = row.rows[0].id;
  const { token } = await createUserSession(id);
  return { cookie: `ffc_session=${token}`, id, tag };
}

async function makeLocation(stamp) {
  const row = await testQuery(
    `insert into location (name, slug, tz) values ($1, $2, 'UTC') returning id`,
    [`GameScores ${stamp}`, `game-scores-${stamp}`]
  );
  locationIds.push(row.rows[0].id);
  return row.rows[0].id;
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  locationId = await makeLocation(`a-${stamp}`);
  otherLocationId = await makeLocation(`b-${stamp}`);
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from game_score where location_id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  await testQuery(`delete from app_user where email = any($1::text[])`, [userEmails]);
});

test("rejects malformed submissions", async () => {
  const { cookie } = await player("AAA");
  const cases = [
    [{ locationId: "nope", game: "skeeball", score: 10, sessionId: session() }, /locationId/],
    [{ locationId, game: "coinpusher", score: 10, sessionId: session() }, /unknown game/],
    [{ locationId, game: "skeeball", score: 1.5, sessionId: session() }, /score/],
    [{ locationId, game: "skeeball", score: 99_999_999, sessionId: session() }, /score/],
    [{ locationId, game: "skeeball", score: 10, sessionId: "short" }, /sessionId/],
    // A game without variants must not carry one...
    [{ locationId, game: "skeeball", score: 10, variant: "x", sessionId: session() }, /no variants/],
    // ...and a game WITH them must name a real one, or a typo'd track would
    // quietly open a private board of one.
    [{ locationId, game: "gokarts", score: 10, variant: "nope", sessionId: session() }, /variant/],
    [{ locationId, game: "gokarts", score: 10, sessionId: session() }, /variant/],
  ];
  for (const [body, msg] of cases) {
    const res = await post(body, cookie);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match((await res.json()).error, msg);
  }
});

test("recording requires an account", async () => {
  const res = await post({ locationId, game: "skeeball", score: 10, sessionId: session() });
  assert.equal(res.status, 401);
});

test("a foreign venue id 404s rather than writing to its board", async () => {
  const { cookie } = await player("BBB");
  const res = await post(
    {
      locationId: "00000000-0000-0000-0000-000000000000",
      game: "skeeball",
      score: 10,
      sessionId: session(),
    },
    cookie
  );
  assert.equal(res.status, 404);
});

test("a high-direction board ranks the biggest score first", async () => {
  const [low, mid, high] = await Promise.all([player("LOW"), player("MID"), player("HGH")]);
  for (const [who, score] of [
    [low, 120],
    [mid, 260],
    [high, 410],
  ]) {
    const res = await post(
      { locationId, game: "skeeball", score, sessionId: session() },
      who.cookie
    );
    assert.equal(res.status, 200);
  }

  const res = await board({ game: "skeeball", locationId });
  const { board: rows } = await res.json();
  const mine = rows.filter((r) => [low.id, mid.id, high.id].includes(r.userId));
  assert.deepEqual(
    mine.map((r) => r.score),
    [410, 260, 120]
  );
  assert.equal(mine[0].tag, "HGH");
});

test("a low-direction board ranks the SMALLEST score first", async () => {
  // The whole reason direction is per game: ranked as "high wins", the slowest
  // lap would sit on top of the go-kart board.
  const [fast, slow] = await Promise.all([player("FST"), player("SLW")]);
  await post(
    { locationId, game: "gokarts", variant: "speedway", score: 18_420, sessionId: session() },
    fast.cookie
  );
  await post(
    { locationId, game: "gokarts", variant: "speedway", score: 31_900, sessionId: session() },
    slow.cookie
  );

  const res = await board({ game: "gokarts", variant: "speedway", locationId });
  const { board: rows } = await res.json();
  const mine = rows.filter((r) => [fast.id, slow.id].includes(r.userId));
  assert.deepEqual(
    mine.map((r) => r.score),
    [18_420, 31_900]
  );
});

test("variants are separate boards — one track's lap never ranks against another's", async () => {
  const { cookie, id } = await player("TRK");
  await post(
    { locationId, game: "gokarts", variant: "boomerang", score: 44_000, sessionId: session() },
    cookie
  );

  const onBoomerang = await (await board({ game: "gokarts", variant: "boomerang", locationId })).json();
  assert.ok(onBoomerang.board.some((r) => r.userId === id));

  const onSpeedway = await (await board({ game: "gokarts", variant: "speedway", locationId })).json();
  assert.ok(!onSpeedway.board.some((r) => r.userId === id));
});

test("a player holds ONE slot — their best run, not their latest", async () => {
  const { cookie, id } = await player("ONE");
  const first = await post(
    { locationId, game: "darts", score: 300, sessionId: session() },
    cookie
  );
  assert.equal((await first.json()).isPersonalBest, true);

  // A worse run must not displace the better one, and must not add a row.
  const worse = await post({ locationId, game: "darts", score: 90, sessionId: session() }, cookie);
  const worseBody = await worse.json();
  assert.equal(worseBody.isPersonalBest, false);
  assert.equal(worseBody.previousBest, 300);

  const better = await post(
    { locationId, game: "darts", score: 480, sessionId: session() },
    cookie
  );
  assert.equal((await better.json()).isPersonalBest, true);

  const { board: rows } = await (await board({ game: "darts", locationId })).json();
  const mine = rows.filter((r) => r.userId === id);
  assert.equal(mine.length, 1, "one slot per player");
  assert.equal(mine[0].score, 480);
});

test("replaying one round's sessionId is idempotent", async () => {
  const { cookie, id } = await player("IDM");
  const sid = session();
  const body = { locationId, game: "bowling", score: 200, sessionId: sid };

  await post(body, cookie);
  // A re-mounted end screen sends the same id — and even a DIFFERENT score on
  // that id must not stack a second row or overwrite the first.
  const replay = await post({ ...body, score: 300 }, cookie);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).score, 200, "replay returns the original row");

  const rows = await testQuery(
    `select count(*)::int as n from game_score where game = 'bowling' and session_id = $1`,
    [sid]
  );
  assert.equal(rows.rows[0].n, 1);

  const { board: boardRows } = await (await board({ game: "bowling", locationId })).json();
  assert.equal(boardRows.filter((r) => r.userId === id).length, 1);
});

test("boards are per venue — a score at one site is absent from the other's", async () => {
  const { cookie, id } = await player("VEN");
  await post({ locationId, game: "pinball", score: 50_000, sessionId: session() }, cookie);

  const here = await (await board({ game: "pinball", locationId })).json();
  assert.ok(here.board.some((r) => r.userId === id));

  const there = await (await board({ game: "pinball", locationId: otherLocationId })).json();
  assert.ok(!there.board.some((r) => r.userId === id));
});

test("a signed-in reader gets their own standing, even outside the top N", async () => {
  const { cookie, id } = await player("STD");
  const res = await post(
    { locationId, game: "ringtoss", score: 42, sessionId: session() },
    cookie
  );
  const { standing } = await res.json();
  assert.ok(standing, "standing present on record");
  assert.equal(standing.score, 42);
  assert.ok(standing.rank >= 1);
  assert.ok(standing.outOf >= 1);

  // limit=1 can hide the player from the visible rows; the standing must not
  // disappear with them — that line is how you know where you actually placed.
  const narrow = await (await board({ game: "ringtoss", locationId, limit: "1" }, cookie)).json();
  assert.equal(narrow.board.length, 1);
  assert.equal(narrow.standing.score, 42);
  assert.equal(narrow.standing.rank, standing.rank);
  assert.ok(narrow.standing.outOf >= narrow.board.length, "outOf counts the whole board");
});

test("an anonymous reader sees the board but no standing", async () => {
  const res = await board({ game: "skeeball", locationId });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.standing, null);
  assert.ok(Array.isArray(body.board));
});

test("/boards returns one entry per sub-board, variants expanded", async () => {
  const res = await fetch(
    `${baseUrl}/api/game-scores/boards?${new URLSearchParams({ locationId, limit: "3" })}`
  );
  const { boards } = await res.json();
  const karts = boards.filter((b) => b.game === "gokarts");
  assert.equal(karts.length, 7, "one board per go-kart track");
  assert.ok(karts.every((b) => b.variantLabel !== null));

  const skee = boards.filter((b) => b.game === "skeeball");
  assert.equal(skee.length, 1);
  assert.equal(skee[0].variant, "");
  assert.equal(skee[0].variantLabel, null);
  assert.equal(skee[0].direction, "high");
  assert.equal(
    boards.find((b) => b.game === "gokarts").direction,
    "low",
    "the registry's direction rides along so the client can label the board"
  );
});

test("period windows scope the board", async () => {
  const { cookie, id } = await player("PER");
  await post({ locationId, game: "axethrow", score: 55, sessionId: session() }, cookie);

  const today = await (await board({ game: "axethrow", locationId, period: "day" })).json();
  assert.ok(today.board.some((r) => r.userId === id));

  // Backdate the row out of the day window; it must leave the daily board and
  // stay on the all-time one.
  await testQuery(
    `update game_score set created_at = now() - interval '40 days'
      where app_user_id = $1 and game = 'axethrow'`,
    [id]
  );
  const stillToday = await (await board({ game: "axethrow", locationId, period: "day" })).json();
  assert.ok(!stillToday.board.some((r) => r.userId === id));
  const allTime = await (await board({ game: "axethrow", locationId, period: "all" })).json();
  assert.ok(allTime.board.some((r) => r.userId === id));
});
