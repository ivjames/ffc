// Master Control login. Two routers: `publicRouter` (just /login — must be
// reachable before the requireAdminAuth gate) and `sessionRouter` (/logout,
// /me — mounted after the gate, so req.adminUser is already set).
import { Router } from "express";
import { pool } from "../../db.js";
import { verifyPassword, verifyDummyPassword } from "../../lib/adminPasswords.js";
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
