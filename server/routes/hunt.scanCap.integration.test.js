// Integration coverage for the hunt's cost controls (routes/hunt.js):
//
//   - hunt_scan metering: every vision model call records the API's exact
//     token counts (the number Anthropic bills), including the
//     VISION_NO_OUTPUT path where the call was billed but produced no verdict.
//   - HUNT_SCAN_CAP: the per-round scan budget 429s once a round has burned
//     its cap of model calls.
//
// Separate file from hunt.integration.test.js on purpose: node --test runs
// each file in its own process, so this file gets a fresh per-IP rate-limit
// counter — the cap test's burst would otherwise collide with that file's
// deliberately-last rate-limit test.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.ANTHROPIC_API_KEY = "test-key"; // so isVisionConfigured() is true

const uploadDir = await mkdtemp(join(tmpdir(), "ffc-hunt-scancap-test-"));
process.env.HUNT_UPLOAD_DIR = uploadDir;

// Verdict + usage, as the real lib/vision.js returns since metering landed.
const MOCK_USAGE = { model: "claude-haiku-4-5", inputTokens: 1500, outputTokens: 80 };
const verifyItemInImageMock = mock.fn(async () => ({
  present: true,
  confidence: 0.9,
  reason: "default mock verdict — override per test",
  photoOfPhoto: false,
  usage: MOCK_USAGE,
}));

mock.module("../lib/vision.js", {
  namedExports: {
    verifyItemInImage: verifyItemInImageMock,
    isVisionConfigured: () => true,
    ALLOWED_MEDIA_TYPES: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  },
});

const { app } = await import("../app.js");

let baseUrl;
let close;
let locationId;
let courseId;
let itemId;
let countableItemId;

const validBody = () => ({
  itemId,
  courseId,
  playerTag: "T01",
  roundClientId: `round-${Date.now()}-${Math.random()}`,
  imageBase64: Buffer.from("test-image-bytes").toString("base64"),
  mediaType: "image/jpeg",
});

function postVerify(body) {
  return fetch(`${baseUrl}/api/hunt/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Scan Cap Test Venue ${stamp}`, `scancap-test-${stamp}`]
  );
  locationId = loc.rows[0].id;

  const course = await testQuery(
    `insert into course (name, theme, pars, location_id) values ($1, $2, $3, $4) returning id`,
    ["Scan Cap Test Course", "test", Array(18).fill(3), locationId]
  );
  courseId = course.rows[0].id;

  const item = await testQuery(
    `insert into hunt_item (course_id, slug, name, hint, countable)
       values ($1, 'widget', 'A test widget', 'look for it', false) returning id`,
    [courseId]
  );
  itemId = item.rows[0].id;

  const countableItem = await testQuery(
    `insert into hunt_item (course_id, slug, name, hint, countable)
       values ($1, 'coin', 'A test coin', 'find as many as you can', true) returning id`,
    [courseId]
  );
  countableItemId = countableItem.rows[0].id;
});

after(async () => {
  if (close) await close();
  delete process.env.HUNT_SCAN_CAP;
  await testQuery(`delete from hunt_scan where item_id in ($1, $2)`, [itemId, countableItemId]);
  await testQuery(`delete from hunt_find where item_id in ($1, $2)`, [itemId, countableItemId]);
  await testQuery(`delete from course where id = $1`, [courseId]); // cascades hunt_item
  await testQuery(`delete from location where id = $1`, [locationId]);
  await rmDir(uploadDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

// --- hunt_scan metering ------------------------------------------------------

test("a model call is metered into hunt_scan with the API's token counts; a dedupe repeat is not", async () => {
  verifyItemInImageMock.mock.resetCalls();
  const body = { ...validBody(), playerTag: "T02", roundClientId: `round-meter-${Date.now()}` };

  const res1 = await postVerify(body);
  assert.equal(res1.status, 200);
  assert.equal((await res1.json()).verified, true);

  const scans = await testQuery(
    `select model, input_tokens, output_tokens, course_id, verified, flagged
       from hunt_scan where round_client_id = $1`,
    [body.roundClientId]
  );
  assert.equal(scans.rowCount, 1);
  assert.equal(scans.rows[0].model, "claude-haiku-4-5");
  assert.equal(scans.rows[0].input_tokens, 1500);
  assert.equal(scans.rows[0].output_tokens, 80);
  assert.equal(scans.rows[0].course_id, courseId);
  assert.equal(scans.rows[0].verified, true);
  assert.equal(scans.rows[0].flagged, false);

  // Repeat submission dedupes without a model call — nothing new to meter.
  const res2 = await postVerify(body);
  assert.equal((await res2.json()).alreadyFound, true);
  const after2 = await testQuery(
    `select count(*)::int as n from hunt_scan where round_client_id = $1`,
    [body.roundClientId]
  );
  assert.equal(after2.rows[0].n, 1, "dedupe short-circuit must not add a scan row");
  assert.equal(verifyItemInImageMock.mock.callCount(), 1);
});

test("a VISION_NO_OUTPUT call is still metered (billed but no verdict)", async () => {
  verifyItemInImageMock.mock.mockImplementation(async () => {
    const err = new Error("vision returned no text content");
    err.code = "VISION_NO_OUTPUT";
    err.usage = MOCK_USAGE;
    throw err;
  });
  const body = { ...validBody(), playerTag: "T03", roundClientId: `round-noout-${Date.now()}` };
  const res = await postVerify(body);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).verified, false);

  const scans = await testQuery(
    `select input_tokens, output_tokens, verified from hunt_scan where round_client_id = $1`,
    [body.roundClientId]
  );
  assert.equal(scans.rowCount, 1);
  assert.equal(scans.rows[0].input_tokens, 1500);
  assert.equal(scans.rows[0].output_tokens, 80);
  assert.equal(scans.rows[0].verified, null, "no verdict — verified is null, not false");

  // Restore the default happy-path mock for later tests.
  verifyItemInImageMock.mock.mockImplementation(async () => ({
    present: true,
    confidence: 0.9,
    reason: "ok",
    photoOfPhoto: false,
    usage: MOCK_USAGE,
  }));
});

// --- HUNT_SCAN_CAP -----------------------------------------------------------

test("the per-round scan cap 429s once the round's budget is spent; countable items are exempt from the attempt cap", async () => {
  process.env.HUNT_SCAN_CAP = "4";
  try {
    verifyItemInImageMock.mock.resetCalls();
    const roundClientId = `round-cap-${Date.now()}`;
    // A countable item never dedupes, so every submission wants a model call.
    // Four passing scans on the SAME (player, item) also prove countable items
    // are exempt from HUNT_ATTEMPT_CAP (default 3) — only the round budget
    // stops them.
    const body = () => ({
      ...validBody(),
      itemId: countableItemId,
      playerTag: "T04",
      roundClientId,
    });

    for (let i = 1; i <= 4; i++) {
      const res = await postVerify(body());
      assert.equal(res.status, 200, `scan ${i} should be within budget (and exempt from the attempt cap)`);
    }
    const res5 = await postVerify(body());
    assert.equal(res5.status, 429);
    const json5 = await res5.json();
    assert.equal(json5.ok, false);
    assert.match(json5.error, /scan limit reached/);
    assert.equal(verifyItemInImageMock.mock.callCount(), 4, "the capped request must not call the model");
  } finally {
    delete process.env.HUNT_SCAN_CAP;
  }
});

// --- HUNT_ATTEMPT_CAP --------------------------------------------------------

test("a player's judged misses on one item stop at the attempt cap; no-output retries don't burn attempts", async () => {
  verifyItemInImageMock.mock.resetCalls();
  const roundClientId = `round-attempts-${Date.now()}`;
  const body = () => ({ ...validBody(), playerTag: "T05", roundClientId });

  // A billed-but-no-verdict call first: metered, but must NOT count as an
  // attempt (verified is null) — otherwise the third miss below would 429.
  verifyItemInImageMock.mock.mockImplementation(async () => {
    const err = new Error("vision returned no text content");
    err.code = "VISION_NO_OUTPUT";
    err.usage = MOCK_USAGE;
    throw err;
  });
  const resNoOut = await postVerify(body());
  assert.equal(resNoOut.status, 200);

  // Three judged misses — the full default attempt budget.
  verifyItemInImageMock.mock.mockImplementation(async () => ({
    present: false,
    confidence: 0.8,
    reason: "not in this shot",
    photoOfPhoto: false,
    usage: MOCK_USAGE,
  }));
  for (let i = 1; i <= 3; i++) {
    const res = await postVerify(body());
    assert.equal(res.status, 200, `miss ${i} should be within the attempt budget`);
    assert.equal((await res.json()).verified, false);
  }

  // Fourth judged shot at the same item: out of attempts.
  const res4 = await postVerify(body());
  assert.equal(res4.status, 429);
  const json4 = await res4.json();
  assert.equal(json4.ok, false);
  assert.match(json4.error, /attempt limit reached/);
  assert.equal(verifyItemInImageMock.mock.callCount(), 4, "1 no-output + 3 misses; the capped request must not call the model");

  // Restore the default happy-path mock.
  verifyItemInImageMock.mock.mockImplementation(async () => ({
    present: true,
    confidence: 0.9,
    reason: "ok",
    photoOfPhoto: false,
    usage: MOCK_USAGE,
  }));
});
