// Admin: admin_user accounts. super_admin only — user management isn't
// something an org_admin can do to themselves or anyone else.
//   GET    /api/admin/users            list (never returns password_hash)
//   POST   /api/admin/users           create (password optional — omitted = emailed set-password invite)
//   PATCH  /api/admin/users/:id       edit email/role/orgId, optionally reset password
//   DELETE /api/admin/users/:id       remove (hard delete — no domain history hangs off an account)
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, isSuperAdmin, actorLabel } from "../../lib/adminAuth.js";
import { hashPassword } from "../../lib/adminPasswords.js";
import { sendSetPasswordEmail } from "../../lib/adminPasswordTokens.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { EMAIL_RE } from "../../lib/validateUser.js";

export const router = Router();

const USER_COLS = `id, email, role, org_id as "orgId", created_at as "createdAt"`;

function normalizeUserInput(body, { requirePassword }) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be an object" };
  }
  const { email, password, role, orgId } = body;
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return { error: "email must be a valid address" };
  }
  if (requirePassword && (typeof password !== "string" || password.length < 8)) {
    return { error: "password is required (at least 8 characters)" };
  }
  if (
    password !== undefined &&
    password !== null &&
    (typeof password !== "string" || password.length < 8)
  ) {
    return { error: "password must be at least 8 characters" };
  }
  const resolvedRole = role ?? "org_admin";
  if (resolvedRole !== "super_admin" && resolvedRole !== "org_admin") {
    return { error: "role must be super_admin or org_admin" };
  }
  if (orgId !== undefined && orgId !== null && (typeof orgId !== "string" || !UUID_RE.test(orgId))) {
    return { error: "orgId must be a uuid when provided" };
  }
  const resolvedOrgId = orgId ?? null;
  if (resolvedRole === "org_admin" && !resolvedOrgId) {
    return { error: "orgId is required for an org_admin" };
  }
  return {
    row: {
      email,
      password: password || null,
      role: resolvedRole,
      orgId: resolvedOrgId,
    },
  };
}

router.use((req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "super_admin only" });
  }
  next();
});

router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`select ${USER_COLS} from admin_user order by email`);
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/users] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.post("/", async (req, res) => {
  // Password optional: the normal path is to OMIT it and let the invitee set
  // their own via the emailed link (no operator ever knows it). Passing one
  // still works for scripted/bootstrap setups.
  const result = normalizeUserInput(req.body, { requirePassword: false });
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  const { password, role, orgId } = result.row;
  // Lowercase on create only — PATCH merges the stored row back through
  // normalizeUserInput, and rewriting existing spellings there would silently
  // rename accounts (login matches email exactly).
  const email = result.row.email.trim().toLowerCase();
  try {
    // Invited accounts start with a NULL password_hash — they can't log in
    // until they follow the set-password link.
    const db = password
      ? await pool.query(
          `insert into admin_user (email, role, org_id, password_hash)
             values ($1, $2, $3, $4) returning ${USER_COLS}`,
          [email, role, orgId, hashPassword(password)]
        )
      : await pool.query(
          `insert into admin_user (email, role, org_id)
             values ($1, $2, $3) returning ${USER_COLS}`,
          [email, role, orgId]
        );
    const user = db.rows[0];
    // Post-insert: a failed send must not lose the created account — the
    // response says `inviteSent: false`, and "Forgot password" re-mails it.
    let inviteSent;
    // Non-null only while no real mail provider is configured: this route is
    // super_admin-gated, so the operator may receive the link to relay by
    // hand (see sendSetPasswordEmail's note).
    let inviteLink = null;
    if (!password) {
      ({ sent: inviteSent, inviteLink } = await sendSetPasswordEmail({
        req,
        email,
        adminUserId: user.id,
        kind: "invite",
      }));
    }
    await audit({
      action: "user.create",
      entity: "admin_user",
      entityId: user.id,
      detail: {
        email,
        role,
        orgId,
        // Boolean only — the audit log must never hold the capability itself.
        ...(password ? {} : { invited: true, inviteSent, inviteLinkReturned: inviteLink !== null }),
      },
      actor: actorLabel(req),
    });
    return password
      ? res.json({ ok: true, user })
      : res.json({ ok: true, user, inviteSent, inviteLink });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "email already in use" });
    }
    console.error("[admin/users] create error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  try {
    const existing = await pool.query(
      `select id, email, role, org_id as "orgId" from admin_user where id = $1`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });

    const merged = { ...existing.rows[0], ...req.body, id };
    const result = normalizeUserInput(merged, { requirePassword: false });
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    const { email, password, role, orgId } = result.row;

    const db = password
      ? await pool.query(
          `update admin_user set email = $2, role = $3, org_id = $4, password_hash = $5
             where id = $1 returning ${USER_COLS}`,
          [id, email, role, orgId, hashPassword(password)]
        )
      : await pool.query(
          `update admin_user set email = $2, role = $3, org_id = $4
             where id = $1 returning ${USER_COLS}`,
          [id, email, role, orgId]
        );
    await audit({
      action: "user.update",
      entity: "admin_user",
      entityId: id,
      detail: { email, role, orgId, passwordChanged: Boolean(password) },
      actor: actorLabel(req),
    });
    return res.json({ ok: true, user: db.rows[0] });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "email already in use" });
    }
    console.error("[admin/users] patch error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  try {
    const db = await pool.query(`delete from admin_user where id = $1 returning id`, [id]);
    if (db.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    await audit({ action: "user.delete", entity: "admin_user", entityId: id, actor: actorLabel(req) });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/users] delete error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
