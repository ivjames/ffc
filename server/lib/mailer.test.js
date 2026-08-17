import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDailyCap,
  maskRecipient,
  mailConfigWarnings,
  mailFromDomain,
  resolveSendingDomains,
} from "./mailer.js";

test("blank/unset/garbage MAIL_DAILY_CAP falls back to the default", () => {
  // .env.example ships `MAIL_DAILY_CAP=` — an empty string must NOT become 0.
  assert.equal(resolveDailyCap(""), 500);
  assert.equal(resolveDailyCap("   "), 500);
  assert.equal(resolveDailyCap(undefined), 500);
  assert.equal(resolveDailyCap(null), 500);
  assert.equal(resolveDailyCap("not-a-number"), 500);
});

test("a real number overrides, and an explicit 0 is the kill switch", () => {
  assert.equal(resolveDailyCap("42"), 42);
  assert.equal(resolveDailyCap("0"), 0);
});

test("maskRecipient keeps the first char + domain, never the local part", () => {
  assert.equal(maskRecipient("player@example.com"), "p***@example.com");
  assert.equal(maskRecipient("a@b.co"), "a***@b.co");
  assert.equal(maskRecipient("@weird"), "***"); // nothing safe to keep
  assert.equal(maskRecipient(""), "***");
  assert.equal(maskRecipient(null), "***");
});

// --- Startup preflight ------------------------------------------------------
// Every case below is a configuration that LOOKS wired up and delivers nothing,
// which is the whole reason the preflight exists.

const MAIL_ENV_KEYS = [
  "NODE_ENV",
  "MAIL_PROVIDER",
  "MAIL_FROM",
  "MAIL_SENDING_DOMAINS",
  "RESEND_API_KEY",
  "SMTP_URL",
  "PLATFORM_FQDN",
  "PUBLIC_APP_URL",
];

/** Run `fn` with exactly `env` set for the mail vars (everything else cleared),
 *  then restore. The preflight reads process.env, so isolation has to be
 *  explicit — a leaked RESEND_API_KEY would silently mute a test. */
function withEnv(env, fn) {
  const saved = Object.fromEntries(MAIL_ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of MAIL_ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const codes = (env, ctx) => withEnv(env, () => mailConfigWarnings(ctx).map((w) => w.code));

test("mailFromDomain reads both MAIL_FROM shapes, and rejects non-addresses", () => {
  assert.equal(mailFromDomain("FFC <noreply@ffc.example>"), "ffc.example");
  assert.equal(mailFromDomain("noreply@FFC.Example"), "ffc.example");
  assert.equal(mailFromDomain("no-at-sign"), null);
  assert.equal(mailFromDomain("@nolocalpart.example"), null);
  assert.equal(mailFromDomain("trailing@"), null);
});

test("sending domains come from MAIL_SENDING_DOMAINS, else the platform's own hosts", () => {
  assert.deepEqual(
    withEnv({ MAIL_SENDING_DOMAINS: " a.example , b.example ", PLATFORM_FQDN: "c.example" }, () =>
      resolveSendingDomains()
    ),
    ["a.example", "b.example"]
  );
  assert.deepEqual(
    withEnv({ PLATFORM_FQDN: "ffc.example", PUBLIC_APP_URL: "https://venue.ffc.example" }, () =>
      resolveSendingDomains()
    ),
    ["ffc.example", "venue.ffc.example"]
  );
  // localhost is not a sending domain anyone verifies — it would only ever
  // produce a false mismatch warning in dev.
  assert.deepEqual(
    withEnv({ PUBLIC_APP_URL: "http://localhost:5173" }, () => resolveSendingDomains()),
    []
  );
  assert.deepEqual(withEnv({}, () => resolveSendingDomains()), []);
});

test("a clean production resend config produces no warnings", () => {
  assert.deepEqual(
    codes({
      NODE_ENV: "production",
      MAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_live_key",
      MAIL_FROM: "FFC <noreply@ffc.example>",
      PLATFORM_FQDN: "ffc.example",
    }, { liveOrgCount: 4 }),
    []
  );
});

test("console provider in production is called out; in dev it is the normal case", () => {
  assert.deepEqual(codes({ NODE_ENV: "production" }, {}), ["console_in_production"]);
  assert.deepEqual(codes({}, {}), []);
});

test("a provider with no credential is the silent failure the preflight names", () => {
  assert.deepEqual(
    codes({ MAIL_PROVIDER: "resend", MAIL_FROM: "FFC <no@ffc.example>", PLATFORM_FQDN: "ffc.example" }, {}),
    ["resend_key_missing"]
  );
  assert.deepEqual(
    codes({ MAIL_PROVIDER: "smtp", MAIL_FROM: "FFC <no@ffc.example>", PLATFORM_FQDN: "ffc.example" }, {}),
    ["smtp_url_missing"]
  );
});

test("MAIL_FROM is checked only once something actually delivers", () => {
  // On console the noreply@localhost default is correct, so no from-warnings.
  assert.deepEqual(codes({ PLATFORM_FQDN: "ffc.example" }, {}), []);
  assert.deepEqual(
    codes({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", PLATFORM_FQDN: "ffc.example" }, {}),
    ["mail_from_default"]
  );
  assert.deepEqual(
    codes({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", MAIL_FROM: "FFC mail" }, {}),
    ["mail_from_unparseable"]
  );
});

test("a MAIL_FROM off the verified domain is flagged; a subdomain of it is not", () => {
  const base = { MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", PLATFORM_FQDN: "ffc.example" };
  assert.deepEqual(
    codes({ ...base, MAIL_FROM: "FFC <noreply@some-other.example>" }, {}),
    ["mail_from_domain_mismatch"]
  );
  // Verifying ffc.example in Resend also authorises mail.ffc.example.
  assert.deepEqual(codes({ ...base, MAIL_FROM: "FFC <noreply@mail.ffc.example>" }, {}), []);
  // An operator who verified a separate domain says so, and the check yields.
  assert.deepEqual(
    codes(
      { ...base, MAIL_FROM: "FFC <noreply@sendingco.example>", MAIL_SENDING_DOMAINS: "sendingco.example" },
      {}
    ),
    []
  );
  // Nothing to compare against must not manufacture a warning.
  assert.deepEqual(
    codes({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", MAIL_FROM: "FFC <n@anything.example>" }, {}),
    []
  );
});

test("PLATFORM_FQDN unset only matters once more than one org is live", () => {
  const base = { MAIL_PROVIDER: "resend", RESEND_API_KEY: "k", MAIL_FROM: "FFC <n@ffc.example>" };
  assert.deepEqual(codes(base, { liveOrgCount: 3 }), ["platform_fqdn_unset_multi_org"]);
  // Single-tenant: PUBLIC_APP_URL IS the one right origin, so nothing is wrong.
  assert.deepEqual(codes(base, { liveOrgCount: 1 }), []);
  // No count available (no database) — suppress rather than guess.
  assert.deepEqual(codes(base, { liveOrgCount: null }), []);
  assert.deepEqual(codes({ ...base, PLATFORM_FQDN: "ffc.example" }, { liveOrgCount: 9 }), []);
});

test("every warning carries the fix, not just the complaint", () => {
  const all = withEnv({ NODE_ENV: "production", MAIL_PROVIDER: "resend" }, () =>
    mailConfigWarnings({ liveOrgCount: 5 })
  );
  assert.ok(all.length >= 3);
  for (const w of all) {
    assert.match(w.code, /^[a-z_]+$/);
    assert.ok(w.message.length > 20, `message too thin for ${w.code}`);
    assert.ok(w.fix.length > 20, `fix too thin for ${w.code}`);
  }
});
