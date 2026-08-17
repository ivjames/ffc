// Pre-auth set-password endpoints for admin_user — the delivery end of
// lib/adminPasswordTokens.js. One flow serves both invited accounts (NULL
// password_hash, no password yet) and forgot-password for active ones:
//
//   POST /api/admin/password/forgot       {email}            -> {ok:true} (always)
//   POST /api/admin/password/token-check  {token}            -> {ok, email} | 410
//   POST /api/admin/password/set          {token, password}  -> {ok, user} + session cookie
//
// All three are mounted BEFORE requireAdminAuth — a user setting their first
// password has no credential yet by definition. `set` auto-logs the user in
// (same response shape + cookie as POST /login) so the click lands them
// straight in the console.
import { Router } from "express";
import { pool } from "../../db.js";
import { EMAIL_RE } from "../../lib/validateUser.js";
import { hashPassword } from "../../lib/adminPasswords.js";
import { createSession, serializeSessionCookie } from "../../lib/adminSession.js";
import { audit } from "../../lib/adminAuth.js";
import { makeRateLimit } from "../../lib/rateLimit.js";
import {
  checkPasswordToken,
  consumePasswordToken,
  sendSetPasswordEmail,
} from "../../lib/adminPasswordTokens.js";

export const publicRouter = Router();

const isProd = () => process.env.NODE_ENV === "production";

// Same abuse posture as the player request-code triple (routes/auth.js):
// email sends are the costly surface (3 per address / 15 min + 10 per IP /
// hour); token guesses are cheap but the token space is unguessable — the
// per-IP limit just keeps scripts polite.
const forgotEmailLimit = makeRateLimit({
  windowMs: 15 * 60_000,
  max: 3,
  keyFn: (req) => {
    const email = req.body?.email;
    return typeof email === "string" ? email.trim().toLowerCase() || null : null;
  },
  name: "password reset limit",
});
const forgotIpLimit = makeRateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  name: "password reset limit",
});
const tokenLimit = makeRateLimit({ windowMs: 60_000, max: 10, name: "set-password limit" });

export function resetPasswordRateLimits() {
  forgotEmailLimit.reset();
  forgotIpLimit.reset();
  tokenLimit.reset();
}

publicRouter.post("/password/forgot", forgotIpLimit, forgotEmailLimit, async (req, res) => {
  const raw = req.body?.email;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: "email must be a valid address" });
  }
  try {
    // Case-insensitive lookup: admin_user.email is exact-case unique and login
    // matches exactly, but a person typing their own address into "forgot"
    // shouldn't miss over capitalization — we mail the STORED address either way.
    const result = await pool.query(
      `select id, email, password_hash is null as "pending"
         from admin_user where lower(email) = $1`,
      [email]
    );
    const user = result.rows[0];
    if (user) {
      // A still-pending account gets its invite again (7-day link), not a
      // 2-hour reset — "forgot" doubles as "re-send my invite".
      await sendSetPasswordEmail({
        req,
        email: user.email,
        adminUserId: user.id,
        kind: user.pending ? "invite" : "reset",
      });
    }
    // Uniform response whether or not the address has an account — same
    // non-enumeration stance as routes/auth.js request-code and the admin
    // login's identical 401. A mailer failure isn't surfaced either (that too
    // would leak; the client can only say "check your inbox" regardless).
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/password] forgot error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

publicRouter.post("/password/token-check", tokenLimit, async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ ok: false, error: "invalid token" });
  }
  try {
    const check = await checkPasswordToken(token);
    if (!check) return res.status(410).json({ ok: false, error: "link expired or already used" });
    return res.json({ ok: true, email: check.email });
  } catch (err) {
    console.error("[admin/password] token-check error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

publicRouter.post("/password/set", tokenLimit, async (req, res) => {
  const { token, password } = req.body ?? {};
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ ok: false, error: "invalid token" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ ok: false, error: "password must be at least 8 characters" });
  }
  try {
    // Hash BEFORE consuming: scrypt is deliberately slow (sync), and the token
    // must not sit consumed-but-unapplied while we grind — consume-then-fail
    // would burn the user's only link.
    const passwordHash = hashPassword(password);
    const consumed = await consumePasswordToken(token);
    if (!consumed) return res.status(410).json({ ok: false, error: "link expired or already used" });
    const updated = await pool.query(
      `update admin_user set password_hash = $2
        where id = $1 returning id, email, role, org_id as "orgId"`,
      [consumed.adminUserId, passwordHash]
    );
    // The account was deleted between mint and click (cascade should have
    // taken the token with it, but belt-and-braces) — same dead-link answer.
    if (updated.rowCount === 0) {
      return res.status(410).json({ ok: false, error: "link expired or already used" });
    }
    const user = updated.rows[0];
    await audit({
      action: "user.password_set",
      entity: "admin_user",
      entityId: user.id,
      detail: { kind: consumed.kind }, // never the password or hash
      actor: user.email,
    });
    // Auto-login: same shape + cookie as POST /login, so the SPA can treat a
    // successful set exactly like a successful sign-in.
    const { token: sessionToken } = await createSession(user.id);
    res.set("Set-Cookie", serializeSessionCookie(sessionToken, { secure: isProd() }));
    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, role: user.role, orgId: user.orgId },
    });
  } catch (err) {
    console.error("[admin/password] set error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
