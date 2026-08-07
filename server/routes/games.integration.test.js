// Shared games over HTTP against the real app + test DB: create/join (slots,
// rejoin, full-game and taken-tag 409s, guest joins), LWW score writes (older
// ts rejected, tiebreak, null clear), completion -> canonical round + score
// rows that the leaderboard picks up unchanged, and the SSE stream.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery, listenEphemeral } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.MAIL_PROVIDER;

const { app } = await import("../app.js");
const { resetGameRateLimits } = await import("./games.js");
const { createUserSession } = await import("../lib/userAuth.js");

let baseUrl, close;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// Seeded course from schema.sql (Upland Blue).
const COURSE_ID = "a1111111-1111-4111-8111-111111111111";

const users = {};
async function makeUser(label) {
  const row = await testQuery(
    `insert into app_user (email, email_verified_at, display_name)
       values ($1, now(), $2) returning id`,
    [`game-${stamp}-${label}@example.com`, label]
  );
  const { token } = await createUserSession(row.rows[0].id);
  return { id: row.rows[0].id, cookie: `ffc_session=${token}` };
}

before(async () => {
  await ensureSchema();
  users.host = await makeUser("host");
  users.friend = await makeUser("friend");
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  await close();
  // shared_game.round_id references round, so capture the round ids, drop the
  // games first, then the rounds.
  const roundIds = await testQuery(
    `select round_id from shared_game where round_id is not null and created_by in
       (select id from app_user where email like $1)`,
    [`game-${stamp}%`]
  );
  await testQuery(
    `delete from shared_game where created_by in (select id from app_user where email like $1)`,
    [`game-${stamp}%`]
  );
  await testQuery(`delete from round where id = any($1)`, [roundIds.rows.map((r) => r.round_id)]);
  await testQuery(`delete from app_user where email like $1`, [`game-${stamp}%`]);
  const { pool } = await import("../db.js");
  await pool.end();
});

beforeEach(() => resetGameRateLimits());

function api(path, { method = "GET", cookie, body } = {}) {
  return fetch(`${baseUrl}/api/games${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createGame(cookie = users.host.cookie, tag = "AAA") {
  const res = await api("/", { method: "POST", cookie, body: { courseId: COURSE_ID, tag } });
  assert.equal(res.status, 200);
  return res.json();
}

test("create requires sign-in; join code is 6 unambiguous chars", async () => {
  const anon = await api("/", { method: "POST", body: { courseId: COURSE_ID, tag: "AAA" } });
  assert.equal(anon.status, 401);

  const { game, participantToken, slot } = await createGame();
  assert.match(game.joinCode, /^[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.equal(slot, 0);
  assert.ok(participantToken);
  assert.equal(game.status, "open");
});

test("join claims slots in order; guests join without a session; full game 409s", async () => {
  const { game } = await createGame();
  // Guest joins (no cookie).
  const j1 = await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "BBB" } });
  assert.equal(j1.status, 200);
  const guest = await j1.json();
  assert.equal(guest.slot, 1);
  assert.equal(guest.snapshot.players.length, 2);
  assert.equal(guest.snapshot.players[1].userId, null);

  // Signed-in friend.
  const j2 = await api("/join", {
    method: "POST",
    cookie: users.friend.cookie,
    body: { joinCode: game.joinCode, tag: "CCC" },
  });
  assert.equal((await j2.json()).slot, 2);

  const j3 = await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "DDD" } });
  assert.equal((await j3.json()).slot, 3);

  // Fifth distinct player: full.
  const j4 = await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "EEE" } });
  assert.equal(j4.status, 409);
  assert.match((await j4.json()).error, /full/);
});

test("rejoin: same user keeps their slot; a claimed tag 409s for someone else", async () => {
  const { game } = await createGame();
  await api("/join", { method: "POST", cookie: users.friend.cookie, body: { joinCode: game.joinCode, tag: "FFF" } });

  // Friend rejoins (new device) — same slot, fresh participant token.
  const re = await api("/join", {
    method: "POST",
    cookie: users.friend.cookie,
    body: { joinCode: game.joinCode, tag: "GGG" }, // even with a different tag
  });
  assert.equal(re.status, 200);
  const rejoin = await re.json();
  assert.equal(rejoin.slot, 1);
  assert.equal(rejoin.snapshot.players.length, 2); // no new slot

  // Host's tag (an account-owned slot) can't be claimed by a guest.
  const steal = await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "AAA" } });
  assert.equal(steal.status, 409);

  // A guest tag CAN be reclaimed (device lost the token — code is the capability).
  await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "HHH" } });
  const reclaim = await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "HHH" } });
  assert.equal(reclaim.status, 200);
  assert.equal((await reclaim.json()).slot, 2);
});

test("join normalizes lookalike characters in the code", async () => {
  const { game } = await createGame();
  const sloppy = game.joinCode.toLowerCase().replace(/0/g, "O").replace(/1/g, "l");
  const res = await api("/join", { method: "POST", body: { joinCode: ` ${sloppy} `, tag: "JJJ" } });
  assert.equal(res.status, 200);
});

test("unknown code / bad tag / bad participant are rejected", async () => {
  assert.equal((await api("/join", { method: "POST", body: { joinCode: "ZZZZZZ", tag: "AAA" } })).status, 404);
  assert.equal((await api("/join", { method: "POST", body: { joinCode: "ZZ", tag: "AAA" } })).status, 400);
  const { game } = await createGame();
  assert.equal(
    (await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "fuk" } })).status,
    400
  );
  assert.equal((await api(`/${game.id}?participant=not-a-uuid`)).status, 401);
  assert.equal(
    (await api(`/${game.id}?participant=99999999-9999-4999-8999-999999999999`)).status,
    401
  );
});

test("score writes apply per-cell LWW and are readable in the snapshot", async () => {
  const { game, participantToken: host } = await createGame();
  const joinRes = await (
    await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "KKK" } })
  ).json();
  const guest = joinRes.participantToken;

  // Host writes two cells.
  const w1 = await api(`/${game.id}/scores`, {
    method: "POST",
    body: {
      participant: host,
      writes: [
        { slot: 0, hole: 1, strokes: 3, ts: 1000 },
        { slot: 0, hole: 2, strokes: 2, ts: 1001 },
      ],
    },
  });
  assert.equal(w1.status, 200);
  assert.equal((await w1.json()).applied, 2);

  // Guest writes hole 1 with an OLDER ts — rejected.
  const stale = await api(`/${game.id}/scores`, {
    method: "POST",
    body: { participant: guest, writes: [{ slot: 0, hole: 1, strokes: 5, ts: 999 }] },
  });
  assert.equal((await stale.json()).applied, 0);

  // Guest writes hole 1 with a NEWER ts — wins; also clears hole 2 (null).
  const fresh = await api(`/${game.id}/scores`, {
    method: "POST",
    body: {
      participant: guest,
      writes: [
        { slot: 0, hole: 1, strokes: 5, ts: 2000 },
        { slot: 0, hole: 2, strokes: null, ts: 2001 },
      ],
    },
  });
  assert.equal((await fresh.json()).applied, 2);

  const snap = (await (await api(`/${game.id}?participant=${host}`)).json()).snapshot;
  const cell = (slot, hole) => snap.scores.find((s) => s.slot === slot && s.hole === hole);
  assert.equal(cell(0, 1).strokes, 5);
  assert.equal(cell(0, 2).strokes, null);

  // Equal ts: the higher participant id wins (deterministic tiebreak) —
  // replaying the SAME write is a no-op either way.
  const replay = await api(`/${game.id}/scores`, {
    method: "POST",
    body: { participant: guest, writes: [{ slot: 0, hole: 1, strokes: 5, ts: 2000 }] },
  });
  assert.equal((await replay.json()).applied, 0);
});

test("bad writes 400; out-of-range slot for the roster 400", async () => {
  const { game, participantToken } = await createGame();
  const bad = (writes) =>
    api(`/${game.id}/scores`, { method: "POST", body: { participant: participantToken, writes } });
  assert.equal((await bad([])).status, 400);
  assert.equal((await bad([{ slot: 1, hole: 1, strokes: 3, ts: 1 }])).status, 400); // only slot 0 exists
  assert.equal((await bad([{ slot: 0, hole: 0, strokes: 3, ts: 1 }])).status, 400);
  assert.equal((await bad([{ slot: 0, hole: 19, strokes: 3, ts: 1 }])).status, 400);
  assert.equal((await bad([{ slot: 0, hole: 1, strokes: 0, ts: 1 }])).status, 400);
  assert.equal((await bad([{ slot: 0, hole: 1, strokes: 3.5, ts: 1 }])).status, 400);
  assert.equal((await bad([{ slot: 0, hole: 1, strokes: 3 }])).status, 400); // no ts
});

test("far-future ts is clamped so others can still overwrite the cell", async () => {
  const { game, participantToken } = await createGame();
  const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
  await api(`/${game.id}/scores`, {
    method: "POST",
    body: { participant: participantToken, writes: [{ slot: 0, hole: 1, strokes: 2, ts: farFuture }] },
  });
  const stored = await testQuery(`select ts_client from shared_score where game_id = $1`, [game.id]);
  assert.ok(Number(stored.rows[0].ts_client) <= Date.now() + 3 * 60 * 1000);
});

test("complete finalizes a canonical round the leaderboard serves unchanged", async () => {
  const { game, participantToken: host } = await createGame(users.host.cookie, "LLL");
  const joinRes = await (
    await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "MMM" } })
  ).json();
  const guest = joinRes.participantToken;

  // Completing early 409s (grid not full).
  const early = await api(`/${game.id}/complete`, { method: "POST", body: { participant: host } });
  assert.equal(early.status, 409);

  // Fill all 18 holes for both slots, split across the two devices.
  const writes = (slot, from, to, by) =>
    api(`/${game.id}/scores`, {
      method: "POST",
      body: {
        participant: by,
        writes: Array.from({ length: to - from + 1 }, (_, i) => ({
          slot,
          hole: from + i,
          strokes: 2 + ((from + i + slot) % 3),
          ts: Date.now() + i,
        })),
      },
    });
  await writes(0, 1, 18, host);
  await writes(1, 1, 9, host);
  await writes(1, 10, 18, guest);

  const done = await api(`/${game.id}/complete`, { method: "POST", body: { participant: guest } });
  assert.equal(done.status, 200);
  const { roundId } = await done.json();
  assert.ok(roundId);

  // Idempotent — a second Finish returns the same round.
  const again = await api(`/${game.id}/complete`, { method: "POST", body: { participant: host } });
  assert.equal((await again.json()).roundId, roundId);

  // Canonical rows: positional tags + 36 scores under the shared: client_id.
  const round = await testQuery(`select player_tags, client_id from round where id = $1`, [roundId]);
  assert.deepEqual(round.rows[0].player_tags, ["LLL", "MMM"]);
  assert.equal(round.rows[0].client_id, `shared:${game.id}`);
  const scoreCount = await testQuery(`select count(*)::int as n from score where round_id = $1`, [roundId]);
  assert.equal(scoreCount.rows[0].n, 36);

  // The untouched leaderboard endpoint serves both players of the shared game.
  const board = await (await fetch(`${baseUrl}/api/leaderboard?period=all`)).json();
  const tags = board.map((r) => r.tag);
  assert.ok(tags.includes("LLL"), "leaderboard should include the host");
  assert.ok(tags.includes("MMM"), "leaderboard should include the joiner");

  // Writes after completion are refused.
  const late = await api(`/${game.id}/scores`, {
    method: "POST",
    body: { participant: host, writes: [{ slot: 0, hole: 1, strokes: 2, ts: Date.now() }] },
  });
  assert.equal(late.status, 409);

  // The code is retired — joining it again finds no open game.
  const rejoin = await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "NNN" } });
  assert.equal(rejoin.status, 404);
});

test("stale open games are lazily abandoned and refuse joins", async () => {
  const { game, participantToken } = await createGame();
  await testQuery(`update shared_game set created_at = now() - interval '25 hours' where id = $1`, [
    game.id,
  ]);
  const join = await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "PPP" } });
  assert.equal(join.status, 404);
  const write = await api(`/${game.id}/scores`, {
    method: "POST",
    body: { participant: participantToken, writes: [{ slot: 0, hole: 1, strokes: 2, ts: Date.now() }] },
  });
  assert.equal(write.status, 409);
});

test("SSE: snapshot on connect, live score + completion events, 401 on bad token", async () => {
  const { game, participantToken: host } = await createGame(users.host.cookie, "QQQ");

  const badStream = await fetch(`${baseUrl}/api/games/${game.id}/events?participant=99999999-9999-4999-8999-999999999999`);
  assert.equal(badStream.status, 401);

  const controller = new AbortController();
  const stream = await fetch(`${baseUrl}/api/games/${game.id}/events?participant=${host}`, {
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type"), /text\/event-stream/);

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  async function nextEvent() {
    for (;;) {
      const idx = buffer.indexOf("\n\n");
      if (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (raw.startsWith(":")) continue; // heartbeat
        const event = raw.match(/^event: (.+)$/m)?.[1];
        const data = JSON.parse(raw.match(/^data: (.+)$/m)?.[1] ?? "null");
        return { event, data };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended early");
      buffer += decoder.decode(value, { stream: true });
    }
  }

  const first = await nextEvent();
  assert.equal(first.event, "snapshot");
  assert.equal(first.data.game.id, game.id);
  assert.equal(first.data.players.length, 1);

  // A second device joins and scores — both arrive as events.
  const joinRes = await (
    await api("/join", { method: "POST", body: { joinCode: game.joinCode, tag: "RRR" } })
  ).json();
  const joined = await nextEvent();
  assert.equal(joined.event, "player_joined");
  assert.equal(joined.data.tag, "RRR");

  await api(`/${game.id}/scores`, {
    method: "POST",
    body: {
      participant: joinRes.participantToken,
      writes: [{ slot: 1, hole: 4, strokes: 3, ts: Date.now() }],
    },
  });
  const score = await nextEvent();
  assert.equal(score.event, "score");
  assert.equal(score.data.slot, 1);
  assert.equal(score.data.hole, 4);
  assert.equal(score.data.strokes, 3);
  assert.equal(score.data.by, joinRes.participantToken);

  controller.abort();
});
