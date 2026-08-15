// Admin: reviewer commentary review surface (Master Control → Feedback) — the
// operator side of routes/feedback.js. Every note filed from inside the app
// lands here, newest first, with the screen it was filed from, the build it
// was filed against, and its screenshot if one came along.
//
// Triage is a two-state flag, not a workflow: 'open' until someone marks it
// 'resolved', and reversible (re-open puts it back). That's deliberate — this
// is a review channel feeding a punchlist, not a ticketing system.
//
//   GET  /api/admin/feedback?limit=&before=&status=   notes, newest first;
//        `before` (a createdAt from a previous page) keyset-paginates older,
//        `status` filters to open|resolved (default: everything)
//   GET  /api/admin/feedback/:id/screenshot           the image bytes
//   POST /api/admin/feedback/:id/status               { status: open|resolved }
//   POST /api/admin/feedback/:id/remove               delete row + screenshot
//
// Org-scoping rides reviewer_feedback.location_id (the venue selected when the
// note was filed): an org_admin sees only their venues' notes, and a note with
// no resolvable venue is super_admin-only — the booth-photo precedent.
import { Router } from "express";
import { rm } from "node:fs/promises";
import { pool } from "../../db.js";
import { audit, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { MEDIA_BY_EXT } from "../../lib/imageTypes.js";

export const router = Router();

const FEEDBACK_FROM = `from reviewer_feedback f
  left join location l on l.id = f.location_id`;

const STATUSES = new Set(["open", "resolved"]);

// --- List -------------------------------------------------------------------
router.get("/", async (req, res) => {
  const scope = orgScope(req);
  let limit = 50;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return res.status(400).json({ ok: false, error: "limit must be 1..500" });
    }
  }
  // Keyset cursor: `before` is the last row's createdAt from the previous page
  // — stable under concurrent filings, unlike an offset.
  let before = null;
  if (req.query.before !== undefined) {
    before = req.query.before;
    if (typeof before !== "string" || Number.isNaN(Date.parse(before))) {
      return res.status(400).json({ ok: false, error: "before must be a timestamp" });
    }
  }
  let status = null;
  if (req.query.status !== undefined && req.query.status !== "") {
    status = req.query.status;
    if (!STATUSES.has(status)) {
      return res.status(400).json({ ok: false, error: "status must be open or resolved" });
    }
  }
  try {
    const result = await pool.query(
      `select f.id, f.body, f.screen_path as "screenPath", f.reviewer,
              f.app_build as "appBuild", f.user_agent as "userAgent",
              f.status, f.created_at as "createdAt",
              f.resolved_at as "resolvedAt", f.resolved_by as "resolvedBy",
              f.screenshot_path is not null as "hasScreenshot",
              l.name as "locationName"
        ${FEEDBACK_FROM}
        where ($1::uuid is null or l.org_id = $1)
          and ($2::timestamptz is null or f.created_at < $2)
          and ($3::text is null or f.status = $3)
        order by f.created_at desc
        limit $4`,
      [scope, before, status, limit]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/feedback] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// Fetch one note within the caller's org scope.
// Resolves to { status, screenshotPath? } — status is the HTTP error to send,
// or 200. Mirrors boothPhotos.js's scopedPhotoPath.
async function scopedFeedback(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return { status: 400 };
  const result = await pool.query(
    `select f.screenshot_path as "screenshotPath", l.org_id as "orgId"
      ${FEEDBACK_FROM} where f.id = $1`,
    [id]
  );
  if (result.rowCount === 0) return { status: 404 };
  const scope = orgScope(req);
  if (scope && result.rows[0].orgId !== scope) return { status: 403 };
  return { status: 200, screenshotPath: result.rows[0].screenshotPath };
}

function sendScopeError(res, status) {
  return res
    .status(status)
    .json({ ok: false, error: status === 403 ? "forbidden: not your org" : "not found" });
}

// --- Screenshot -------------------------------------------------------------
router.get("/:id/screenshot", async (req, res) => {
  try {
    const { status, screenshotPath } = await scopedFeedback(req);
    if (status !== 200) return sendScopeError(res, status);
    if (!screenshotPath) return res.status(404).json({ ok: false, error: "not found" });
    const ext = screenshotPath.split(".").pop();
    res.set("Content-Type", MEDIA_BY_EXT[ext] ?? "application/octet-stream");
    res.set("Cache-Control", "private, max-age=300");
    return res.sendFile(screenshotPath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ ok: false, error: "not found" });
      }
    });
  } catch (err) {
    console.error("[admin/feedback] screenshot error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Triage -----------------------------------------------------------------
// Reversible by design: resolving stamps who/when, re-opening clears both.
router.post("/:id/status", async (req, res) => {
  const next = (req.body ?? {}).status;
  if (!STATUSES.has(next)) {
    return res.status(400).json({ ok: false, error: "status must be open or resolved" });
  }
  try {
    const { status } = await scopedFeedback(req);
    if (status !== 200) return sendScopeError(res, status);
    const actor = actorLabel(req);
    const result = await pool.query(
      `update reviewer_feedback
          set status = $2,
              resolved_at = case when $2 = 'resolved' then now() else null end,
              resolved_by = case when $2 = 'resolved' then $3::text else null end
        where id = $1
        returning id, status, resolved_at as "resolvedAt", resolved_by as "resolvedBy"`,
      [req.params.id, next, actor]
    );
    await audit({
      action: `feedback.${next}`,
      entity: "reviewer_feedback",
      entityId: req.params.id,
      actor,
    });
    return res.json({ ok: true, ...result.rows[0] });
  } catch (err) {
    console.error("[admin/feedback] status error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Remove -----------------------------------------------------------------
// A hard delete, like booth photos: a note carries no credit or history worth
// keeping once an operator decides it doesn't belong (a mis-file, a duplicate,
// a screenshot that caught something it shouldn't have).
router.post("/:id/remove", async (req, res) => {
  try {
    const { status, screenshotPath } = await scopedFeedback(req);
    if (status !== 200) return sendScopeError(res, status);
    // File first, then the row (the retention sweep's rule): if the rm throws,
    // the row stays and the operator can just retry.
    if (screenshotPath) await rm(screenshotPath, { force: true });
    await pool.query(`delete from reviewer_feedback where id = $1`, [req.params.id]);
    await audit({
      action: "feedback.remove",
      entity: "reviewer_feedback",
      entityId: req.params.id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/feedback] remove error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
