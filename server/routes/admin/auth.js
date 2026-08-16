// Master Control login. Two routers: `publicRouter` (just /login — must be
// reachable before the requireAdminAuth gate) and `sessionRouter` (/logout,
// /me, /me/password — mounted after the gate, so req.adminUser is already set).
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, actorLabel } from "../../lib/adminAuth.js";
import { verifyPassword, verifyDummyPassword, hashPassword } from "../../lib/adminPasswords.js";
import {
  createSession,
  deleteSession,
  parseCookies,
  serializeSessionCookie,
  clearSessionCookieHeader,
  SESSION_COOKIE_NAME,
} from "../../lib/adminSession.js";

export const publicRouter = Router();
export const sessionRouter = Router();

const isProd = () => process.env.NODE_ENV === "production";

publicRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ ok: false, error: "email and password are required" });
  }
  try {
    const result = await pool.query(
      `select id, email, role, org_id as "orgId", password_hash as "passwordHash"
         from admin_user where email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      verifyDummyPassword(password); // keep timing uniform vs a real user lookup
      return res.status(401).json({ ok: false, error: "invalid email or password" });
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ ok: false, error: "invalid email or password" });
    }
    const { token } = await createSession(user.id);
    res.set("Set-Cookie", serializeSessionCookie(token, { secure: isProd() }));
    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, role: user.role, orgId: user.orgId },
    });
  } catch (err) {
    console.error("[admin/auth] login error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

sessionRouter.post("/logout", async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  try {
    await deleteSession(token);
  } catch (err) {
    console.error("[admin/auth] logout error:", err);
  }
  res.set("Set-Cookie", clearSessionCookieHeader({ secure: isProd() }));
  return res.json({ ok: true });
});

sessionRouter.get("/me", (req, res) => {
  const { id, email, role, orgId, viaToken } = req.adminUser;
  return res.json({ ok: true, user: { id, email, role, orgId, viaToken } });
});

// Self-service password change — any signed-in admin (org_admin included; this
// is /me, not /users, so the super_admin-only user management gate doesn't
// apply). Verifies the CURRENT password before accepting the new one, then
// revokes every OTHER session for the account (a stolen-password attacker gets
// logged out; the session doing the change keeps working).
sessionRouter.post("/me/password", async (req, res) => {
  const { id, viaToken } = req.adminUser;
  if (viaToken || !id) {
    // APP_TOKEN pseudo-auth has no admin_user row — there's no password to change.
    return res
      .status(400)
      .json({ ok: false, error: "APP_TOKEN auth has no account password; log in as an admin user" });
  }
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return res
      .status(400)
      .json({ ok: false, error: "currentPassword and newPassword are required" });
  }
  // Same rule as user create/reset (admin/users.js).
  if (newPassword.length < 8) {
    return res.status(400).json({ ok: false, error: "password must be at least 8 characters" });
  }
  try {
    const result = await pool.query(
      `select password_hash as "passwordHash" from admin_user where id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      // Account deleted out from under a still-live session.
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    if (!verifyPassword(currentPassword, result.rows[0].passwordHash)) {
      return res.status(401).json({ ok: false, error: "current password is incorrect" });
    }
    await pool.query(`update admin_user set password_hash = $2 where id = $1`, [
      id,
      hashPassword(newPassword),
    ]);
    // admin_session.id IS the cookie token (lib/adminSession.js), so "every
    // session but this one" is a keyed delete on the current cookie's value.
    const token = parseCookies(req)[SESSION_COOKIE_NAME];
    const revoked = await pool.query(
      `delete from admin_session where admin_user_id = $1 and id <> $2`,
      [id, token]
    );
    // NO password material in the audit detail — only the revocation count.
    await audit({
      action: "admin.password_change",
      entity: "admin_user",
      entityId: id,
      detail: { otherSessionsRevoked: revoked.rowCount },
      actor: actorLabel(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/auth] password change error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
