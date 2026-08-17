// Admin: orgs (owner/franchise level).
//   GET    /api/admin/orgs                list orgs (+ live location counts)
//   POST   /api/admin/orgs               create/update (upsert on id, else slug)
//   GET    /api/admin/orgs/:id           one org + its locations
//   PATCH  /api/admin/orgs/:id/branding  replace the white-label branding object
//   POST   /api/admin/orgs/:id/branding/assets  upload a logo/icon file (base64)
//   POST   /api/admin/orgs/:id/archive   soft-delete (set archived_at)
//   POST   /api/admin/orgs/:id/unarchive restore
//
// Org-scoping: an org is the top-level tenant boundary, so managing orgs
// themselves (create/rename/archive) is super_admin only. An org_admin can
// only read their OWN org (GET list/one) — never another org's, never all of
// them. Branding is the one org-level WRITE an org_admin gets (own org only):
// it's cosmetic, with no tenancy consequences.
import { Router } from "express";
import express from "express";
import { pool } from "../../db.js";
import { audit, isSuperAdmin, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE, LOCATION_RETURN_COLS, withLabel } from "../../lib/validateLocation.js";
import { normalizeBranding } from "../../lib/branding.js";
import { normalizeOrg, ORG_COLS } from "../../lib/validateOrg.js";
import {
  BRAND_ASSET_KINDS,
  validateBrandAsset,
  storeBrandAsset,
} from "../../lib/brandAssets.js";

export const router = Router();

// --- List -------------------------------------------------------------------
router.get("/", async (req, res) => {
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  const scope = orgScope(req); // null (super_admin) or the org_admin's own org id
  try {
    const result = await pool.query(
      `select o.id, o.name, o.slug, o.status, o.sort_order as "sortOrder",
              o.branding, o.archived_at as "archivedAt",
              count(l.id) filter (where l.archived_at is null) as "locationCount"
         from org o
         left join location l on l.org_id = o.id
        where ($1::bool or o.archived_at is null)
          and ($2::uuid is null or o.id = $2)
        group by o.id
        order by o.sort_order, o.name`,
      [includeArchived, scope]
    );
    return res.json(result.rows.map((r) => ({ ...r, locationCount: Number(r.locationCount) })));
  } catch (err) {
    console.error("[admin/orgs] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- One org + its locations ------------------------------------------------
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  const scope = orgScope(req);
  if (scope && id !== scope) {
    return res.status(403).json({ ok: false, error: "forbidden: not your org" });
  }
  try {
    const org = await pool.query(`select ${ORG_COLS} from org where id = $1`, [id]);
    if (org.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    const locs = await pool.query(
      `select ${LOCATION_RETURN_COLS} from location
        where org_id = $1 and archived_at is null
        order by sort_order, name`,
      [id]
    );
    return res.json({ org: org.rows[0], locations: locs.rows.map(withLabel) });
  } catch (err) {
    console.error("[admin/orgs] get error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Create / update --------------------------------------------------------
router.post("/", async (req, res) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "super_admin only" });
  }
  const result = normalizeOrg(req.body);
  if (result.error) return res.status(result.status).json({ ok: false, error: result.error });
  const row = result.row;
  try {
    let db;
    if (row.id) {
      db = await pool.query(
        `insert into org (id, name, slug, sort_order, branding)
           values ($1, $2, $3, $4, coalesce($5::jsonb, '{}'::jsonb))
         on conflict (id) do update set
           name = excluded.name, slug = excluded.slug, sort_order = excluded.sort_order,
           branding = coalesce($5::jsonb, org.branding)
         returning ${ORG_COLS}`,
        [row.id, row.name, row.slug, row.sortOrder, row.branding]
      );
    } else {
      db = await pool.query(
        `insert into org (name, slug, sort_order, branding)
           values ($1, $2, $3, coalesce($4::jsonb, '{}'::jsonb))
         on conflict (slug) do update set
           name = excluded.name, sort_order = excluded.sort_order,
           branding = coalesce($4::jsonb, org.branding)
         returning ${ORG_COLS}`,
        [row.name, row.slug, row.sortOrder, row.branding]
      );
    }
    await audit({
      action: row.id ? "org.update" : "org.create",
      entity: "org",
      entityId: db.rows[0].id,
      detail: row,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, org: db.rows[0] });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "slug already in use by another org" });
    }
    console.error("[admin/orgs] upsert error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Branding (white-label) ---------------------------------------------------
// Body is the FULL branding object — replace, not merge ({} resets to the
// platform defaults). super_admin, or an org_admin on their own org: branding
// is cosmetic, so it doesn't get the create/rename/archive super_admin gate.
router.patch("/:id/branding", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  const scope = orgScope(req);
  if (scope && id !== scope) {
    return res.status(403).json({ ok: false, error: "forbidden: not your org" });
  }
  const result = normalizeBranding(req.body);
  if (result.error) return res.status(result.status).json({ ok: false, error: result.error });
  try {
    const db = await pool.query(
      `update org set branding = $2::jsonb where id = $1 returning ${ORG_COLS}`,
      [id, result.branding]
    );
    if (db.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    await audit({
      action: "org.branding",
      entity: "org",
      entityId: id,
      detail: result.branding,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, org: db.rows[0] });
  } catch (err) {
    console.error("[admin/orgs] branding error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Branding asset upload ----------------------------------------------------
// Body: { kind, filename?, data } with `data` base64 (the repo's established
// way to ship image bytes through JSON — see /api/hunt/verify and the booth
// endpoints; no multer). Same permission rule as the branding PATCH:
// super_admin, or an org_admin on their OWN org. Stores the validated file
// under BRAND_ASSET_DIR/<orgId>/ and returns { ok, url } — it does NOT modify
// org.branding: the admin form fills the matching URL field with the returned
// value, and Save keeps the PATCH's full-replace semantics.
//
// Own parser: 1 MiB of file is ~1.4 MB of base64, past app.js's 256kb global
// cap (app.js skips this path). 3mb keeps "file is too large" ours, not a 413,
// for anything near the cap; grossly oversized payloads still 413 at the parser.
router.post("/:id/branding/assets", express.json({ limit: "3mb" }), async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  const scope = orgScope(req);
  if (scope && id !== scope) {
    return res.status(403).json({ ok: false, error: "forbidden: not your org" });
  }
  const body = req.body ?? {};
  const { kind, filename, data } = body;
  if (typeof kind !== "string" || !BRAND_ASSET_KINDS.has(kind)) {
    return res.status(400).json({
      ok: false,
      error: "kind must be one of logo, logoBadge, logoWordmark, icon192, icon512",
    });
  }
  // filename is informational only (audit trail) — the stored name derives
  // from kind + content hash + the SNIFFED type, never from what was claimed.
  if (filename !== undefined && (typeof filename !== "string" || filename.length > 200)) {
    return res.status(400).json({ ok: false, error: "filename must be a string (max 200 chars)" });
  }
  // Buffer.from(.., "base64") silently skips junk characters, so check the
  // alphabet first — otherwise corrupt input decodes to garbage bytes and the
  // operator gets a confusing "unsupported file type" instead of the truth.
  if (typeof data !== "string" || data.length === 0) {
    return res.status(400).json({ ok: false, error: "data (base64 file content) is required" });
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return res.status(400).json({ ok: false, error: "data is not valid base64" });
  }
  const bytes = Buffer.from(data, "base64");
  const check = validateBrandAsset(kind, bytes);
  if (check.error) return res.status(check.status).json({ ok: false, error: check.error });
  try {
    const org = await pool.query(`select id, branding from org where id = $1`, [id]);
    if (org.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    // The row's CURRENT branding tells storeBrandAsset which stored files are
    // still referenced — it prunes superseded ones and enforces the per-org
    // byte budget, 400ing when the org is over it.
    const stored = await storeBrandAsset(id, kind, bytes, check.ext, org.rows[0].branding);
    if (stored.error) return res.status(stored.status).json({ ok: false, error: stored.error });
    const { url } = stored;
    await audit({
      action: "org.branding_asset",
      entity: "org",
      entityId: id,
      detail: { kind, filename: filename ?? null, url, bytes: bytes.length },
      actor: actorLabel(req),
    });
    return res.json({ ok: true, url });
  } catch (err) {
    console.error("[admin/orgs] branding asset error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Archive / unarchive ----------------------------------------------------
async function setArchived(req, res, archived) {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "super_admin only" });
  }
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  try {
    const db = await pool.query(
      `update org set archived_at = ${archived ? "now()" : "null"} where id = $1 returning ${ORG_COLS}`,
      [id]
    );
    if (db.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    await audit({
      action: archived ? "org.archive" : "org.unarchive",
      entity: "org",
      entityId: id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, org: db.rows[0] });
  } catch (err) {
    console.error("[admin/orgs] archive error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
}
router.post("/:id/archive", (req, res) => setArchived(req, res, true));
router.post("/:id/unarchive", (req, res) => setArchived(req, res, false));
