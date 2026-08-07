// Integration coverage for food & drink links (punchlist #7 tier 1): the
// menuUrl/orderingUrl location fields flowing admin write -> public content.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "foodlinks-test-token";

const { app } = await import("../../app.js");

let baseUrl;
let close;
const locationIds = [];

function admin(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "foodlinks-test-token",
      ...opts.headers,
    },
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_audit where entity = 'location' and entity_id = any($1::uuid[])`, [
    locationIds,
  ]);
  await testQuery(`delete from location where id = any($1::uuid[])`, [locationIds]);
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("location upsert stores, clears, and validates the food links", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await admin("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({
      name: "Food Venue",
      slug: `food-venue-${stamp}`,
      menuUrl: "https://example.com/menu",
      orderingUrl: "https://order.example.com/bullwinkles",
    }),
  });
  assert.equal(created.status, 200);
  const loc = (await created.json()).location;
  locationIds.push(loc.id);
  assert.equal(loc.menuUrl, "https://example.com/menu");
  assert.equal(loc.orderingUrl, "https://order.example.com/bullwinkles");

  // Re-post with empty strings clears them.
  const cleared = await admin("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({ id: loc.id, name: "Food Venue", slug: `food-venue-${stamp}`, menuUrl: "", orderingUrl: "" }),
  });
  assert.equal((await cleared.json()).location.menuUrl, null);

  // Only http(s) absolute URLs pass — a javascript: payload must never store.
  for (const bad of ["javascript:alert(1)", "not a url", "ftp://example.com/x"]) {
    const res = await admin("/api/admin/locations", {
      method: "POST",
      body: JSON.stringify({ name: "Bad", slug: `bad-${stamp}`, menuUrl: bad }),
    });
    assert.equal(res.status, 400, `menuUrl ${bad} must be rejected`);
  }
});

test("GET /api/content carries the food links to the player export", async () => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created = await admin("/api/admin/locations", {
    method: "POST",
    body: JSON.stringify({
      name: "Content Venue",
      slug: `content-venue-${stamp}`,
      orderingUrl: "https://order.example.com/x",
    }),
  });
  const loc = (await created.json()).location;
  locationIds.push(loc.id);

  const content = await (await fetch(`${baseUrl}/api/content`)).json();
  const row = content.locations.find((l) => l.id === loc.id);
  assert.ok(row);
  assert.equal(row.menuUrl, null);
  assert.equal(row.orderingUrl, "https://order.example.com/x");
});
