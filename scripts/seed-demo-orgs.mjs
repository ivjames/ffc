#!/usr/bin/env node
// Seed the demo orgs (deploy/demo-orgs.seed.json) through the admin API on
// loopback — the same validated path Master Control uses, so nothing here can
// write a row the console couldn't. APP_TOKEN acts as unrestricted super_admin
// on /api/admin/* (server/lib/adminAuth.js), matching how `ffc seed` already
// authenticates. Idempotent via fixed UUIDs + upsert-on-id; re-running RESETS
// the demo orgs to the seed file (deliberate — they're demos, not customers).
//
// Env: APP_TOKEN (required), FFC_API (default http://127.0.0.1:8060).
// Normally run via: ffc seed-demo
import { readFile } from "node:fs/promises";

const API = (process.env.FFC_API || "http://127.0.0.1:8060").replace(/\/$/, "");
const TOKEN = process.env.APP_TOKEN;
if (!TOKEN) {
  console.error("APP_TOKEN is required (the seeder drives /api/admin/*)");
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-app-token": TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${json.error ?? "unknown error"}`);
  }
  return json;
}

const seed = JSON.parse(
  await readFile(new URL("../deploy/demo-orgs.seed.json", import.meta.url), "utf8"),
);

for (const { branding, locations, __comment, ...org } of seed.orgs) {
  await call("POST", "/api/admin/orgs", org);
  // Branding goes through the PATCH (full replace) rather than the org POST so
  // a re-run always restores the demo look — same call the console makes.
  await call("PATCH", `/api/admin/orgs/${org.id}/branding`, branding);
  for (const { courses, ...loc } of locations) {
    await call("POST", "/api/admin/locations", { ...loc, orgId: org.id });
    for (const course of courses) {
      await call("POST", "/api/admin/courses", { ...course, locationId: loc.id });
    }
    console.log(`  ${org.slug}/${loc.slug}: location + ${courses.length} course(s)`);
  }
  console.log(`ok: org ${org.slug}`);
}
console.log("Demo orgs seeded. Tenant cache TTL is ~30s — subdomains pick them up shortly.");
