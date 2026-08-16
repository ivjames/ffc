// Integration coverage for branding asset uploads (MULTI-VENUE.md §6 bullet 3):
// POST /api/admin/orgs/:id/branding/assets — permissions (super_admin or own
// org_admin), content sniffing per kind, the icon PNG/dimension rule, the SVG
// denylist, and the /api/brand-assets static serve in app.js round-tripping
// the stored file with immutable caching. The tiny "images" are hand-built
// buffers (no image library anywhere — matching lib/pngInfo.js's approach).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { access, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../../test-support/testDb.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_TOKEN = "brand-assets-test-token";
// BRAND_ASSET_DIR is read at import time (like the other asset dirs), so pin a
// scratch dir BEFORE importing app.js.
const ASSET_DIR = mkdtempSync(join(tmpdir(), "ffc-brand-assets-"));
process.env.BRAND_ASSET_DIR = ASSET_DIR;
// The org byte budget is read at import time too — pin a small override so
// the budget tests don't need MiB-sized bodies (and the env knob is proven).
process.env.BRAND_ASSET_ORG_BUDGET_BYTES = String(40 * 1024);

const { app } = await import("../../app.js");
const { hashPassword } = await import("../../lib/adminPasswords.js");
const { BRAND_ASSET_ORG_BUDGET_BYTES } = await import("../../lib/brandAssets.js");

let baseUrl;
let close;
let orgAId, orgBId;
let orgAdminACookie;
const userIds = [];
const orgIds = [];

// --- Hand-built image fixtures ------------------------------------------------

// A minimal structurally-valid PNG at the given dimensions: signature, IHDR
// (width/height at data bytes 0-7 → file bytes 16-23, big-endian), one IDAT
// byte, IEND. validatePng doesn't verify CRCs, so zeroed CRC slots are fine.
function pngBuffer(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from([0x00])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// JPEG/WebP are accepted on magic bytes alone — minimal headers suffice.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "latin1"),
  Buffer.alloc(16),
]);
const SVG_OK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`;
const SVG_XML_OK = `<?xml version="1.0"?>\n${SVG_OK}`;

// --- Request helpers ----------------------------------------------------------

async function loginCookie(email, password) {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.headers.get("set-cookie").split(";")[0];
}

// super_admin via APP_TOKEN (the bootstrap credential).
function asSuper(path, opts = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-app-token": "brand-assets-test-token",
      ...opts.headers,
    },
  });
}

function as(cookie) {
  return (path, opts = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...opts.headers },
    });
}

function uploadAsset(fetcher, orgId, body) {
  return fetcher(`/api/admin/orgs/${orgId}/branding/assets`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function assetBody(kind, bytes, filename = "asset.bin") {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  return { kind, filename, data: buf.toString("base64") };
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const orgA = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Brand Assets Org A ${stamp}`,
    `brand-assets-org-a-${stamp}`,
  ]);
  orgAId = orgA.rows[0].id;
  const orgB = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Brand Assets Org B ${stamp}`,
    `brand-assets-org-b-${stamp}`,
  ]);
  orgBId = orgB.rows[0].id;
  orgIds.push(orgAId, orgBId);

  const email = `brand-assets-org-admin-a-${stamp}@example.com`;
  const password = "test-password-1";
  const a = await testQuery(
    `insert into admin_user (email, role, org_id, password_hash) values ($1, 'org_admin', $2, $3) returning id`,
    [email, orgAId, hashPassword(password)]
  );
  userIds.push(a.rows[0].id);
  orgAdminACookie = await loginCookie(email, password);
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from admin_user where id = any($1::uuid[])`, [userIds]);
  await testQuery(`delete from admin_audit where entity = 'org' and entity_id = any($1::uuid[])`, [
    orgIds,
  ]);
  await testQuery(`delete from org where id = any($1::uuid[])`, [orgIds]);
  await rm(ASSET_DIR, { recursive: true, force: true });
  const { pool } = await import("../../db.js");
  await pool.end();
});

test("happy path per kind: stored under <orgId>/<kind>-<sha12>.<ext>, served back verbatim", async () => {
  const cases = [
    { kind: "logo", bytes: pngBuffer(1, 1), ext: "png", type: "image/png" },
    { kind: "logo", bytes: WEBP, ext: "webp", type: "image/webp" },
    { kind: "logoBadge", bytes: JPEG, ext: "jpg", type: "image/jpeg" },
    { kind: "logoWordmark", bytes: Buffer.from(SVG_OK, "utf8"), ext: "svg", type: "image/svg+xml" },
    { kind: "logoWordmark", bytes: Buffer.from(SVG_XML_OK, "utf8"), ext: "svg", type: "image/svg+xml" },
    { kind: "icon192", bytes: pngBuffer(192, 192), ext: "png", type: "image/png" },
    { kind: "icon512", bytes: pngBuffer(512, 512), ext: "png", type: "image/png" },
  ];
  for (const { kind, bytes, ext, type } of cases) {
    const res = await uploadAsset(asSuper, orgAId, assetBody(kind, bytes, `file.${ext}`));
    assert.equal(res.status, 200, `${kind}/${ext} upload should succeed`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(
      body.url,
      new RegExp(`^/api/brand-assets/${orgAId}/${kind}-[0-9a-f]{12}\\.${ext}$`),
      `${kind}/${ext} URL shape`
    );
    // The file is really on disk under the org's dir…
    await access(join(ASSET_DIR, orgAId, body.url.split("/").pop()));
    // …and the /api/brand-assets static mount serves it back byte-for-byte,
    // hard-cached (content-hashed name) and inert (nosniff).
    const served = await fetch(`${baseUrl}${body.url}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type").split(";")[0], type);
    assert.match(served.headers.get("cache-control"), /immutable/);
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes);
  }
});

test("same bytes re-uploaded land on the same content-hashed URL", async () => {
  const bytes = pngBuffer(7, 7);
  const first = await (await uploadAsset(asSuper, orgAId, assetBody("logo", bytes))).json();
  const second = await (await uploadAsset(asSuper, orgAId, assetBody("logo", bytes))).json();
  assert.equal(first.url, second.url);
});

test("the returned URL passes branding validation (PATCH round-trip), and upload alone never touches org.branding", async () => {
  const beforeRow = await testQuery(`select branding from org where id = $1`, [orgAId]);
  const up = await uploadAsset(asSuper, orgAId, assetBody("logo", pngBuffer(2, 2)));
  const { url } = await up.json();
  // The upload endpoint does NOT modify org.branding — the admin form fills
  // the field and Save keeps the PATCH's replace semantics.
  const afterRow = await testQuery(`select branding from org where id = $1`, [orgAId]);
  assert.deepEqual(afterRow.rows[0].branding, beforeRow.rows[0].branding);

  const patched = await asSuper(`/api/admin/orgs/${orgAId}/branding`, {
    method: "PATCH",
    body: JSON.stringify({ logoUrl: url }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).org.branding.logoUrl, url);
});

test("uploads are audited as org.branding_asset", async () => {
  await uploadAsset(asSuper, orgAId, assetBody("logoBadge", pngBuffer(3, 3), "badge.png"));
  const audit = await testQuery(
    `select detail from admin_audit
      where entity = 'org' and entity_id = $1 and action = 'org.branding_asset'
        and detail->>'filename' = 'badge.png'`,
    [orgAId]
  );
  assert.ok(audit.rowCount >= 1, "asset uploads are audited");
  const detail = audit.rows[0].detail; // jsonb — pg hands back the object
  assert.equal(detail.kind, "logoBadge");
  assert.match(detail.url, /^\/api\/brand-assets\//);
});

test("an org_admin can upload for their OWN org, but not another org", async () => {
  const asA = as(orgAdminACookie);
  const own = await uploadAsset(asA, orgAId, assetBody("logo", pngBuffer(4, 4)));
  assert.equal(own.status, 200);
  const other = await uploadAsset(asA, orgBId, assetBody("logo", pngBuffer(4, 4)));
  assert.equal(other.status, 403);
});

test("validation rejections all 400 with a pointed error", async () => {
  const cases = [
    // [body, /error/]
    [assetBody("bogus", pngBuffer(1, 1)), /kind must be one of/],
    [{ kind: "logo", filename: "x.png" }, /data .*required/i],
    [{ kind: "logo", filename: "x.png", data: "not base64 !!!" }, /not valid base64/],
    [{ kind: "logo", filename: "x".repeat(201), data: pngBuffer(1, 1).toString("base64") }, /filename/],
    [assetBody("logo", Buffer.from([0x01, 0x02, 0x03, 0x04])), /unsupported file type/],
    // Over the 1 MiB decoded cap (content irrelevant — size is checked first).
    [assetBody("logo", Buffer.alloc(1024 * 1024 + 1)), /too large/],
    // Truncated PNG: valid signature, no chunks.
    [assetBody("logo", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), /PNG rejected/],
    // Icon kinds: PNG only, exact dimensions.
    [assetBody("icon192", pngBuffer(1, 1)), /must be exactly 192×192/],
    [assetBody("icon512", pngBuffer(512, 192)), /must be exactly 512×512/],
    [assetBody("icon192", JPEG), /must be a PNG/],
    [assetBody("icon512", Buffer.from(SVG_OK, "utf8")), /must be a PNG/],
    // SVG denylist: scripts, on{load,error}= handlers, javascript: URLs.
    [assetBody("logo", `<svg xmlns="x"><script>alert(1)</script></svg>`), /contains <script>/],
    [assetBody("logo", `<svg xmlns="x" onload="alert(1)"/>`), /onload=/],
    [assetBody("logo", `<SVG ONLOAD = "alert(1)"/>`), /onload=/],
    [assetBody("logo", `<svg xmlns="x"><image onerror="x"/></svg>`), /onerror=/],
    [assetBody("logo", `<svg xmlns="x"><a href="javascript:alert(1)">x</a></svg>`), /javascript:/],
    // Text that isn't an SVG document at all.
    [assetBody("logo", `<html><body>hi</body></html>`), /unsupported file type/],
  ];
  for (const [body, re] of cases) {
    const res = await uploadAsset(asSuper, orgAId, body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 80)}`);
    assert.match((await res.json()).error, re);
  }
});

test("bad uuid -> 400, missing org -> 404 (and nothing is written)", async () => {
  const bad = await uploadAsset(asSuper, "not-a-uuid", assetBody("logo", pngBuffer(1, 1)));
  assert.equal(bad.status, 400);
  const missing = await uploadAsset(
    asSuper,
    "00000000-0000-4000-8000-000000000000",
    assetBody("logo", pngBuffer(1, 1))
  );
  assert.equal(missing.status, 404);
  await assert.rejects(access(join(ASSET_DIR, "00000000-0000-4000-8000-000000000000")));
});

// --- Storage budget + prune-on-upload (PR #191 review, finding 4) ------------
// Fresh org per test: pruning is mtime-ordered per kind, so these must not
// share a dir with the uploads the earlier tests accumulated on org A.

/** Distinct valid webp payloads at an exact byte size (sniffed on the
 *  RIFF/WEBP header alone, so the tail is arbitrary padding). */
function webpOfSize(size, fill) {
  return Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.from([0x10, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "latin1"),
    Buffer.alloc(size - 12, fill),
  ]);
}

async function makePruneOrg(label) {
  const s = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const db = await testQuery(`insert into org (name, slug) values ($1, $2) returning id`, [
    `Brand Assets ${s}`,
    `brand-assets-${s}`,
  ]);
  orgIds.push(db.rows[0].id);
  return db.rows[0].id;
}

const fileOf = (orgId, url) => join(ASSET_DIR, orgId, url.split("/").pop());

/** Pin a stored file's mtime into the past — prune ordering must not depend
 *  on how fast consecutive HTTP uploads land within the same millisecond. */
async function backdate(orgId, url, msAgo) {
  const when = new Date(Date.now() - msAgo);
  await utimes(fileOf(orgId, url), when, when);
}

async function uploadOk(orgId, kind, bytes, msAgo) {
  const res = await uploadAsset(asSuper, orgId, assetBody(kind, bytes));
  assert.equal(res.status, 200, `${kind} upload should succeed`);
  const { url } = await res.json();
  if (msAgo !== undefined) await backdate(orgId, url, msAgo);
  return url;
}

test("prune-on-upload: superseded unreferenced files past the 2-newest-per-kind grace window are deleted", async () => {
  const orgId = await makePruneOrg("prune");
  // A different kind's lone old file must never be swept by logo churn.
  const badge = await uploadOk(orgId, "logoBadge", webpOfSize(64, 0xb0), 60_000);
  const v1 = await uploadOk(orgId, "logo", webpOfSize(64, 1), 50_000);
  const v2 = await uploadOk(orgId, "logo", webpOfSize(64, 2), 40_000);
  const v3 = await uploadOk(orgId, "logo", webpOfSize(64, 3), 30_000);
  const v4 = await uploadOk(orgId, "logo", webpOfSize(64, 4), 20_000);
  // Nothing is referenced by org.branding, so only the grace window protects:
  // the 2 newest logos survive, the older two are gone.
  await assert.rejects(access(fileOf(orgId, v1)));
  await assert.rejects(access(fileOf(orgId, v2)));
  await access(fileOf(orgId, v3));
  await access(fileOf(orgId, v4));
  await access(fileOf(orgId, badge));
});

test("a file referenced by the org's current branding survives pruning regardless of age", async () => {
  const orgId = await makePruneOrg("keep-ref");
  const keeper = await uploadOk(orgId, "logo", webpOfSize(64, 10), 90_000);
  const patched = await asSuper(`/api/admin/orgs/${orgId}/branding`, {
    method: "PATCH",
    body: JSON.stringify({ logoUrl: keeper }),
  });
  assert.equal(patched.status, 200);
  const v2 = await uploadOk(orgId, "logo", webpOfSize(64, 11), 80_000);
  const v3 = await uploadOk(orgId, "logo", webpOfSize(64, 12), 70_000);
  const v4 = await uploadOk(orgId, "logo", webpOfSize(64, 13), 60_000);
  // keeper is the OLDEST logo yet still on disk and served — it is the org's
  // live logoUrl. The unreferenced middle upload aged out as usual.
  await access(fileOf(orgId, keeper));
  assert.equal((await fetch(`${baseUrl}${keeper}`)).status, 200);
  await assert.rejects(access(fileOf(orgId, v2)));
  await access(fileOf(orgId, v3));
  await access(fileOf(orgId, v4));
});

test("budget: over-budget upload 400s when pruning frees nothing; rotation prunes to make room; dedupe is exempt", async () => {
  assert.equal(BRAND_ASSET_ORG_BUDGET_BYTES, 40 * 1024, "env override is in effect");
  const orgId = await makePruneOrg("budget");
  const CHUNK = 8 * 1024; // 5 × 8 KiB fills the 40 KiB budget exactly
  const logo1 = await uploadOk(orgId, "logo", webpOfSize(CHUNK, 21), 50_000);
  const logo2 = await uploadOk(orgId, "logo", webpOfSize(CHUNK, 22), 40_000);
  await uploadOk(orgId, "logoBadge", webpOfSize(CHUNK, 23), 30_000);
  await uploadOk(orgId, "logoBadge", webpOfSize(CHUNK, 24), 20_000);
  await uploadOk(orgId, "logoWordmark", webpOfSize(CHUNK, 25), 10_000);

  // Every kind is inside its grace window and nothing is prunable, so a NEW
  // wordmark (its kind holds only 1 — the incoming file just takes the second
  // slot) would overflow the budget → 400 with the budget message.
  const over = await uploadAsset(asSuper, orgId, assetBody("logoWordmark", webpOfSize(CHUNK, 26)));
  assert.equal(over.status, 400);
  assert.match((await over.json()).error, /storage budget/);

  // Identical bytes dedupe to the existing name — no new bytes, so a full org
  // still gets its idempotent re-upload.
  const dedupe = await uploadAsset(asSuper, orgId, assetBody("logo", webpOfSize(CHUNK, 22)));
  assert.equal(dedupe.status, 200);
  assert.equal((await dedupe.json()).url, logo2);

  // Rotating a kind already holding 2: the incoming file claims the newest
  // grace slot, so the oldest unreferenced logo is pruned to make room and
  // the upload fits.
  const logo3 = await uploadOk(orgId, "logo", webpOfSize(CHUNK, 27));
  await assert.rejects(access(fileOf(orgId, logo1)));
  await access(fileOf(orgId, logo2));
  await access(fileOf(orgId, logo3));
});

test("static serve: unknown file 404s as JSON, dotfiles are denied", async () => {
  const miss = await fetch(`${baseUrl}/api/brand-assets/${orgAId}/logo-000000000000.png`);
  assert.equal(miss.status, 404);
  assert.equal((await miss.json()).ok, false);

  await mkdir(join(ASSET_DIR, orgAId), { recursive: true });
  await writeFile(join(ASSET_DIR, orgAId, ".sneaky"), "nope");
  const dot = await fetch(`${baseUrl}/api/brand-assets/${orgAId}/.sneaky`);
  assert.equal(dot.status, 403);
});
