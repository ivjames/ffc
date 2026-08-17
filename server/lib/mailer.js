// Outbound email, provider-pluggable via MAIL_PROVIDER:
//   console (default) — log the full message to stdout instead of sending.
//                       The dev workflow: the OTP code appears in the server log.
//   resend            — POST https://api.resend.com/emails with RESEND_API_KEY.
//                       Raw fetch, no SDK (this repo avoids dependencies it can
//                       replace with ten lines).
//   smtp              — nodemailer over SMTP_URL. nodemailer is NOT a package
//                       dependency; `npm i nodemailer` only if an operator
//                       actually picks this provider (import is lazy).
// Every send is metered into mail_send with the org it was sent on behalf of
// (mail_send.org_slug — resolved tenant, null when there isn't one), and
// MAIL_DAILY_CAP (default 500) caps sends PER ORG per rolling 24h — the
// hunt_scan/HUNT_SCAN_CAP precedent applied to email spend, but attributed so
// one client's busy Saturday can't lock another client's players out of OTP
// sign-in (the null pool counts as its own bucket). MAIL_GLOBAL_DAILY_CAP
// (default 4x MAIL_DAILY_CAP) is the platform-wide backstop across all orgs.
// Both are read per call so they can be tuned live.
//
// Privacy: mail_send exists ONLY to back the rolling-24h cap, so rows older
// than 24h are pruned on every send — the table never becomes a permanent
// registry of every address the system has mailed. And in production the
// console provider redacts its output: recipient addresses and OTP codes must
// never land in a production log (dev keeps the full message — that's the
// whole dev workflow).
import { pool } from "../db.js";

const DEFAULT_DAILY_CAP = 500;

function provider() {
  return process.env.MAIL_PROVIDER || "console";
}

function isProd() {
  return process.env.NODE_ENV === "production";
}

/** 'player@example.com' -> 'p***@example.com' — enough to correlate a support
 *  report against the log without the log holding the address itself. */
export function maskRecipient(to) {
  const s = String(to ?? "");
  const at = s.indexOf("@");
  if (at < 1) return "***";
  return `${s[0]}***${s.slice(at)}`;
}

/** True when a real delivery provider is configured. While this is false the
 *  auth flow runs in BYPASS mode — DEV ONLY, never in production
 *  (routes/auth.js gates it on !isProd()): request-code hands the sign-in
 *  code back in its response so the app can sign in without an inbox — the
 *  stopgap until Resend/SMTP is wired up. Read per call so flipping
 *  MAIL_PROVIDER retires the bypass without a restart. */
export function isMailDeliveryConfigured() {
  return provider() !== "console";
}

export function mailFrom() {
  return process.env.MAIL_FROM || "FFC <noreply@localhost>";
}

/** Log a startup warning when production has no real mail provider. */
export function warnIfConsoleMailer() {
  if (isProd() && provider() === "console") {
    console.warn(
      "[mailer] MAIL_PROVIDER is unset/console in production — sign-in emails are not delivered, and production neither logs codes nor returns them over HTTP (both are dev-only), so EMAIL SIGN-IN IS EFFECTIVELY DISABLED until a real provider is set"
    );
  }
}

/** MAIL_DAILY_CAP with .env.example semantics: blank/unset/garbage means the
 *  default — .env.example ships the var as an empty string, and Number("")
 *  is 0, which would silently kill every send. An explicit "0" IS the kill
 *  switch. */
export function resolveDailyCap(raw = process.env.MAIL_DAILY_CAP) {
  if (raw == null || String(raw).trim() === "") return DEFAULT_DAILY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_DAILY_CAP;
}

/** Platform-wide backstop across every org's pool: MAIL_GLOBAL_DAILY_CAP with
 *  the same blank-means-default semantics; the default is 4x the per-org cap,
 *  so per-org isolation never quadruples total spend unnoticed. An explicit
 *  "0" IS the kill switch. */
export function resolveGlobalDailyCap(raw = process.env.MAIL_GLOBAL_DAILY_CAP) {
  if (raw == null || String(raw).trim() === "") return 4 * resolveDailyCap();
  const n = Number(raw);
  return Number.isFinite(n) ? n : 4 * resolveDailyCap();
}

async function underDailyCap(orgSlug) {
  const cap = resolveDailyCap();
  const globalCap = resolveGlobalDailyCap();
  // One pass: this org's rolling-24h count (null attribution is its own pool —
  // `is not distinct from` makes null match null) plus the platform-wide total.
  const result = await pool.query(
    `select count(*)::int as total,
            count(*) filter (where org_slug is not distinct from $1)::int as org
       from mail_send where created_at > now() - interval '24 hours'`,
    [orgSlug]
  );
  return result.rows[0].org < cap && result.rows[0].total < globalCap;
}

async function meter(recipient, kind, orgSlug) {
  await pool.query(`insert into mail_send (recipient, kind, org_slug) values ($1, $2, $3)`, [
    recipient,
    kind,
    orgSlug,
  ]);
  // The cap only ever reads the last 24h, so older rows are pure liability
  // (a growing log of recipient addresses) — trim them as we go. Best-effort:
  // a failed prune must not fail the send it rode in on.
  await pool
    .query(`delete from mail_send where created_at < now() - interval '24 hours'`)
    .catch((err) => console.error("[mailer] mail_send prune failed:", err));
}

async function sendConsole({ to, subject, text }) {
  if (isProd()) {
    // A production log must hold neither the address nor the code in the body.
    console.log(`[mailer] console provider (production): message to ${maskRecipient(to)} withheld from the log — set a real MAIL_PROVIDER to deliver mail`);
    return { ok: true, id: "console" };
  }
  console.log(`[mailer] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
  return { ok: true, id: "console" };
}

async function sendResend({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: mailFrom(), to: [to], subject, text, html }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, error: `resend ${resp.status}: ${body.slice(0, 200)}` };
  }
  const data = await resp.json().catch(() => ({}));
  return { ok: true, id: data.id };
}

async function sendSmtp({ to, subject, text, html }) {
  const url = process.env.SMTP_URL;
  if (!url) return { ok: false, error: "SMTP_URL is not set" };
  let nodemailer;
  try {
    nodemailer = (await import("nodemailer")).default;
  } catch {
    return { ok: false, error: "nodemailer is not installed (npm i nodemailer in server/)" };
  }
  const transport = nodemailer.createTransport(url);
  const info = await transport.sendMail({ from: mailFrom(), to, subject, text, html });
  return { ok: true, id: info.messageId };
}

/**
 * Send one email. `kind` labels the metering row ('otp' | 'team_invite');
 * `orgSlug` attributes the send to the resolved tenant (null = no tenant —
 * its own pool for cap purposes, never charged to any client).
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function sendMail({ to, subject, text, html, kind = "otp", orgSlug = null }) {
  if (!(await underDailyCap(orgSlug))) {
    console.warn(
      `[mailer] daily send cap reached (org=${orgSlug ?? "none"}) — dropping ${kind} to ${maskRecipient(to)}`
    );
    return { ok: false, error: "daily send cap reached" };
  }
  let result;
  try {
    switch (provider()) {
      case "resend":
        result = await sendResend({ to, subject, text, html });
        break;
      case "smtp":
        result = await sendSmtp({ to, subject, text, html });
        break;
      default:
        result = await sendConsole({ to, subject, text, html });
    }
  } catch (err) {
    result = { ok: false, error: String(err?.message || err) };
  }
  if (result.ok)
    await meter(to, kind, orgSlug).catch((err) => console.error("[mailer] meter error:", err));
  else console.error(`[mailer] send failed (${provider()}):`, result.error);
  return result;
}
