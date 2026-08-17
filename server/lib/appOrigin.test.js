// Unit coverage for emailed-link origins (lib/appOrigin.js).
//
// Two failure modes this guards, both of which shipped before it existed:
//   1. A magic link pointing at the wrong venue's host — the session cookie is
//      host-only, so the player signs in somewhere they weren't and stays
//      signed out where they were.
//   2. Host-header injection — trusting the Host header to build a link turns
//      "email me a sign-in link" into a phishing generator. The allow-list IS
//      the boundary, so it is tested directly.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appOrigin, isAllowedHost, safeNextPath, escapeHtml } from "./appOrigin.js";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.PUBLIC_APP_URL = "https://bullwinkles.ffc.example";
  process.env.PLATFORM_FQDN = "ffc.example";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** Minimal Express-request stand-in. */
const req = (host, { proto = "https" } = {}) => ({
  hostname: host,
  protocol: proto,
  get: (h) => (h.toLowerCase() === "host" ? host : undefined),
});

test("a venue subdomain builds a link to ITS OWN host", () => {
  // The bug this exists for: tukwila's player must not be mailed a
  // bullwinkles link, because the cookie the link sets is host-only.
  assert.equal(appOrigin(req("tukwila.ffc.example")), "https://tukwila.ffc.example");
  assert.equal(appOrigin(req("bullwinkles.ffc.example")), "https://bullwinkles.ffc.example");
});

test("the platform apex and www are allowed", () => {
  assert.equal(appOrigin(req("ffc.example")), "https://ffc.example");
  assert.equal(appOrigin(req("www.ffc.example")), "https://www.ffc.example");
});

test("an unrecognised Host falls back to PUBLIC_APP_URL, never itself", () => {
  // Host-header injection: an attacker POSTs request-code with
  // `Host: evil.example` hoping OUR mail server delivers a link there.
  assert.equal(appOrigin(req("evil.example")), "https://bullwinkles.ffc.example");
  assert.equal(appOrigin(req("ffc.example.evil.com")), "https://bullwinkles.ffc.example");
  // A near-miss that shares a suffix without the dot boundary.
  assert.equal(appOrigin(req("notffc.example")), "https://bullwinkles.ffc.example");
  assert.equal(appOrigin(req("")), "https://bullwinkles.ffc.example");
});

test("with no PLATFORM_FQDN only the configured host is allowed", () => {
  // Single-tenant deploys must not accidentally widen the allow-list.
  delete process.env.PLATFORM_FQDN;
  assert.equal(isAllowedHost("bullwinkles.ffc.example"), true);
  assert.equal(isAllowedHost("tukwila.ffc.example"), false);
  assert.equal(appOrigin(req("tukwila.ffc.example")), "https://bullwinkles.ffc.example");
});

test("host matching is case-insensitive and ignores the port", () => {
  assert.equal(isAllowedHost("TUKWILA.FFC.EXAMPLE"), true);
  assert.equal(isAllowedHost("tukwila.ffc.example:8443"), true);
});

test("a dev port is preserved, a default port is not", () => {
  process.env.PUBLIC_APP_URL = "http://localhost:5173";
  delete process.env.PLATFORM_FQDN;
  const dev = { hostname: "localhost", protocol: "http", get: () => "localhost:5173" };
  assert.equal(appOrigin(dev), "http://localhost:5173");

  const std = { hostname: "localhost", protocol: "http", get: () => "localhost:80" };
  assert.equal(appOrigin(std), "http://localhost");
});

test("safeNextPath allows in-app paths and rejects everything else", () => {
  assert.equal(safeNextPath("/me/rewards"), "/me/rewards");
  assert.equal(safeNextPath("/arcade/scores?period=day"), "/arcade/scores?period=day");

  // A full URL, or a protocol-relative one, would bounce the player off-site
  // straight after we signed them in — an open redirect with a fresh session.
  assert.equal(safeNextPath("https://evil.example"), null);
  assert.equal(safeNextPath("//evil.example"), null);
  assert.equal(safeNextPath("\\\\evil.example"), null);
  assert.equal(safeNextPath("me/rewards"), null);
  assert.equal(safeNextPath(""), null);
  assert.equal(safeNextPath(undefined), null);
  assert.equal(safeNextPath("/" + "a".repeat(400)), null);
});

test("escapeHtml neutralises markup in email bodies", () => {
  // A display name lands in the team-invite HTML verbatim, so none of the
  // characters that could open a tag or break out of an attribute may survive.
  // (& is excluded from this loop on purpose: its escape is itself "&#38;",
  // so "does the output still contain &" is not the right question for it.)
  for (const ch of ["<", ">", '"', "'"]) {
    assert.ok(!escapeHtml(`x${ch}y`).includes(ch), `${ch} must be escaped`);
  }
  assert.equal(escapeHtml("Tom & Jerry"), "Tom &#38; Jerry");
  assert.equal(escapeHtml("<b>hi</b>"), "&#60;b&#62;hi&#60;/b&#62;");
  assert.equal(escapeHtml("plain name"), "plain name", "ordinary text is untouched");
});
