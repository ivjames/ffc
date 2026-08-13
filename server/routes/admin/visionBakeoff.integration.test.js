// Integration coverage for the vision bake-off's test-data enforcement
// (routes/admin/visionBakeoff.js): every image entering the dataset is
// people-screened SERVER-SIDE before storage, and /prescan + /describe refuse
// raw image bytes — they only take a stored dataset id, so bytes can't reach
// a third-party provider without having passed the screen (the CLAUDE.md
// no-guests-in-test-data policy, enforced at the API rather than in page JS).
//
// lib/itemImageScreen.js (the ingest screen) and the bench core (the actual
// provider calls) are mocked via node:test's mock.module — registered before
// app.js is imported, same arrangement as huntItems.integration.test.js.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const APP_TOKEN = `vision-bakeoff-test-token-${Date.now()}`;
process.env.APP_TOKEN = APP_TOKEN;

// The disk store reads BAKEOFF_DATA_DIR at module init — point it at a temp
// dir before anything imports the store.
const dataDir = await mkdtemp(join(tmpdir(), "ffc-bakeoff-test-"));
process.env.BAKEOFF_DATA_DIR = dataDir;

// Ingest screen: people-free by default; individual tests flip these.
let screeningOn = true;
let screenResult = { peoplePresent: false };
const screenMock = mock.fn(async () => ({
  peoplePresent: screenResult.peoplePresent,
  subject: "test windmill",
  provider: "mock-descriptor",
  inputTokens: 300,
  outputTokens: 20,
  cost: 0.000105,
}));
mock.module("../../lib/itemImageScreen.js", {
  namedExports: {
    isScreeningConfigured: () => screeningOn,
    screenItemImage: screenMock,
  },
});

// Bench core: one always-configured provider, no network anywhere.
const prescanMock = mock.fn(async () => ({
  subject: "mock subject",
  provider: "mockprov",
  inputTokens: 100,
  outputTokens: 10,
  cost: 0.0001,
  ms: 5,
}));
const describeMock = mock.fn(async () => ({
  text: "a mock description",
  inputTokens: 200,
  outputTokens: 30,
  cost: 0.0002,
  ms: 7,
}));
mock.module("../../../scripts/lib/vision-compare-core.mjs", {
  namedExports: {
    PROVIDERS: [
      {
        name: "mockprov",
        label: "Mock Provider",
        model: "mock-model",
        keyEnv: "MOCK_KEY",
        price: { in: 1, out: 2 },
      },
    ],
    MEDIA_TYPES: { jpeg: "image/jpeg", png: "image/png" },
    DEFAULT_PROMPT: "Describe this image.",
    HUNT_PROMPT_TEMPLATE: "Is __SUBJECT__ present? __DISTRACTORS__",
    isConfigured: () => true,
    describeImage: describeMock,
    prescanSubject: prescanMock,
    sourceScan: async () => ({ peoplePresent: false, subject: "" }),
  },
});

const { app } = await import("../../app.js");

let baseUrl;
let close;

function call(method, path, body) {
  return fetch(`${baseUrl}/api/admin/vision-bakeoff${path}`, {
    method,
    headers: { "x-app-token": APP_TOKEN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const IMAGE_B64 = Buffer.from("bench-image-bytes").toString("base64");

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  if (close) await close();
  await rmDir(dataDir, { recursive: true, force: true });
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("the surface is admin-gated", async () => {
  const res = await fetch(`${baseUrl}/api/admin/vision-bakeoff/dataset`);
  assert.equal(res.status, 401);
});

test("dataset add screens server-side and stores a people-free image (scan cost surfaced)", async () => {
  const res = await call("POST", "/dataset", {
    name: "windmill.jpg",
    subject: "windmill",
    mediaType: "image/jpeg",
    imageBase64: IMAGE_B64,
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(j.id);
  // The billed screen call rides back on the response, per the operator
  // token-burn policy.
  assert.equal(j.scan.provider, "mock-descriptor");
  assert.equal(j.scan.inputTokens, 300);
  assert.ok(screenMock.mock.callCount() >= 1);
});

test("dataset add REJECTS an image with people — nothing stored", async () => {
  screenResult = { peoplePresent: true };
  const beforeList = await (await call("GET", "/dataset")).json();
  const res = await call("POST", "/dataset", {
    name: "crowd.jpg",
    mediaType: "image/jpeg",
    imageBase64: Buffer.from("people-bytes").toString("base64"),
  });
  screenResult = { peoplePresent: false };
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.equal(j.peoplePresent, true);
  assert.ok(j.scan); // the rejected screen still cost tokens — surfaced
  const afterList = await (await call("GET", "/dataset")).json();
  assert.equal(afterList.images.length, beforeList.images.length);
});

test("dataset add refuses to store anything when screening is not configured", async () => {
  screeningOn = false;
  const res = await call("POST", "/dataset", {
    name: "x.jpg",
    mediaType: "image/jpeg",
    imageBase64: IMAGE_B64,
  });
  screeningOn = true;
  assert.equal(res.status, 503);
});

test("prescan refuses raw image bytes — dataset id only", async () => {
  const raw = await call("POST", "/prescan", {
    imageBase64: IMAGE_B64,
    mediaType: "image/jpeg",
  });
  assert.equal(raw.status, 400);
  assert.match((await raw.json()).error, /imageId/);
});

test("prescan reads the STORED bytes for a dataset id (and caches by content)", async () => {
  const add = await (
    await call("POST", "/dataset", {
      name: "carousel.jpg",
      mediaType: "image/jpeg",
      imageBase64: Buffer.from("carousel-bytes").toString("base64"),
    })
  ).json();
  prescanMock.mock.resetCalls();
  const res = await call("POST", "/prescan", { imageId: add.id });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).subject, "mock subject");
  // The provider call got the stored bytes, not anything client-supplied.
  assert.equal(prescanMock.mock.callCount(), 1);
  assert.equal(
    prescanMock.mock.calls[0].arguments[0].base64,
    Buffer.from("carousel-bytes").toString("base64")
  );
  // Same content again → cache hit, no second model call.
  const again = await call("POST", "/prescan", { imageId: add.id });
  assert.equal((await again.json()).cached, true);
  assert.equal(prescanMock.mock.callCount(), 1);
});

test("describe refuses raw image bytes and unknown ids — stored bytes only", async () => {
  const raw = await call("POST", "/describe", {
    provider: "mockprov",
    imageBase64: IMAGE_B64,
    mediaType: "image/jpeg",
  });
  assert.equal(raw.status, 400);
  assert.match((await raw.json()).error, /imageId/);

  const ghost = await call("POST", "/describe", {
    provider: "mockprov",
    imageId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(ghost.status, 400);

  const add = await (
    await call("POST", "/dataset", {
      name: "gnome.jpg",
      mediaType: "image/jpeg",
      imageBase64: Buffer.from("gnome-bytes").toString("base64"),
    })
  ).json();
  describeMock.mock.resetCalls();
  const res = await call("POST", "/describe", {
    provider: "mockprov",
    imageId: add.id,
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).text, "a mock description");
  assert.equal(describeMock.mock.callCount(), 1);
  assert.equal(
    describeMock.mock.calls[0].arguments[1].base64,
    Buffer.from("gnome-bytes").toString("base64")
  );

  const badProv = await call("POST", "/describe", {
    provider: "nope",
    imageId: add.id,
  });
  assert.equal(badProv.status, 400);
});
