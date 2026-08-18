// Integration coverage for the live-trivia question bank admin.
//
// The interesting rules are all about WHO OWNS A QUESTION. The bank has three
// scopes sharing one table, and the failure that matters is cross-tenant: an
// org_admin editing the platform pack would change what every other client's
// trivia night deals, and editing a rival's row is the usual tenant leak.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, ensureSchema, testQuery, listenEphemeral } from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "trivia-admin-test-token";

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");

let baseUrl, close;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let orgA, orgB, adminACookie, platformQuestionId;
const orgIds = [];
const adminEmails = [];

function call(method, path, body, { cookie, token } = {}) {
  return fetch(`${baseUrl}/api/admin${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { "x-app-token": process.env.APP_TOKEN } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/** An org_admin session cookie for `orgId`, minted the way a real one is —
 *  through the login endpoint, so the test exercises the same session path
 *  production uses rather than a hand-built cookie. */
async function orgAdmin(orgId) {
  const email = `trivia-admin-${stamp}-${adminEmails.length}@example.com`;
  const password = "test-password-1";
  adminEmails.push(email);
  await testQuery(
    `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3)`,
    [email, orgId, hashPassword(password)]
  );
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.headers.get("set-cookie").split(";")[0];
}

const QUESTION = {
  prompt: "What is the capital of France?",
  choices: ["Paris", "Lyon", "Marseille"],
  answer: 0,
  category: "Geography",
};

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  for (const slug of [`triv-a-${stamp}`, `triv-b-${stamp}`]) {
    const row = await testQuery(`insert into org (name, slug) values ($1, $1) returning id`, [slug]);
    orgIds.push(row.rows[0].id);
  }
  [orgA, orgB] = orgIds;
  adminACookie = await orgAdmin(orgA);
  const platform = await testQuery(
    `select id from trivia_question where org_id is null limit 1`
  );
  platformQuestionId = platform.rows[0]?.id ?? null;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from trivia_question where org_id = any($1::uuid[])`, [orgIds]);
  await testQuery(`delete from admin_user where email = any($1::text[])`, [adminEmails]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [orgIds]);
});

test("an org_admin's question is stamped with their org, whatever they claim", async () => {
  // Passing someone else's orgId in the body must not move the row — the
  // scope comes from the session, never the payload.
  const res = await call("POST", "/trivia/questions", { ...QUESTION, orgId: orgB }, { cookie: adminACookie });
  assert.equal(res.status, 200);
  const { question } = await res.json();
  assert.equal(question.orgId, orgA);
  assert.equal(question.answer, 0);
  assert.deepEqual(question.choices, QUESTION.choices);
});

test("an org_admin cannot edit the platform pack", async () => {
  assert.ok(platformQuestionId, "the platform pack should be seeded");
  const res = await call(
    "POST",
    "/trivia/questions",
    { ...QUESTION, id: platformQuestionId },
    { cookie: adminACookie }
  );
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /read-only/);

  const archive = await call("POST", `/trivia/questions/${platformQuestionId}/archive`, null, {
    cookie: adminACookie,
  });
  assert.equal(archive.status, 403);
});

test("an org_admin cannot edit another org's question", async () => {
  const rival = await testQuery(
    `insert into trivia_question (org_id, category, prompt, choices, answer)
     values ($1, 'Rival', $2, '["a","b"]'::jsonb, 0) returning id`,
    [orgB, `rival-q-${stamp}`]
  );
  const res = await call(
    "POST",
    "/trivia/questions",
    { ...QUESTION, id: rival.rows[0].id },
    { cookie: adminACookie }
  );
  assert.equal(res.status, 403);
});

test("an org_admin lists their own questions plus the read-only platform pack", async () => {
  await testQuery(
    `insert into trivia_question (org_id, category, prompt, choices, answer)
     values ($1, 'Rival', $2, '["a","b"]'::jsonb, 0)`,
    [orgB, `rival-list-${stamp}`]
  );
  const res = await call("GET", "/trivia/questions", null, { cookie: adminACookie });
  const { questions } = await res.json();
  assert.ok(questions.some((q) => q.orgId === orgA), "their own");
  assert.ok(questions.some((q) => q.orgId === null), "and the pack their hosts will deal");
  assert.ok(!questions.some((q) => q.orgId === orgB), "never a rival's");
});

test("a super_admin can write the platform pack", async () => {
  const res = await call(
    "POST",
    "/trivia/questions",
    { ...QUESTION, prompt: `platform-write-${stamp}` },
    { token: true }
  );
  assert.equal(res.status, 200);
  const { question } = await res.json();
  assert.equal(question.orgId, null);
  await testQuery(`delete from trivia_question where id = $1`, [question.id]);
});

test("malformed questions are refused with a reason", async () => {
  const cases = [
    [{ ...QUESTION, prompt: "hi" }, /prompt/],
    [{ ...QUESTION, choices: ["only one"] }, /choices/],
    [{ ...QUESTION, choices: ["same", "same"] }, /distinct/],
    [{ ...QUESTION, answer: 9 }, /answer/],
    [{ ...QUESTION, difficulty: 7 }, /difficulty/],
  ];
  for (const [body, expected] of cases) {
    const res = await call("POST", "/trivia/questions", body, { cookie: adminACookie });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match((await res.json()).error, expected);
  }
});

test("archiving hides a question from the default list but keeps the row", async () => {
  const created = await call("POST", "/trivia/questions", { ...QUESTION, prompt: `archive-me-${stamp}` }, { cookie: adminACookie });
  const { question } = await created.json();

  await call("POST", `/trivia/questions/${question.id}/archive`, null, { cookie: adminACookie });
  const live = await (await call("GET", "/trivia/questions", null, { cookie: adminACookie })).json();
  assert.ok(!live.questions.some((q) => q.id === question.id));

  const all = await (
    await call("GET", "/trivia/questions?includeArchived=1", null, { cookie: adminACookie })
  ).json();
  assert.ok(all.questions.some((q) => q.id === question.id), "the row is archived, not deleted");

  await call("POST", `/trivia/questions/${question.id}/unarchive`, null, { cookie: adminACookie });
  const back = await (await call("GET", "/trivia/questions", null, { cookie: adminACookie })).json();
  assert.ok(back.questions.some((q) => q.id === question.id));
});

