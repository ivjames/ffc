// Admin: CSV export (office reporting, punchlist #2).
//   GET /api/admin/export/rounds.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&locationId=&orgId=
//
// One row per (completed round, player): when, where, who, and the score —
// the "get it into a spreadsheet" path, no integration required. Timestamps
// and the from/to calendar-day window (inclusive on both ends, defaulting to
// the last 30 days) are evaluated in EACH VENUE'S own zone (location.tz, the
// leaderboard precedent), falling back to ADMIN_TZ for venues without one —
// an East-coast venue's day must not be cut at its 3am. Org-scoped like every
// admin read; a super_admin can additionally narrow to one org via ?orgId=
// (and gets the org column to tell clients apart when they don't).
import { Router } from "express";
import { pool } from "../../db.js";
import { orgScope } from "../../lib/adminAuth.js";
import { UUID_RE } from "../../lib/validateLocation.js";
import { boardSyntheticFilter } from "../../lib/syntheticConfig.js";

export const router = Router();

const ADMIN_TZ = process.env.ADMIN_TZ || "America/Los_Angeles";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** RFC 4180 field escaping: quote when the value needs it. */
function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function csvLine(values) {
  return values.map(csvField).join(",");
}

router.get("/rounds.csv", async (req, res) => {
  const scope = orgScope(req);
  const { from, to, locationId, orgId } = req.query;
  if (from !== undefined && (typeof from !== "string" || !DATE_RE.test(from))) {
    return res.status(400).json({ ok: false, error: "from must be YYYY-MM-DD" });
  }
  if (to !== undefined && (typeof to !== "string" || !DATE_RE.test(to))) {
    return res.status(400).json({ ok: false, error: "to must be YYYY-MM-DD" });
  }
  if (locationId !== undefined && (typeof locationId !== "string" || !UUID_RE.test(locationId))) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  if (orgId !== undefined && (typeof orgId !== "string" || !UUID_RE.test(orgId))) {
    return res.status(400).json({ ok: false, error: "orgId must be a uuid" });
  }
  // An org_admin's scope always wins over any orgId query param — they never
  // export another org's rounds, whatever they ask for (locations.js idiom).
  const effectiveOrgId = scope || orgId || null;
  try {
    // Every per-day/per-stamp computation uses the ROW's venue zone
    // (coalesce(l.tz, ADMIN_TZ)): the from/to window is "that calendar day at
    // that venue", and the default 30-day window likewise ends on each
    // venue's own today.
    const result = await pool.query(
      `select timezone(coalesce(l.tz, $1), r.completed_at) as completed_local,
              o.slug  as org_slug,
              l.name  as location_name,
              c.name  as course_name,
              (select sum(p) from unnest(c.pars) p) as course_par,
              r.id    as round_id,
              r.group_tag,
              pt.tag  as player_tag,
              count(s.hole)   as holes_entered,
              coalesce(sum(s.strokes), 0) as total_strokes
         from round r
         join course c on c.id = r.course_id
         left join location l on l.id = c.location_id
         left join org o on o.id = l.org_id
         cross join lateral unnest(r.player_tags) with ordinality as pt(tag, ord)
         left join score s on s.round_id = r.id and s.player_index = pt.ord - 1
        where r.completed_at is not null
          and timezone(coalesce(l.tz, $1), r.completed_at)::date
              >= coalesce($2::date, (timezone(coalesce(l.tz, $1), now()) - interval '30 days')::date)
          and timezone(coalesce(l.tz, $1), r.completed_at)::date
              <= coalesce($3::date, timezone(coalesce(l.tz, $1), now())::date)
          and ($4::uuid is null or c.location_id = $4)
          and ($5::uuid is null or l.org_id = $5)
          ${boardSyntheticFilter("r", process.env)}
        group by r.id, r.completed_at, o.slug, l.tz, l.name, c.name, c.pars, r.group_tag, pt.tag, pt.ord
        order by r.completed_at, r.id, pt.ord`,
      [ADMIN_TZ, from ?? null, to ?? null, locationId ?? null, effectiveOrgId]
    );

    const lines = [
      csvLine([
        "completed_at_local", "org", "location", "course", "course_par",
        "round_id", "team_tag", "player_tag", "holes_entered", "total_strokes",
      ]),
    ];
    for (const r of result.rows) {
      // completed_local is a zone-less timestamp already shifted into the
      // venue's zone; render its wall-clock fields directly (UTC getters — pg
      // parsed it as UTC precisely because it carries no zone).
      const d = r.completed_local;
      const stamp =
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-` +
        `${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:` +
        `${String(d.getUTCMinutes()).padStart(2, "0")}`;
      lines.push(
        csvLine([
          stamp,
          r.org_slug,
          r.location_name,
          r.course_name,
          r.course_par,
          r.round_id,
          r.group_tag,
          r.player_tag,
          r.holes_entered,
          r.total_strokes,
        ])
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set(
      "Content-Disposition",
      `attachment; filename="rounds_${from ?? "last-30d"}_${to ?? today}.csv"`
    );
    return res.send(lines.join("\r\n") + "\r\n");
  } catch (err) {
    console.error("[admin/export] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
