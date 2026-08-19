// Integration coverage for /api/admin/tts-bakeoff — the Polly voice bench.
//
// Nothing here calls Polly: the only endpoint that spends is /run, and it
// refuses before reaching AWS when no credentials are configured, which is
// exactly the case a test environment is in. What IS covered is everything
// that decides whether the bench is safe to put in front of an operator:
//   - the data needs super_admin, and the standalone page is gone (the UI is
//     a Master Control screen now),
//   - /plan prices a run without spending,
//   - the bank it prices is scoped to ONE venue, so a bench on a multi-tenant
//     box can't read another client's questions into a page on disk,
//   - the audio route refuses a path that isn't a plain clip filename.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "tts-bakeoff-test-token";

const { app } = await import("../../app.js");

// Everything below runs AFTER that import on purpose. app.js pulls in
// dotenv/config, which fills any variable this file has left unset from
// server/.env — so scrubbing before the import scrubs nothing on a box that
// has one, and the keys come straight back. That is not academic: with
// provider keys in server/.env it put another provider in the priced plan and
// let the "refuses without credentials" test reach synthesis, which on a real
// key means a deploy gate that spends money.
//
// The provider lineup is decided by the environment, so the environment has to
// be declared here rather than inherited. Reading whatever the box happens to
// export made this file pass on a dev container that had AWS keys in its
// ambient environment and fail the deploy gate on the droplet, which has none.
//
// Fake Polly credentials are safe: planning never calls AWS — `configured` is
// a truthiness check and the lineup is pure — and the one test that hits /run
// deletes them first. The other two keys are removed rather than faked,
// because a configured Cartesia key makes providerStatus fetch its voice list,
// and a deploy gate must not depend on a third party answering.
//
// Providers read process.env at call time, so setting it after the import is
// enough — nothing has been read yet.
process.env.AWS_ACCESS_KEY_ID = "test-access-key-id";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret-access-key";
process.env.AWS_REGION = "us-east-1";
delete process.env.OPENAI_API_KEY;
delete process.env.CARTESIA_API_KEY;

let baseUrl, close;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let orgAId, orgBId, locAId, locBId;
const questionIds = [];

function api(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "tts-bakeoff-test-token",
      ...opts.headers,
    },
  });
}

async function insertOrg(name) {
  const r = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    name,
    `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}`,
  ]);
  return r.rows[0].id;
}

async function insertLocation(name, orgId) {
  const r = await testQuery(
    `insert into location (name, slug, org_id) values ($1, $2, $3) returning id`,
    [name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}`, orgId]
  );
  return r.rows[0].id;
}

async function insertQuestion(prompt, { orgId = null, locationId = null } = {}) {
  const r = await testQuery(
    `insert into trivia_question (org_id, location_id, category, prompt, choices, answer)
     values ($1, $2, 'Bench', $3, $4::jsonb, 0) returning id`,
    [orgId, locationId, prompt, JSON.stringify(["Alpha", "Bravo", "Charlie", "Delta"])]
  );
  questionIds.push(r.rows[0].id);
  return r.rows[0].id;
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  orgAId = await insertOrg(`Bench A ${stamp}`);
  orgBId = await insertOrg(`Bench B ${stamp}`);
  locAId = await insertLocation(`Bench Venue A ${stamp}`, orgAId);
  locBId = await insertLocation(`Bench Venue B ${stamp}`, orgBId);
  // One question only org B can see — the cross-tenant canary.
  await insertQuestion(`ORG B SECRET ${stamp}?`, { orgId: orgBId });
  // Padded to be, reliably, the LONGEST prompt in the bank.
  //
  // loadQuestions sorts by length(prompt) and takes evenly-spaced picks, so
  // which rows it returns depends on every other row in scope — and "in scope"
  // includes every org_id-null platform question, which other test files
  // create and delete while this one runs. Without an anchor at one end of the
  // ordering, "the pick includes our row" is a coin flip and this test fails
  // roughly one run in three. The longest row is always the final pick.
  await insertQuestion(`Org A question ${stamp}? ${"padding ".repeat(30)}`, { orgId: orgAId });
  await insertQuestion(`A shared platform question ${stamp}?`);
});

after(async () => {
  await testQuery(`delete from trivia_question where id = any($1::uuid[])`, [questionIds]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [[locAId, locBId]]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [[orgAId, orgBId]]);
  const { pool } = await import("../../db.js");
  await pool.end();
  await close();
});

test("the data needs auth, and the standalone page is gone", async () => {
  // The UI is admin/VoiceBench.tsx now. The old server-rendered page was
  // pre-auth by necessity; nothing here should be reachable without a login.
  const page = await fetch(`${baseUrl}/api/admin/tts-bakeoff/ui`);
  assert.ok(page.status === 401 || page.status === 404, `ui -> ${page.status}`);

  const venues = await fetch(`${baseUrl}/api/admin/tts-bakeoff/venues`);
  assert.equal(venues.status, 401);
});

test("venues lists live venues for the picker", async () => {
  const res = await api("/api/admin/tts-bakeoff/venues");
  assert.equal(res.status, 200);
  const body = await res.json();
  const ids = body.venues.map((v) => v.id);
  assert.ok(ids.includes(locAId) && ids.includes(locBId));
});

test("plan prices a run without spending", async () => {
  const res = await api("/api/admin/tts-bakeoff/plan", {
    method: "POST",
    body: JSON.stringify({ locationId: locAId, questions: 3 }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.clips > 0, "it plans clips");
  assert.ok(body.chars > 0, "with billable characters");
  assert.ok(body.usd > 0 && body.usd < 1, `a sane price, got ${body.usd}`);
  // Priced per provider, since they cost different amounts. Polly alone,
  // because this file configures Polly alone — if another provider shows up
  // here, the run is reading credentials from the box instead of the test.
  assert.deepEqual(Object.keys(body.byProvider), ["Polly"]);
  // Three Stephen rows per line: generative, neural, neural + DRC.
  assert.equal(body.clips, body.lines.length * 3);
  // Every provider is accounted for, configured or not, so the screen can say
  // which key is missing instead of quietly showing fewer columns.
  assert.deepEqual(
    body.providers.map((p) => p.key).sort(),
    ["cartesia", "openai", "polly"]
  );
  for (const p of body.providers) {
    if (!p.configured) assert.match(p.why, /server\/\.env/);
  }
  // The lines are the ones a game actually says.
  assert.match(body.lines[0].text, /Live trivia is starting/);
  assert.ok(body.lines.some((l) => /The correct answer is/.test(l.text)));
});

test("an empty plan blames the provider that came up empty, not a missing key", async () => {
  const { noProviderReason } = await import("../../lib/ttsBakeoff.js");

  // Nothing configured at all: the keys are the actionable fact.
  assert.match(
    noProviderReason([
      { key: "polly", label: "Polly", configured: false, why: "AWS keys in server/.env" },
      { key: "cartesia", label: "Cartesia", configured: false, why: "CARTESIA_API_KEY in server/.env" },
    ]),
    /no provider is configured — add one of: AWS keys/
  );

  // The droplet's case: a key IS present and the provider simply had nothing.
  // Telling this operator to add a key sends them to fix a file that is
  // already correct, so the note has to win.
  const reason = noProviderReason([
    { key: "polly", label: "Polly", configured: false, why: "AWS keys in server/.env" },
    { key: "cartesia", label: "Cartesia", configured: true, note: "no English voices came back" },
  ]);
  assert.match(reason, /Cartesia: no English voices came back/);
  assert.doesNotMatch(reason, /no provider is configured/);
});

test("the priced bank is scoped to one venue's org", async () => {
  // The whole reason this endpoint takes a venue: on a multi-tenant box an
  // unscoped read would price — and then synthesize — another client's
  // questions into a page that sits on disk.
  const res = await api("/api/admin/tts-bakeoff/plan", {
    method: "POST",
    body: JSON.stringify({ locationId: locAId, questions: 5 }),
  });
  const body = await res.json();
  const said = body.lines.map((l) => l.text).join(" ");
  assert.ok(!said.includes("ORG B SECRET"), "another org's question is never read");
  assert.ok(said.includes("Org A question") || said.includes("shared platform question"));
});

test("an unknown venue is refused rather than guessed at", async () => {
  const res = await api("/api/admin/tts-bakeoff/plan", {
    method: "POST",
    body: JSON.stringify({ locationId: "00000000-0000-4000-8000-000000000000" }),
  });
  assert.equal(res.status, 404);
});

test("run refuses clearly when AWS is not configured, instead of 500ing", async () => {
  const saved = [process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY];
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  try {
    const res = await api("/api/admin/tts-bakeoff/run", {
      method: "POST",
      body: JSON.stringify({ locationId: locAId }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /AWS_ACCESS_KEY_ID/);
  } finally {
    if (saved[0] !== undefined) process.env.AWS_ACCESS_KEY_ID = saved[0];
    if (saved[1] !== undefined) process.env.AWS_SECRET_ACCESS_KEY = saved[1];
  }
});

test("the audio route only serves plain clip filenames", async () => {
  for (const path of [
    "/api/admin/tts-bakeoff/audio/..%2F..%2Fetc/passwd.mp3",
    "/api/admin/tts-bakeoff/audio/run/..%2Frun.json",
    "/api/admin/tts-bakeoff/audio/run/run.json",
  ]) {
    const res = await api(path);
    assert.ok(res.status === 400 || res.status === 404, `${path} -> ${res.status}`);
  }
});
