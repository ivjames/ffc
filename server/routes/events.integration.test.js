// Integration coverage for the first-party funnel beacon (POST /api/events):
// the allowlist, batch caps, device-id validation, and that a signed-in
// app_user is associated when the session cookie rides along.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";

// Give each event a fresh device-minted id, mirroring the client.
const withIds = (events) => events.map((e) => ({ id: randomUUID(), ...e }));

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app } = await import("../app.js");

let baseUrl;
let close;

const DEVICE = "11111111-1111-4111-8111-111111111111";

function postEvents(body, headers = {}) {
  return fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  await testQuery("delete from funnel_event where device_id = $1", [DEVICE]);
  await close?.();
});

test("rejects a missing or malformed deviceId", async () => {
  assert.equal((await postEvents({ events: [] })).status, 400);
  assert.equal((await postEvents({ deviceId: "nope", events: [] })).status, 400);
});

test("records only allowlisted events and drops the rest", async () => {
  const res = await postEvents({
    deviceId: DEVICE,
    platform: "android",
    events: withIds([
      { name: "install_prompt_shown" },
      { name: "install_accepted", meta: { source: "home-nudge" } },
      { name: "totally_made_up_event" }, // dropped — not on the allowlist
      { name: "signin_completed" },
    ]),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.recorded, 3);

  const rows = (
    await testQuery(
      "select event, platform, meta from funnel_event where device_id = $1 order by event",
      [DEVICE]
    )
  ).rows;
  const names = rows.map((r) => r.event);
  assert.deepEqual(names, ["install_accepted", "install_prompt_shown", "signin_completed"]);
  assert.equal(rows.every((r) => r.platform === "android"), true);
  const accepted = rows.find((r) => r.event === "install_accepted");
  assert.equal(accepted.meta.source, "home-nudge");
});

test("adoption nudge events are allowlisted and keep their kind", async () => {
  const dev = "66666666-6666-4666-8666-666666666666";
  const res = await postEvents({
    deviceId: dev,
    events: withIds([
      { name: "nudge_shown", meta: { kind: "install" } },
      { name: "nudge_clicked", meta: { kind: "install" } },
      { name: "nudge_dismissed", meta: { kind: "signin" } },
    ]),
  });
  assert.equal((await res.json()).recorded, 3);
  const rows = (
    await testQuery("select event, meta from funnel_event where device_id = $1 order by event", [dev])
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.event),
    ["nudge_clicked", "nudge_dismissed", "nudge_shown"]
  );
  assert.equal(rows.find((r) => r.event === "nudge_dismissed").meta.kind, "signin");
  await testQuery("delete from funnel_event where device_id = $1", [dev]);
});

test("drops events with a missing or malformed id (retry-dedupe needs it)", async () => {
  const dev = "44444444-4444-4444-8444-444444444444";
  const res = await postEvents({
    deviceId: dev,
    events: [
      { name: "app_installed" }, // no id -> dropped
      { id: "not-a-uuid", name: "app_installed" }, // bad id -> dropped
    ],
  });
  assert.equal((await res.json()).recorded, 0);
  const count = (
    await testQuery("select count(*)::int as n from funnel_event where device_id = $1", [dev])
  ).rows[0].n;
  assert.equal(count, 0);
});

test("a re-sent batch is idempotent — same ids don't double-count", async () => {
  const dev = "55555555-5555-4555-8555-555555555555";
  const batch = withIds([{ name: "signin_started" }, { name: "signin_completed" }]);
  const first = await (await postEvents({ deviceId: dev, events: batch })).json();
  assert.equal(first.recorded, 2);
  // Exact same ids again (keepalive committed, client never saw the ack).
  const replay = await (await postEvents({ deviceId: dev, events: batch })).json();
  assert.equal(replay.recorded, 0);
  const count = (
    await testQuery("select count(*)::int as n from funnel_event where device_id = $1", [dev])
  ).rows[0].n;
  assert.equal(count, 2); // no double-count
  // A duplicate id WITHIN one batch is collapsed too.
  const dupId = randomUUID();
  const dupRes = await postEvents({
    deviceId: dev,
    events: [
      { id: dupId, name: "app_installed" },
      { id: dupId, name: "app_installed" },
    ],
  });
  assert.equal((await dupRes.json()).recorded, 1);
  await testQuery("delete from funnel_event where device_id = $1", [dev]);
});

test("an unknown platform is stored as null (not trusted verbatim)", async () => {
  const dev = "22222222-2222-4222-8222-222222222222";
  await postEvents({ deviceId: dev, platform: "smart-fridge", events: withIds([{ name: "app_installed" }]) });
  const row = (
    await testQuery("select platform from funnel_event where device_id = $1", [dev])
  ).rows[0];
  assert.equal(row.platform, null);
  await testQuery("delete from funnel_event where device_id = $1", [dev]);
});

test("oversized meta collapses to empty rather than bloating the row", async () => {
  const dev = "33333333-3333-4333-8333-333333333333";
  await postEvents({
    deviceId: dev,
    events: withIds([{ name: "signin_started", meta: { junk: "x".repeat(2000) } }]),
  });
  const row = (
    await testQuery("select meta from funnel_event where device_id = $1", [dev])
  ).rows[0];
  assert.deepEqual(row.meta, {});
  await testQuery("delete from funnel_event where device_id = $1", [dev]);
});
