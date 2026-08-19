import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { appBaseCandidates, appBaseStatus, resetAppBaseStatus } from "./captureTarget.js";

// The capture base is DERIVED, not configured: PLATFORM_FQDN plus an org slug
// is the player-app vhost (bin/ffc renders `<slug>.$FQDN` and prints
// "Player app: https://$DEFAULT_ORG_HOST"). Asking an operator to paste a URL
// the software can compute is a setup step that goes stale silently, so the
// ordering below is the feature — these tests pin it.
//
// No probing here: reachability needs a network and this suite is the deploy
// gate. This covers what we ASK, not what answers.

const KEYS = ["FFC_APP_BASE", "PUBLIC_APP_URL", "PLATFORM_FQDN", "DEFAULT_ORG_SLUG"];
const saved = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("a deployed box derives its org vhosts with no URL configured", () => {
  process.env.PLATFORM_FQDN = "ffc.lab980.com";
  const bases = appBaseCandidates(["northstar", "bullwinkles"]).map((c) => c.base);
  // Default org first even though it sorted second — that is the one bin/ffc
  // points the apex's frozen paths at.
  assert.deepEqual(bases, [
    "https://bullwinkles.ffc.lab980.com",
    "https://northstar.ffc.lab980.com",
    "http://127.0.0.1:5173",
  ]);
});

test("DEFAULT_ORG_SLUG moves a renamed default org to the front", () => {
  process.env.PLATFORM_FQDN = "ffc.lab980.com";
  process.env.DEFAULT_ORG_SLUG = "northstar";
  const bases = appBaseCandidates(["bullwinkles", "northstar"]).map((c) => c.base);
  assert.equal(bases[0], "https://northstar.ffc.lab980.com");
});

test("PLATFORM_FQDN with no orgs still names the documented default vhost", () => {
  process.env.PLATFORM_FQDN = "ffc.lab980.com";
  const bases = appBaseCandidates([]).map((c) => c.base);
  assert.equal(bases[0], "https://bullwinkles.ffc.lab980.com");
});

test("FFC_APP_BASE wins over everything — it is the escape hatch", () => {
  process.env.PLATFORM_FQDN = "ffc.lab980.com";
  process.env.PUBLIC_APP_URL = "https://configured.example";
  process.env.FFC_APP_BASE = "http://localhost:4173/";
  const bases = appBaseCandidates(["bullwinkles"]).map((c) => c.base);
  assert.equal(bases[0], "http://localhost:4173"); // trailing slash stripped
  assert.equal(bases[1], "https://configured.example");
});

test("an UNSET PUBLIC_APP_URL never outranks a derived vhost", () => {
  // configuredAppUrl() falls back to a localhost default. Taking that when the
  // operator never set it would rank a dev URL above the box's real vhost —
  // exactly the bug that sent a staging capture at :5173.
  process.env.PLATFORM_FQDN = "ffc.lab980.com";
  const bases = appBaseCandidates(["bullwinkles"]).map((c) => c.base);
  assert.equal(bases[0], "https://bullwinkles.ffc.lab980.com");
  assert.equal(bases.filter((b) => b.includes("localhost")).length, 0);
});

test("a dev box with nothing configured still gets the dev server", () => {
  assert.deepEqual(appBaseCandidates([]).map((c) => c.base), ["http://127.0.0.1:5173"]);
});

test("candidates are de-duplicated and each says where it came from", () => {
  process.env.PLATFORM_FQDN = "ffc.lab980.com";
  process.env.PUBLIC_APP_URL = "https://bullwinkles.ffc.lab980.com";
  const cands = appBaseCandidates(["bullwinkles"]);
  assert.equal(cands.filter((c) => c.base === "https://bullwinkles.ffc.lab980.com").length, 1);
  assert.equal(cands[0].why, "PUBLIC_APP_URL");
  assert.ok(cands.every((c) => typeof c.why === "string" && c.why.length > 0));
});

// --- Is the thing that answered actually the player app? ---------------------
// "Something served HTTP 200" is not the question. Pointed at the API or the
// admin site, `page.goto` gets a perfectly good response and every game then
// fails on a missing canvas — errors that are NOT net::ERR_*, so they slip past
// the run's fail-fast and burn ~15s per game. These use a local stub server, so
// no real browser or outbound network is involved.

/** A throwaway HTTP server; returns its origin and a close(). */
async function stub(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

const PLAYER_HTML =
  '<!doctype html><html><head><link rel="manifest" href="/api/manifest.webmanifest" />' +
  "<script>localStorage.getItem('ffc-skin')</script></head><body><div id=\"root\"></div></body></html>";
const ADMIN_HTML = '<!doctype html><html><head><title>Master Control — FFC</title></head>' +
  '<body><div id="root"></div></body></html>';

test("the player app is accepted", async () => {
  const s = await stub((req, res) => {
    assert.equal(req.url, "/arcade/skeeball"); // a real player route, not /
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PLAYER_HTML);
  });
  process.env.FFC_APP_BASE = s.base;
  resetAppBaseStatus();
  const r = await appBaseStatus([]);
  assert.equal(r.reachable, true);
  assert.equal(r.base, s.base);
  await s.close();
});

test("the API is rejected — a JSON 404 is not the player app", async () => {
  const s = await stub((req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });
  process.env.FFC_APP_BASE = s.base;
  resetAppBaseStatus();
  const r = await appBaseStatus([]);
  assert.equal(r.reachable, false);
  assert.match(r.reason, /isn't the player app/);
  await s.close();
});

test("the ADMIN app is rejected even though it answers 200", async () => {
  // The sharpest case: same shape, same status, same #root div — only the
  // player-specific markers tell them apart.
  const s = await stub((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(ADMIN_HTML);
  });
  process.env.FFC_APP_BASE = s.base;
  resetAppBaseStatus();
  const r = await appBaseStatus([]);
  assert.equal(r.reachable, false);
  assert.equal(r.tried[0].detail, "not the player app");
  await s.close();
});

test("a redirect to the app is a pass", async () => {
  const app = await stub((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PLAYER_HTML);
  });
  const front = await stub((req, res) => {
    res.writeHead(301, { location: app.base + req.url });
    res.end();
  });
  process.env.FFC_APP_BASE = front.base;
  resetAppBaseStatus();
  const r = await appBaseStatus([]);
  assert.equal(r.reachable, true);
  await front.close();
  await app.close();
});

test("nothing answering reads differently from the wrong thing answering", async () => {
  // Port 1 is not listening; the distinction matters because the fixes differ.
  process.env.FFC_APP_BASE = "http://127.0.0.1:1";
  resetAppBaseStatus();
  const r = await appBaseStatus([]);
  assert.equal(r.reachable, false);
  assert.match(r.reason, /no player app is answering/);
  assert.doesNotMatch(r.reason, /isn't the player app/);
});
