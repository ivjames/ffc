// Outbound email, provider-pluggable via MAIL_PROVIDER:
//   console (default) — log the full message to stdout instead of sending.
//                       The dev workflow: the OTP code appears in the server log.
//   resend            — POST https://api.resend.com/emails with RESEND_API_KEY.
//                       Raw fetch, no SDK (this repo avoids dependencies it can
//                       replace with ten lines).
//   smtp              — nodemailer over SMTP_URL. nodemailer is NOT a package
//                       dependency; `npm i nodemailer` only if an operator
//                       actually picks this provider (import is lazy).
// Every send is metered into mail_send, and MAIL_DAILY_CAP (default 500) caps
// total sends per rolling 24h — the hunt_scan/HUNT_SCAN_CAP precedent applied
// to email spend. Read per call so it can be tuned live.
import { pool } from "../db.js";

const DEFAULT_DAILY_CAP = 500;

function provider() {
  return process.env.MAIL_PROVIDER || "console";
}

/** True when a real delivery provider is configured. While this is false the
 *  auth flow runs in BYPASS mode: request-code hands the sign-in code back in
 *  its response so the app can sign in without an inbox (routes/auth.js) —
 *  the stopgap until Resend/SMTP is wired up. Read per call so flipping
 *  MAIL_PROVIDER retires the bypass without a restart. */
export function isMailDeliveryConfigured() {
  return provider() !== "console";
}

export function mailFrom() {
  return process.env.MAIL_FROM || "FFC <noreply@localhost>";
}

/** Log a startup warning when production is about to log OTPs to stdout. */
export function warnIfConsoleMailer() {
  if (process.env.NODE_ENV === "production" && provider() === "console") {
    console.warn(
      "[mailer] MAIL_PROVIDER is unset/console in production — sign-in emails are not delivered, codes go to this log, and /api/auth/request-code hands codes straight back to the caller (EMAIL SIGN-IN IS EFFECTIVELY UNVERIFIED until a real provider is set)"
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

async function underDailyCap() {
  const cap = resolveDailyCap();
  const result = await pool.query(
    `select count(*)::int as n from mail_send where created_at > now() - interval '24 hours'`
  );
  return result.rows[0].n < cap;
}

async function meter(recipient, kind) {
  await pool.query(`insert into mail_send (recipient, kind) values ($1, $2)`, [recipient, kind]);
}

async function sendConsole({ to, subject, text }) {
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
 * Send one email. `kind` labels the metering row ('otp' | 'team_invite').
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
export async function sendMail({ to, subject, text, html, kind = "otp" }) {
  if (!(await underDailyCap())) {
    console.warn(`[mailer] daily send cap reached — dropping ${kind} to ${to}`);
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
  if (result.ok) await meter(to, kind).catch((err) => console.error("[mailer] meter error:", err));
  else console.error(`[mailer] send failed (${provider()}):`, result.error);
  return result;
}
