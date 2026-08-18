// Integration coverage for /api/health — specifically the POST flavor the
// deploy's health gate (bin/ffc api_health) relies on.
//
// The GET only proves the process is up. The POST is the one that exercises
// the JSON body-parse chain (express.json -> body-parser -> raw-body ->
// iconv-lite), whose encodings tables load lazily on the FIRST decode: a
// node_modules missing them boots clean and serves every GET while turning
// every JSON POST in the app into an HTML 400. That exact state shipped once
// because the gate was GET-only, so this pins the contract the gate needs: a
// JSON body posted to /api/health comes back parsed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TEST_DATABASE_URL, listenEphemeral } from "../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");

let baseUrl;
let close;

before(async () => {
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  if (close) await close();
});

test("GET /api/health answers ok with a build stamp", async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.build, "string");
});

test("POST /api/health parses a JSON body — the deploy gate's probe", async () => {
  const res = await fetch(`${baseUrl}/api/health`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ping: true }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.parsed, true, "the posted JSON body must reach the handler parsed");
});
