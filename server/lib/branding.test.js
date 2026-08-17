import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRANDING_DEFAULTS,
  BRANDING_KEYS,
  normalizeBranding,
  resolveBranding,
} from "./branding.js";

// The platform defaults must be venue-NEUTRAL: no client's name or assets may
// reach a tenant through the merge. Bullwinkle's identity lives in its own org
// branding row (schema.sql seed backfill), not here.

test("BRANDING_DEFAULTS carry no venue identity", () => {
  assert.equal(BRANDING_DEFAULTS.shareFooter, "Come beat this score");
  for (const [key, value] of Object.entries(BRANDING_DEFAULTS)) {
    assert.ok(!/bullwinkle/i.test(value), `${key} leaks the default client's name`);
    assert.ok(!value.startsWith("/brand/"), `${key} leaks the default client's assets`);
  }
});

test("BRANDING_DEFAULTS have NO default logo — the trio is absent, not empty", () => {
  for (const key of ["logoUrl", "logoBadgeUrl", "logoWordmarkUrl"]) {
    assert.ok(!(key in BRANDING_DEFAULTS), `${key} must not have a platform default`);
  }
});

test("BRANDING_DEFAULTS everything else is the stock platform look", () => {
  assert.deepEqual(BRANDING_DEFAULTS, {
    appName: "Mini Golf Scorecard",
    shortName: "MiniGolf",
    themeColor: "#15803d",
    backgroundColor: "#052e16",
    accentColor: "#38bdf8",
    icon192Url: "/icons/icon-192.png",
    icon512Url: "/icons/icon-512.png",
    shareFooter: "Come beat this score",
  });
});

test("BRANDING_KEYS = defaults' keys plus the defaultless logo trio", () => {
  assert.deepEqual(
    [...BRANDING_KEYS].sort(),
    [...Object.keys(BRANDING_DEFAULTS), "logoUrl", "logoBadgeUrl", "logoWordmarkUrl"].sort(),
  );
});

test("resolveBranding({}) — a brand-new org — inherits nothing Bullwinkle", () => {
  const b = resolveBranding({});
  assert.equal(b.shareFooter, "Come beat this score");
  assert.equal(b.logoUrl, undefined);
  assert.equal(b.logoBadgeUrl, undefined);
  assert.equal(b.logoWordmarkUrl, undefined);
  assert.ok(!JSON.stringify(b).match(/bullwinkle|\/brand\//i));
  // The neutral defaults still resolve for everything with a default.
  assert.equal(b.appName, "Mini Golf Scorecard");
  assert.equal(b.themeColor, "#15803d");
});

test("resolveBranding passes an org's explicit logo trio through", () => {
  const b = resolveBranding({
    logoUrl: "/uploads/acme.png",
    logoBadgeUrl: "/uploads/acme-badge.png",
  });
  assert.equal(b.logoUrl, "/uploads/acme.png");
  assert.equal(b.logoBadgeUrl, "/uploads/acme-badge.png");
  assert.equal(b.logoWordmarkUrl, undefined); // unset cut stays absent
});

test("resolveBranding tolerates garbage and still yields the neutral defaults", () => {
  for (const junk of [null, undefined, "nope", 7, ["x"]]) {
    assert.deepEqual(resolveBranding(junk), { ...BRANDING_DEFAULTS });
  }
});

test("normalizeBranding still accepts the logo trio (storable, just defaultless)", () => {
  const res = normalizeBranding({ logoUrl: "/uploads/a.png", shareFooter: "Fore!" });
  assert.deepEqual(res.branding, { logoUrl: "/uploads/a.png", shareFooter: "Fore!" });
});
