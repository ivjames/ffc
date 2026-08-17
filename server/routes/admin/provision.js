// Admin: one-shot site provisioning. super_admin only.
//   POST /api/admin/provision   org + location + courses (+ optional org_admin)
//
// Create-only, in ONE transaction — unlike the org/location upserts (which
// accept ids/slugs and ON CONFLICT update in place) and the seed script's
// deliberate reset semantics, this route refuses any supplied ids and never
// touches existing rows: a slug or email collision is a 409, not an update.
// Either the whole site lands or none of it does.
//
// The audit write runs AFTER COMMIT, not inside the transaction: audit()
// swallows its own errors, and a failed in-txn audit statement would abort the
// transaction while the subsequent COMMIT silently no-ops — losing the site
// while reporting success. Post-commit, a lost audit row costs only the log
// line audit() already prints.
//
// The org_admin is invited by email, never given an operator-typed password:
// the account lands with a NULL password_hash and the post-commit side effects
// mail a set-password link (lib/adminPasswordTokens.js). A failed send must
// not lose the committed site either — the response says `inviteSent: false`
// and the recovery is "Forgot password" on the sign-in page, which re-mails
// the invite.
import { Router } from "express";
import { pool } from "../../db.js";
import { audit, isSuperAdmin, actorLabel } from "../../lib/adminAuth.js";
import { normalizeOrg, ORG_COLS } from "../../lib/validateOrg.js";
import { normalizeLocation, withLabel, LOCATION_RETURN_COLS } from "../../lib/validateLocation.js";
import { normalizeCourse, COURSE_RETURN_COLS } from "../../lib/validateCourse.js";
import { EMAIL_RE } from "../../lib/validateUser.js";
import { sendSetPasswordEmail } from "../../lib/adminPasswordTokens.js";
import { clearTenantCache } from "../../lib/tenant.js";

export const router = Router();

const MAX_COURSES = 12;

// Admin traffic arrives on admin.<platform-fqdn> (trust proxy is on, so
// req.hostname is the original Host); the new org's player site is
// <slug>.<platform-fqdn>. Only derivable when the first label is "admin" —
// dev/localhost returns null and the SPA falls back to showing the slug.
function playerUrlFor(req, slug) {
  const host = String(req.hostname || "").toLowerCase();
  const [first, ...rest] = host.split(".");
  if (first === "admin" && rest.length > 0) return `https://${slug}.${rest.join(".")}`;
  return null;
}

/** "none" | "ordering" | "loyalty" | "ordering+loyalty" — for the audit trail. */
function posSummary(pos) {
  if (!pos) return "none";
  const caps = [];
  if (pos.ordering) caps.push("ordering");
  if (pos.loyalty) caps.push("loyalty");
  return caps.length > 0 ? caps.join("+") : "none";
}

router.post("/", async (req, res) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "super_admin only" });
  }

  // Create-only guards, BEFORE validation: the shared normalizers accept
  // id/orgId/locationId (their upsert callers need them), and a supplied
  // location.orgId would attach the new location to an EXISTING org instead of
  // the one this request creates. Refuse them all up front.
  const body = req.body ?? {};
  if (body.org?.id !== undefined) {
    return res.status(400).json({ ok: false, error: "org.id must not be set (provisioning is create-only)" });
  }
  if (body.location?.id !== undefined) {
    return res.status(400).json({ ok: false, error: "location.id must not be set (provisioning is create-only)" });
  }
  if (body.location?.orgId !== undefined) {
    return res.status(400).json({ ok: false, error: "location.orgId must not be set (the location always belongs to the new org)" });
  }
  if (Array.isArray(body.courses)) {
    for (let i = 0; i < body.courses.length; i++) {
      if (body.courses[i]?.id !== undefined || body.courses[i]?.locationId !== undefined) {
        return res.status(400).json({
          ok: false,
          error: `courses[${i}].id/locationId must not be set (provisioning is create-only)`,
        });
      }
    }
  }

  // Validate every section up front — no DB work until the whole payload is good.
  const org = normalizeOrg({ ...body.org, branding: body.branding });
  if (org.error) return res.status(org.status || 400).json({ ok: false, error: org.error });

  const loc = normalizeLocation(body.location);
  if (loc.error) return res.status(loc.status || 400).json({ ok: false, error: loc.error });

  if (!Array.isArray(body.courses) || body.courses.length < 1 || body.courses.length > MAX_COURSES) {
    return res.status(400).json({ ok: false, error: `courses must be an array of 1..${MAX_COURSES}` });
  }
  const courseRows = [];
  for (let i = 0; i < body.courses.length; i++) {
    const c = normalizeCourse(body.courses[i], i);
    if (c.error) return res.status(400).json({ ok: false, error: c.error });
    courseRows.push(c.row);
  }

  // Email-only: the admin sets their own password via the emailed link — an
  // operator-typed password would be a secret the operator knows and has to
  // hand over out of band.
  let adminUser = null;
  if (body.adminUser != null) {
    const candidate = body.adminUser;
    if (
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      typeof candidate.email !== "string" ||
      !EMAIL_RE.test(candidate.email.trim())
    ) {
      return res.status(400).json({ ok: false, error: "adminUser: email must be a valid address" });
    }
    // Lowercase once, up front — the pre-flight check, insert, audit row, and
    // invite mail must all agree on the stored spelling.
    adminUser = { email: candidate.email.trim().toLowerCase() };
  }

  try {
    // Friendly pre-flight collision checks — a race can still slip past these,
    // so the 23505 branch below maps the same three cases.
    const orgTaken = await pool.query(`select 1 from org where slug = $1`, [org.row.slug]);
    if (orgTaken.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "org slug already in use" });
    }
    const locTaken = await pool.query(`select 1 from location where slug = $1`, [loc.row.slug]);
    if (locTaken.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "location slug already in use" });
    }
    if (adminUser) {
      const emailTaken = await pool.query(`select 1 from admin_user where email = $1`, [
        adminUser.email,
      ]);
      if (emailTaken.rowCount > 0) {
        return res.status(409).json({ ok: false, error: "admin email already in use" });
      }
    }
  } catch (err) {
    console.error("[admin/provision] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }

  const client = await pool.connect();
  let site;
  try {
    await client.query("BEGIN");

    const orgDb = await client.query(
      `insert into org (name, slug, sort_order, branding)
         values ($1, $2, $3, coalesce($4::jsonb, '{}'::jsonb))
       returning ${ORG_COLS}`,
      [org.row.name, org.row.slug, org.row.sortOrder, org.row.branding]
    );
    const newOrg = orgDb.rows[0];

    const row = loc.row;
    const locDb = await client.query(
      `insert into location (name, slug, lat, lng, geofence_km, tz, sort_order, menu_url, ordering_url, pos, hours, org_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning ${LOCATION_RETURN_COLS}`,
      [row.name, row.slug, row.lat, row.lng, row.geofenceKm, row.tz, row.sortOrder, row.menuUrl, row.orderingUrl, row.pos, row.hours, newOrg.id]
    );
    const newLocation = locDb.rows[0];

    const newCourses = [];
    for (const course of courseRows) {
      const courseDb = await client.query(
        `insert into course (name, theme, hole_count, pars, location_id, sort_order)
           values ($1, $2, $3, $4, $5, $6)
         returning ${COURSE_RETURN_COLS}`,
        [course.name, course.theme, course.holeCount, course.pars, newLocation.id, course.sortOrder]
      );
      newCourses.push(courseDb.rows[0]);
    }

    let newAdminUser = null;
    if (adminUser) {
      // password_hash stays NULL until the invitee follows their emailed
      // set-password link — a pending account that can't log in yet.
      const userDb = await client.query(
        `insert into admin_user (email, role, org_id)
           values ($1, 'org_admin', $2)
         returning id, email, role, org_id as "orgId"`,
        [adminUser.email, newOrg.id]
      );
      newAdminUser = userDb.rows[0];
    }

    await client.query("COMMIT");
    site = { org: newOrg, location: newLocation, courses: newCourses, adminUser: newAdminUser };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23505") {
      const messages = {
        org_slug_key: "org slug already in use",
        location_slug_key: "location slug already in use",
        admin_user_email_key: "admin email already in use",
      };
      return res
        .status(409)
        .json({ ok: false, error: messages[err.constraint] ?? "duplicate value" });
    }
    console.error("[admin/provision] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }

  // Post-COMMIT side effects (see the header comment for why audit lives
  // here — and why a failed invite send is reported, never fatal: the site is
  // already committed, and "Forgot password" re-mails the link).
  clearTenantCache();
  let inviteSent = false;
  // Non-null only while no real mail provider is configured (the pre-Resend
  // window): this route is super_admin-gated, so handing the link back lets
  // the operator relay it by hand — the console mailer withholds it from
  // production logs, making this response the only place it exists.
  let inviteLink = null;
  if (site.adminUser) {
    ({ sent: inviteSent, inviteLink } = await sendSetPasswordEmail({
      req,
      email: site.adminUser.email,
      adminUserId: site.adminUser.id,
      kind: "invite",
    }));
  }
  await audit({
    action: "site.provision",
    entity: "org",
    entityId: site.org.id,
    detail: {
      orgSlug: site.org.slug,
      locationSlug: site.location.slug,
      courseCount: site.courses.length,
      pos: posSummary(site.location.pos),
      adminUserEmail: adminUser?.email ?? null, // never a password — none exists yet
      // Boolean only — the audit log must never hold the capability itself.
      ...(adminUser ? { inviteSent, inviteLinkReturned: inviteLink !== null } : {}),
    },
    actor: actorLabel(req),
  });

  return res.json({
    ok: true,
    site: {
      org: site.org,
      location: withLabel(site.location),
      courses: site.courses,
      adminUser: site.adminUser ? { ...site.adminUser, inviteSent, inviteLink } : null,
      playerUrl: playerUrlFor(req, site.org.slug),
    },
  });
});
