// Admin: announcements / special updates (punchlist #1).
//   GET    /api/admin/announcements?archived=      list (org-scoped)
//   POST   /api/admin/announcements                create/update (upsert on id)
//   POST   /api/admin/announcements/:id/archive    soft-delete
//   POST   /api/admin/announcements/:id/unarchive  restore
//
// Org-scoping: an announcement pinned to a location belongs to that location's
// org — an org_admin manages only those. Global announcements (location_id
// null) show at EVERY venue, so creating/editing/archiving them is
// super_admin only; org_admins still see them in the list (read-only) since
// their venues display them.
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, isSuperAdmin, orgScope, actorLabel } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";

export const router = Router();

// Same column list with and without a table alias — the joined list SELECT
// needs `a.`-prefixed columns, the RETURNING clauses need bare ones.
const cols = (p) => `${p}id, ${p}title, ${p}body, ${p}location_id as "locationId",
  ${p}starts_at as "startsAt", ${p}ends_at as "endsAt",
  ${p}sort_order as "sortOrder", ${p}archived_at as "archivedAt",
  ${p}created_at as "createdAt"`;
const ANNOUNCEMENT_COLS = cols("a.");
const ANNOUNCEMENT_COLS_BARE = cols("");

/** Parse an optional timestamp field: null/undefined -> null, else a valid
 *  ISO/date string -> Date. Returns { error } on garbage. */
function parseWhen(value, field) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${field} must be an ISO timestamp string` };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: `${field} is not a valid timestamp` };
  return { value: d };
}

function normalizeAnnouncement(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be an announcement object", status: 400 };
  }
  const { id, title, locationId } = body;
  if (id !== undefined && (typeof id !== "string" || !UUID_RE.test(id))) {
    return { error: "id must be a uuid when provided", status: 400 };
  }
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 200) {
    return { error: "title is required (1..200 chars)", status: 400 };
  }
  let text = null;
  if (body.body !== undefined && body.body !== null && body.body !== "") {
    if (typeof body.body !== "string" || body.body.length > 2000) {
      return { error: "body must be a string (max 2000 chars)", status: 400 };
    }
    text = body.body;
  }
  if (
    locationId !== undefined &&
    locationId !== null &&
    (typeof locationId !== "string" || !UUID_RE.test(locationId))
  ) {
    return { error: "locationId must be a uuid or null", status: 400 };
  }
  const startsAt = parseWhen(body.startsAt, "startsAt");
  if (startsAt.error) return { error: startsAt.error, status: 400 };
  const endsAt = parseWhen(body.endsAt, "endsAt");
  if (endsAt.error) return { error: endsAt.error, status: 400 };
  if (startsAt.value && endsAt.value && endsAt.value <= startsAt.value) {
    return { error: "endsAt must be after startsAt", status: 400 };
  }
  let sortOrder = 0;
  if (body.sortOrder !== undefined && body.sortOrder !== null) {
    if (!Number.isInteger(body.sortOrder)) {
      return { error: "sortOrder must be an integer", status: 400 };
    }
    sortOrder = body.sortOrder;
  }
  return {
    row: {
      id,
      title: title.trim(),
      body: text,
      locationId: locationId ?? null,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
      sortOrder,
    },
  };
}

/** 403 unless the request may manage an announcement pinned to locationId
 *  (null = global, super_admin only). Returns true when allowed. */
async function canManage(req, res, locationId) {
  if (isSuperAdmin(req)) return true;
  const scope = orgScope(req);
  if (locationId === null) {
    res.status(403).json({ ok: false, error: "global announcements are super_admin only" });
    return false;
  }
  const loc = await pool.query(`select org_id as "orgId" from location where id = $1`, [locationId]);
  if (loc.rowCount === 0) {
    res.status(400).json({ ok: false, error: "locationId does not reference an existing location" });
    return false;
  }
  if (loc.rows[0].orgId !== scope) {
    res.status(403).json({ ok: false, error: "forbidden: not your org" });
    return false;
  }
  return true;
}

// --- List -------------------------------------------------------------------
router.get("/", async (req, res) => {
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  const scope = orgScope(req);
  try {
    // org_admin: own org's location-pinned announcements + the global ones
    // (their venues show those too, so hiding them would misrepresent what
    // players actually see).
    const result = await pool.query(
      `select ${ANNOUNCEMENT_COLS}, l.name as "locationName"
         from announcement a
         left join location l on l.id = a.location_id
        where ($1::bool or a.archived_at is null)
          and ($2::uuid is null or a.location_id is null or l.org_id = $2)
        order by a.sort_order, a.created_at`,
      [includeArchived, scope]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[admin/announcements] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Create / update --------------------------------------------------------
router.post("/", async (req, res) => {
  const result = normalizeAnnouncement(req.body);
  if (result.error) return res.status(result.status).json({ ok: false, error: result.error });
  const row = result.row;
  try {
    if (!(await canManage(req, res, row.locationId))) return;
    if (row.id) {
      // Updating: the EXISTING row must also be manageable, so an org_admin
      // can't hijack a global/foreign announcement by posting its id with
      // their own locationId.
      const existing = await pool.query(
        `select location_id as "locationId" from announcement where id = $1`,
        [row.id]
      );
      if (existing.rowCount > 0 && !(await canManage(req, res, existing.rows[0].locationId))) return;
    }
    let db;
    if (row.id) {
      db = await pool.query(
        `insert into announcement (id, title, body, location_id, starts_at, ends_at, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           title = excluded.title, body = excluded.body,
           location_id = excluded.location_id,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           sort_order = excluded.sort_order
         returning ${ANNOUNCEMENT_COLS_BARE}`,
        [row.id, row.title, row.body, row.locationId, row.startsAt, row.endsAt, row.sortOrder]
      );
    } else {
      db = await pool.query(
        `insert into announcement (title, body, location_id, starts_at, ends_at, sort_order)
           values ($1, $2, $3, $4, $5, $6)
         returning ${ANNOUNCEMENT_COLS_BARE}`,
        [row.title, row.body, row.locationId, row.startsAt, row.endsAt, row.sortOrder]
      );
    }
    await audit({
      action: row.id ? "announcement.update" : "announcement.create",
      entity: "announcement",
      entityId: db.rows[0].id,
      detail: { ...row, startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null },
      actor: actorLabel(req),
    });
    return res.json({ ok: true, announcement: db.rows[0] });
  } catch (err) {
    if (err && err.code === "23503") {
      return res.status(400).json({ ok: false, error: "locationId does not reference an existing location" });
    }
    console.error("[admin/announcements] upsert error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Archive / unarchive ----------------------------------------------------
async function setArchived(req, res, archived) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "bad id" });
  try {
    const existing = await pool.query(
      `select location_id as "locationId" from announcement where id = $1`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ ok: false, error: "not found" });
    if (!(await canManage(req, res, existing.rows[0].locationId))) return;
    const db = await pool.query(
      `update announcement a set archived_at = ${archived ? "now()" : "null"} where id = $1
         returning ${ANNOUNCEMENT_COLS}`,
      [id]
    );
    await audit({
      action: archived ? "announcement.archive" : "announcement.unarchive",
      entity: "announcement",
      entityId: id,
      actor: actorLabel(req),
    });
    return res.json({ ok: true, announcement: db.rows[0] });
  } catch (err) {
    console.error("[admin/announcements] archive error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
}
router.post("/:id/archive", (req, res) => setArchived(req, res, true));
router.post("/:id/unarchive", (req, res) => setArchived(req, res, false));
