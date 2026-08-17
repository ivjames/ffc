// Admin: launch signups captured by the marketing landing page
// (routes/launchSignup.js writes them).
//   GET /api/admin/launch-signups             list, newest first
//   GET /api/admin/launch-signups/export.csv  same rows as a spreadsheet
//
// super_admin only — the landing page is the apex marketing site, not any
// org's venue, so there is no org to scope a signup to and nothing here for
// an org_admin. The CSV is the handoff into whatever mailing tool eventually
// sends the launch note; this app itself never mails these addresses.
import { Router } from "express";
import { pool } from "../../db.js";
import { isSuperAdmin } from "../../lib/adminAuth.js";
import { csvField, csvLine } from "./export.js";

export const router = Router();

router.use((req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "super_admin only" });
  }
  next();
});

const SIGNUP_COLS = `id, email, consent, source,
                     created_at as "createdAt", updated_at as "updatedAt"`;

router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `select ${SIGNUP_COLS} from launch_signup order by created_at desc`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/launch-signups] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.get("/export.csv", async (_req, res) => {
  try {
    const result = await pool.query(
      `select email, consent, source, created_at, updated_at
         from launch_signup order by created_at desc`
    );
    const lines = [csvLine(["email", "consent", "source", "created_at", "updated_at"])];
    for (const r of result.rows) {
      lines.push(
        csvLine([
          r.email,
          r.consent,
          r.source,
          r.created_at.toISOString(),
          r.updated_at.toISOString(),
        ])
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="launch-signups_${today}.csv"`);
    return res.send(lines.join("\r\n") + "\r\n");
  } catch (err) {
    console.error("[admin/launch-signups] export error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
