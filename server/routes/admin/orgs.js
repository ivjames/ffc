// Admin: orgs (owner/franchise level).
//   GET    /api/admin/orgs                list orgs (+ live location counts)
//   POST   /api/admin/orgs               create/update (upsert on id, else slug)
//   GET    /api/admin/orgs/:id           one org + its locations
//   POST   /api/admin/orgs/:id/archive   soft-delete (set archived_at)
//   POST   /api/admin/orgs/:id/unarchive restore
//
// Org-scoping: an org is the top-level tenant boundary, so managing orgs
// themselves (create/rename/archive) is super_admin only. An org_admin can
// only read their OWN org (GET list/one) — never another org's, never all of
// them.
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, isSuperAdmin, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE, SLUG_RE, LOCATION_RETURN_COLS, withLabel } from "../../lib/validateLocation.js";

export const router = Router();

const ORG_COLS = `id, name, slug, status, sort_order as "sortOrder",
  archived_at as "archivedAt"`;

function normalizeOrg(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be an org object", status: 400 };
  }
  const { id, name, slug } = body;
  if (id !== undefined && (typeof id !== "string" || !UUID_RE.test(id))) {
    return { error: "id must be a uuid when provided", status: 400 };
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    return { error: "name is required (1..200 chars)", status: 400 };
  }
  if (typeof slug !== "string" || slug.length > 64 || !SLUG_RE.test(slug)) {
    return {
      error: "slug must be lowercase [a-z0-9-], no leading/trailing/double hyphen",
      status: 400,
    };
  }
  let sortOrder = 0;
  if (body.sortOrder !== undefined && body.sortOrder !== null) {
    if (!Number.isInteger(body.sortOrder)) {
      return { error: "sortOrder must be an integer", status: 400 };
    }
    sortOrder = body.sortOrder;
  }
  return { row: { id, name: name.trim(), slug, sortOrder } };
}

// --- List -------------------------------------------------------------------
router.get("/", async (req, res) => {
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  const scope = orgScope(req); // null (super_admin) or the org_admin's own org id
  try {
    const result = await pool.query(
      `select o.id, o.name, o.slug, o.status, o.sort_order as "sortOrder",
              o.archived_at as "archivedAt",
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
        `insert into org (id, name, slug, sort_order)
           values ($1, $2, $3, $4)
         on conflict (id) do update set
           name = excluded.name, slug = excluded.slug, sort_order = excluded.sort_order
         returning ${ORG_COLS}`,
        [row.id, row.name, row.slug, row.sortOrder]
      );
    } else {
      db = await pool.query(
        `insert into org (name, slug, sort_order)
           values ($1, $2, $3)
         on conflict (slug) do update set
           name = excluded.name, sort_order = excluded.sort_order
         returning ${ORG_COLS}`,
        [row.name, row.slug, row.sortOrder]
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
