// Integration coverage for venue SVG stickers: the sanitizer's rejections, the
// admin upload/list/remove (org-scoped, audited), and the player-facing list +
// hardened SVG serve. No AI anywhere — the booth pipeline never touches a model.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm as rmDir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_DATABASE_URL,
  ensureSchema,
  testQuery,
  listenEphemeral,
} from "../test-support/testDb.js";
import { validateSvgSticker } from "../lib/svgSanitize.js";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const APP_TOKEN = `stickers-test-token-${Date.now()}`;
process.env.APP_TOKEN = APP_TOKEN;

const stickerDir = await mkdtemp(join(tmpdir(), "ffc-stickers-test-"));
process.env.PHOTO_BOOTH_STICKER_DIR = stickerDir;

const { app } = await import("../app.js");

let baseUrl;
let close;
let locationId;
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const GOOD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120" height="60"><rect width="120" height="60" rx="8" fill="#e11"/></svg>';

function adminGet(path) {
  return fetch(`${baseUrl}/api/admin/booth-stickers${path}`, {
    headers: { "x-app-token": APP_TOKEN },
  });
}
function adminUpload(bodyObj) {
  return fetch(`${baseUrl}/api/admin/booth-stickers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-token": APP_TOKEN },
    body: JSON.stringify(bodyObj),
  });
}
function adminPost(path) {
  return fetch(`${baseUrl}/api/admin/booth-stickers${path}`, {
    method: "POST",
    headers: { "x-app-token": APP_TOKEN },
  });
}

before(async () => {
  await ensureSchema();
  ({ baseUrl, close } = await listenEphemeral(app));
  const loc = await testQuery(
    `insert into location (name, slug) values ($1, $2) returning id`,
    [`Sticker Venue ${stamp}`, `sticker-test-${stamp}`]
  );
  locationId = loc.rows[0].id;
});

after(async () => {
  if (close) await close();
  await testQuery(`delete from booth_sticker where location_id = $1`, [locationId]);
  await testQuery(`delete from admin_audit where entity = 'booth_sticker'`);
  await testQuery(`delete from location where id = $1`, [locationId]);
  await rmDir(stickerDir, { recursive: true, force: true });
  const { pool } = await import("../db.js");
  await pool.end();
});

test("the sanitizer rejects dangerous SVG and accepts a plain one", () => {
  const bad = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body/></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.example">x</a></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/a)"/></svg>',
    "<html><body>not an svg</body></html>",
  ];
  for (const s of bad) {
    assert.equal(validateSvgSticker(Buffer.from(s)).ok, false, `should reject: ${s.slice(0, 40)}`);
  }
  const good = validateSvgSticker(Buffer.from(GOOD_SVG));
  assert.equal(good.ok, true);
  assert.equal(good.width, 120);
  assert.equal(good.height, 60);
  // Internal fragment refs are allowed.
  const frag = validateSvgSticker(
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="#a"/></svg>')
  );
  // <use> is on the element denylist, so this one is rejected — that's fine;
  // check a fragment fill ref instead, which is allowed.
  assert.equal(frag.ok, false);
  const fragFill = validateSvgSticker(
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill="url(#g)"/></svg>')
  );
  assert.equal(fragFill.ok, true);

  // An <?xml …?> declaration must not shadow the <svg> element when reading the
  // intrinsic size (else non-square stickers export distorted).
  const declared = validateSvgSticker(
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80"><rect width="200" height="80"/></svg>'
    )
  );
  assert.equal(declared.ok, true);
  assert.equal(declared.width, 200);
  assert.equal(declared.height, 80);
});

test("upload validates, stores the file, and records intrinsic size + audit", async () => {
  assert.equal((await fetch(`${baseUrl}/api/admin/booth-stickers?location=${locationId}`)).status, 401);

  // A dangerous SVG is refused at the API too.
  const rejected = await adminUpload({
    locationId,
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>',
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /rejected/i);

  const up = await adminUpload({ locationId, label: "House logo", svg: GOOD_SVG });
  assert.equal(up.status, 200);
  const saved = await up.json();
  assert.ok(saved.id);
  assert.equal(saved.width, 120);
  assert.equal(saved.height, 60);

  const row = await testQuery(`select svg_path, label from booth_sticker where id = $1`, [saved.id]);
  assert.equal(row.rows[0].label, "House logo");
  await access(row.rows[0].svg_path); // file on disk

  const auditRow = await testQuery(
    `select action from admin_audit where entity = 'booth_sticker' and entity_id = $1`,
    [saved.id]
  );
  assert.equal(auditRow.rows[0].action, "booth_sticker.create");

  // Admin preview serves the SVG with hardened headers.
  const img = await adminGet(`/${saved.id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/svg+xml");
  assert.match(img.headers.get("content-security-policy"), /sandbox/);
  assert.equal(img.headers.get("x-content-type-options"), "nosniff");
});

test("kind + corner: frames and watermarks upload, validate, and list", async () => {
  const frame = await adminUpload({ locationId, label: 'Arch', svg: GOOD_SVG, kind: 'frame' });
  assert.equal(frame.status, 200);
  assert.equal((await frame.json()).kind, 'frame');

  const wm = await adminUpload({ locationId, label: 'Brand', svg: GOOD_SVG, kind: 'watermark', corner: 'br' });
  assert.equal(wm.status, 200);
  const wmBody = await wm.json();
  assert.equal(wmBody.kind, 'watermark');
  assert.equal(wmBody.corner, 'br');

  // Defaults when omitted.
  const plain = await (await adminUpload({ locationId, svg: GOOD_SVG })).json();
  assert.equal(plain.kind, 'sticker');
  assert.equal(plain.corner, 'tr');

  // Bad kind / corner rejected.
  assert.equal((await adminUpload({ locationId, svg: GOOD_SVG, kind: 'nope' })).status, 400);
  assert.equal(
    (await adminUpload({ locationId, svg: GOOD_SVG, kind: 'watermark', corner: 'middle' })).status,
    400
  );

  // The player list carries kind + corner too.
  const list = await (await fetch(`${baseUrl}/api/photos/stickers?location=${locationId}`)).json();
  const listedFrame = list.find((s) => s.id === wmBody.id);
  assert.equal(listedFrame.corner, 'br');
  assert.ok(list.some((s) => s.kind === 'frame'));
});

test("player endpoints: list a venue's stickers and serve the SVG inert", async () => {
  const up = await adminUpload({ locationId, label: "Star", svg: GOOD_SVG });
  const { id } = await up.json();

  const list = await (
    await fetch(`${baseUrl}/api/photos/stickers?location=${locationId}`)
  ).json();
  const found = list.find((s) => s.id === id);
  assert.ok(found, "uploaded sticker appears in the venue list");
  assert.equal(found.width, 120);
  assert.equal(found.height, 60);

  const img = await fetch(`${baseUrl}/api/photos/stickers/${id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/svg+xml");
  assert.match(img.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(img.headers.get("x-content-type-options"), "nosniff");
  assert.match(await img.text(), /<svg/);

  // Bad ids: 400 / 404.
  assert.equal((await fetch(`${baseUrl}/api/photos/stickers/nope/image`)).status, 400);
  assert.equal(
    (await fetch(`${baseUrl}/api/photos/stickers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/image`)).status,
    404
  );
  assert.equal((await fetch(`${baseUrl}/api/photos/stickers?location=nope`)).status, 400);
});

test("remove deletes the file and row, audited, and drops it from the venue list", async () => {
  const up = await adminUpload({ locationId, svg: GOOD_SVG });
  const { id } = await up.json();
  const svgPath = (await testQuery(`select svg_path from booth_sticker where id = $1`, [id]))
    .rows[0].svg_path;

  const removed = await adminPost(`/${id}/remove`);
  assert.equal(removed.status, 200);
  await assert.rejects(access(svgPath), "file must be gone");
  assert.equal(
    (await testQuery(`select 1 from booth_sticker where id = $1`, [id])).rowCount,
    0
  );
  const auditRow = await testQuery(
    `select action from admin_audit
      where entity = 'booth_sticker' and entity_id = $1 and action = 'booth_sticker.remove'`,
    [id]
  );
  assert.equal(auditRow.rowCount, 1);

  const listAfter = await (
    await fetch(`${baseUrl}/api/photos/stickers?location=${locationId}`)
  ).json();
  assert.ok(!listAfter.map((s) => s.id).includes(id));

  assert.equal((await adminPost(`/${id}/remove`)).status, 404);
});
