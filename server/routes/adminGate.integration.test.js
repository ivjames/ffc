// Integration coverage for the APP_TOKEN gate (Handoff task 1): confirms the
// fail-closed behavior end to end through the real Express app, across every
// route family that shares the requireAppToken/isAuthorized guard, plus that a
// valid token still does real work (no regression on the happy path).
//
// Requires a reachable Postgres at TEST_DATABASE_URL (defaults to
// postgres://postgres:postgres@localhost:5432/ffc_test).
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");

let baseUrl;
let close;
let prevAppToken;

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  await close();
  const { pool } = await import("../db.js");
  await pool.end();
});

beforeEach(() => {
  prevAppToken = process.env.APP_TOKEN;
});

afterEach(() => {
  if (prevAppToken === undefined) delete process.env.APP_TOKEN;
  else process.env.APP_TOKEN = prevAppToken;
});

const GUARDED_REQUESTS = [
  { label: "GET /api/admin/overview", path: "/api/admin/overview", method: "GET" },
  {
    label: "POST /api/seed",
    path: "/api/seed",
    method: "POST",
    body: [],
  },
  {
    label: "POST /api/locations",
    path: "/api/locations",
    method: "POST",
    body: { name: "Nope", slug: "nope" },
  },
];

test("fails closed: every guarded route rejects with APP_TOKEN unset, regardless of header", async () => {
  delete process.env.APP_TOKEN;
  for (const { label, path, method, body } of GUARDED_REQUESTS) {
    for (const headers of [
      {},
      { "x-app-token": "" },
      { "x-app-token": "anything" },
    ]) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(
        res.status,
        401,
        `${label} with headers ${JSON.stringify(headers)} should be 401 when APP_TOKEN is unset`
      );
    }
  }
});

test("APP_TOKEN set: missing or wrong header is still rejected (no regression)", async () => {
  process.env.APP_TOKEN = "s3cret";
  for (const { label, path, method, body } of GUARDED_REQUESTS) {
    for (const headers of [{}, { "x-app-token": "wrong" }]) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(res.status, 401, `${label} with headers ${JSON.stringify(headers)}`);
    }
  }
});

test("APP_TOKEN set: matching token reaches the real handler (happy path preserved)", async () => {
  process.env.APP_TOKEN = "s3cret";

  const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { "x-app-token": "s3cret" },
  });
  assert.equal(overviewRes.status, 200);
  const overview = await overviewRes.json();
  assert.ok(typeof overview.totals.locations === "number");

  const slug = `gate-test-${process.pid}-${Date.now()}`;
  try {
    const createRes = await fetch(`${baseUrl}/api/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-token": "s3cret" },
      body: JSON.stringify({ name: "Gate Test Venue", slug }),
    });
    assert.equal(createRes.status, 200);
    const created = await createRes.json();
    assert.equal(created.ok, true);
    assert.equal(created.location.slug, slug);
  } finally {
    await testQuery("delete from location where slug = $1", [slug]);
  }
});
