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

// A structurally-valid PNG: signature + IHDR + a (non-empty) IDAT + IEND, with
// consistent chunk lengths. Enough to pass validatePng's structure checks and
// exercise the server path (CRC/pixel bytes aren't validated).
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4) /* crc */]);
}
function fakePng(w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Buffer.from([0x00])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("PNG assets upload, validate, store, and serve as image/png", async () => {
  const png = fakePng(240, 90);
  const up = await adminUpload({
    locationId,
    label: "Logo",
    kind: "watermark",
    corner: "br",
    imageBase64: png.toString("base64"),
    mediaType: "image/png",
  });
  assert.equal(up.status, 200);
  const body = await up.json();
  assert.equal(body.mediaType, "image/png");
  assert.equal(body.width, 240);
  assert.equal(body.height, 90);
  assert.equal(body.kind, "watermark");

  const row = await testQuery(`select svg_path, media_type from booth_sticker where id = $1`, [body.id]);
  assert.match(row.rows[0].svg_path, /\.png$/);
  assert.equal(row.rows[0].media_type, "image/png");

  // Player serve carries the PNG content type.
  const img = await fetch(`${baseUrl}/api/photos/stickers/${body.id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");

  // Not actually a PNG -> rejected.
  const bad = await adminUpload({
    locationId,
    imageBase64: Buffer.from("this is not a png").toString("base64"),
    mediaType: "image/png",
  });
  assert.equal(bad.status, 400);

  // A non-PNG mediaType on the base64 path -> rejected.
  const badType = await adminUpload({
    locationId,
    imageBase64: png.toString("base64"),
    mediaType: "image/gif",
  });
  assert.equal(badType.status, 400);

  // Signature + IHDR but no image data (no IDAT/IEND) -> rejected (undecodable).
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrOnly = Buffer.concat([
    sig,
    (() => {
      const d = Buffer.alloc(13);
      d.writeUInt32BE(10, 0);
      d.writeUInt32BE(10, 4);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(13, 0);
      return Buffer.concat([len, Buffer.from("IHDR"), d, Buffer.alloc(4)]);
    })(),
  ]);
  const noData = await adminUpload({
    locationId,
    imageBase64: ihdrOnly.toString("base64"),
    mediaType: "image/png",
  });
  assert.equal(noData.status, 400);

  // A decode-bomb resolution (small file, enormous pixel count) -> rejected.
  const huge = await adminUpload({
    locationId,
    imageBase64: fakePng(20000, 20000).toString("base64"),
    mediaType: "image/png",
  });
  assert.equal(huge.status, 400);
});

// A structurally-valid VP8X WebP: RIFF/WEBP + VP8X (canvas dims) + a VP8L frame
// chunk (0x2f signature). Enough for validateWebp (which parses chunk
// boundaries + frame signature, not pixel bytes). `withFrame:false` omits the
// frame to exercise the "no image frame" rejection.
function riffChunk(cc, data) {
  const head = Buffer.alloc(8);
  head.write(cc, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  const pad = data.length & 1 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([head, data, pad]);
}
function fakeWebp(w, h, withFrame = true) {
  const vp8x = Buffer.alloc(10); // flags(1) + reserved(3) + w-1(3) + h-1(3)
  const w1 = w - 1;
  const h1 = h - 1;
  vp8x[4] = w1 & 0xff;
  vp8x[5] = (w1 >> 8) & 0xff;
  vp8x[6] = (w1 >> 16) & 0xff;
  vp8x[7] = h1 & 0xff;
  vp8x[8] = (h1 >> 8) & 0xff;
  vp8x[9] = (h1 >> 16) & 0xff;
  const chunks = [riffChunk("VP8X", vp8x)];
  if (withFrame) chunks.push(riffChunk("VP8L", Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00])));
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1");
  riff.write("WEBP", 8, "latin1");
  const body = Buffer.concat([riff, ...chunks]);
  body.writeUInt32LE(body.length - 8, 4); // RIFF size
  return body;
}

test("WebP assets upload, validate, store, and serve as image/webp", async () => {
  const webp = fakeWebp(300, 120);
  const up = await adminUpload({
    locationId,
    kind: "frame",
    imageBase64: webp.toString("base64"),
    mediaType: "image/webp",
  });
  assert.equal(up.status, 200);
  const body = await up.json();
  assert.equal(body.mediaType, "image/webp");
  assert.equal(body.width, 300);
  assert.equal(body.height, 120);

  const row = await testQuery(`select svg_path, media_type from booth_sticker where id = $1`, [body.id]);
  assert.match(row.rows[0].svg_path, /\.webp$/);

  const img = await fetch(`${baseUrl}/api/photos/stickers/${body.id}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/webp");

  // Not a WebP -> rejected.
  const bad = await adminUpload({
    locationId,
    imageBase64: Buffer.from("nope").toString("base64"),
    mediaType: "image/webp",
  });
  assert.equal(bad.status, 400);

  // VP8X header but no image frame -> rejected (undecodable).
  const noFrame = await adminUpload({
    locationId,
    imageBase64: fakeWebp(300, 120, false).toString("base64"),
    mediaType: "image/webp",
  });
  assert.equal(noFrame.status, 400);
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
