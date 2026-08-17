// Emailed set-password links for admin_user — the ONLY way a password is ever
// set. Two flows share the mechanism: provisioning/user-creation invites an
// admin by email (account starts with a NULL password_hash — no operator ever
// types a password), and "Forgot password" on the sign-in screen re-mails the
// same kind of link. The email carries a 32-byte hex token; only its sha256
// lands in admin_password_token (a leaked DB row reveals nothing clickable —
// the authCodes.js/team_invite stance). Tokens are single-use (used_at set
// atomically on consumption), expire per kind, and a fresh token supersedes
// any outstanding ones for the same user — exactly one live link at a time.
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { sha256 } from "./authCodes.js";
import { isMailDeliveryConfigured, sendMail } from "./mailer.js";

// Interpolated into SQL as interval literals (the teams.js INVITE_TTL
// precedent) — constants, never request input.
export const INVITE_TTL = "7 days";
export const RESET_TTL = "2 hours";

const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * Mint a set-password token for `adminUserId`. Any outstanding tokens for the
 * user are deleted first — re-sending an invite or a reset must kill the old
 * link, not leave two live capabilities in two inboxes.
 * @returns {Promise<string>} the RAW token — emailed, never stored.
 */
export async function createPasswordToken(adminUserId, kind = "invite") {
  const token = randomBytes(32).toString("hex");
  const ttl = kind === "reset" ? RESET_TTL : INVITE_TTL;
  await pool.query(`delete from admin_password_token where admin_user_id = $1`, [adminUserId]);
  await pool.query(
    `insert into admin_password_token (admin_user_id, kind, token_hash, expires_at)
       values ($1, $2, $3, now() + interval '${ttl}')`,
    [adminUserId, kind, sha256(token)]
  );
  return token;
}

/**
 * Atomically consume a token: marks it used and returns its user in one
 * guarded UPDATE, so a raced double-submit can't set the password twice.
 * @returns {Promise<{adminUserId: string, kind: string} | null>}
 */
export async function consumePasswordToken(token) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const result = await pool.query(
    `update admin_password_token set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning admin_user_id as "adminUserId", kind`,
    [sha256(token)]
  );
  return result.rows[0] ?? null;
}

/**
 * Peek at a token WITHOUT consuming it — lets the set-password page greet the
 * user by email and reject a dead link before they type anything.
 * @returns {Promise<{email: string, kind: string} | null>}
 */
export async function checkPasswordToken(token) {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const result = await pool.query(
    `select u.email, t.kind
       from admin_password_token t
       join admin_user u on u.id = t.admin_user_id
      where t.token_hash = $1 and t.used_at is null and t.expires_at > now()`,
    [sha256(token)]
  );
  return result.rows[0] ?? null;
}

/**
 * Base URL of the Master Control SPA for links in mail. Admin traffic arrives
 * on admin.<platform-fqdn> (trust proxy is on, so req.hostname is the original
 * Host) — mirror provision.js's playerUrlFor and derive from the request when
 * we can. Off that host (dev, tests, curl against localhost) fall back to
 * PUBLIC_ADMIN_URL, else the vite admin dev server (the API itself sits on
 * localhost:8060 behind vite's proxy, so its own host is never the right link).
 */
export function adminUrlFor(req) {
  const host = String(req?.hostname || "").toLowerCase();
  const [first, ...rest] = host.split(".");
  if (first === "admin" && rest.length > 0) return `https://${host}`;
  const configured = process.env.PUBLIC_ADMIN_URL;
  if (configured) return configured.replace(/\/$/, "");
  return "http://localhost:5174";
}

/**
 * Mint a token and email its set-password link. Never throws: a mail (or even
 * DB) failure here must not fail the mutation that invited the user — the
 * account exists either way, and "Forgot password" on the sign-in page mints
 * a fresh link. Callers surface `sent` so the operator knows to say so.
 *
 * While no real mail provider is configured (the pre-Resend window), the link
 * is ALSO returned as `inviteLink` so the operator can relay it by hand — in
 * production the console provider withholds mail from the logs, so the
 * response is the only place the link exists. SECURITY: only super_admin-gated
 * call sites (provision, user create) may forward it to the client; the
 * public forgot endpoint must discard it, or guessing an email becomes
 * account takeover. Once a real provider is set, inviteLink is always null.
 * @returns {Promise<{sent: boolean, inviteLink: string | null}>}
 */
export async function sendSetPasswordEmail({ req, email, adminUserId, kind = "invite" }) {
  try {
    const token = await createPasswordToken(adminUserId, kind);
    const link = `${adminUrlFor(req)}/set-password?token=${token}`;
    const invite = kind !== "reset";
    const subject = invite
      ? "You've been invited to Master Control — set your password"
      : "Reset your Master Control password";
    const validity = invite ? "7 days" : "2 hours";
    const text = [
      invite
        ? `You've been invited to Master Control, the FFC admin console.`
        : `A password reset was requested for your Master Control account.`,
      ``,
      invite ? `Open this link to set your password and sign in:` : `Open this link to choose a new password:`,
      link,
      ``,
      `The link is valid for ${validity} and can be used once. If you weren't expecting it, ignore this email.`,
    ].join("\n");
    const html = [
      invite
        ? `<p>You've been invited to <b>Master Control</b>, the FFC admin console.</p>`
        : `<p>A password reset was requested for your <b>Master Control</b> account.</p>`,
      `<p><a href="${link}">${invite ? "Set your password" : "Choose a new password"}</a></p>`,
      `<p>The link is valid for ${validity} and can be used once. If you weren't expecting it, ignore this email.</p>`,
    ].join("\n");
    const result = await sendMail({ to: email, subject, text, html, kind: "admin_password" });
    return { sent: result.ok, inviteLink: isMailDeliveryConfigured() ? null : link };
  } catch (err) {
    console.error("[adminPasswordTokens] send failed:", err);
    return { sent: false, inviteLink: null };
  }
}
