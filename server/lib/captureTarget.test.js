import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appBaseCandidates } from "./captureTarget.js";

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
