// POST /api/events — first-party funnel analytics beacon (adoption + sign-in).
//
// The player app fires this to record aggregate product-usage events so we can
// measure the two funnels we're trying to grow — "install prompt shown ->
// installed" and "sign-in started -> completed" — and see where players drop
// off. It is deliberately privacy-clean and matches the announcement-view
// beacon's shape:
//
//   { deviceId: <uuid>, platform?: <string>,
//     events: [{ id: <uuid>, name, meta?, locationId? }, ...] }
//
// - Identity is ONLY the anonymous device install id. We deliberately do NOT
//   store the signed-in app_user id: a funnel event must never be linkable to a
//   name or email (the Privacy page promise). No IP or other PII is stored.
// - `name` is checked against a fixed server-side allowlist; unknown names are
//   dropped (not 500'd), so a stale or malicious client can't write junk or
//   grow the event vocabulary on its own.
// - Each event carries a device-minted `id` (uuid). The beacon uses keepalive +
//   a durable retry queue, so a committed request whose ack the client never
//   sees is re-sent next launch; a unique constraint + ON CONFLICT DO NOTHING
//   makes that retry a no-op instead of double-counting the funnel.
// - Best-effort and fire-and-forget: bad rows are skipped, the batch is capped,
//   and the client re-sends anything still queued.
import { Router } from "express";
import { pool } from "../db.js";

export const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The allowed event vocabulary. Keeping it here (not client-driven) is what
// keeps the table honest — the client can only ever record these names.
export const ALLOWED_EVENTS = new Set([
  // Install / adoption funnel
  "install_prompt_shown", // our install CTA was presented
  "install_accepted", // native prompt accepted
  "install_dismissed", // native prompt dismissed
  "app_installed", // appinstalled fired
  "app_launch_standalone", // app booted as an installed PWA
  // Sign-in funnel
  "signin_started", // requested an email code / opened sign-in
  "signin_completed", // verified a code -> session
  "signin_failed", // verify rejected
  // Adoption nudges (meta.kind = 'install' | 'signin')
  "nudge_shown", // a nudge was presented
  "nudge_clicked", // the player acted on it
  "nudge_dismissed", // the player dismissed it
]);

const ALLOWED_PLATFORMS = new Set(["ios", "android", "desktop", "other"]);
const MAX_EVENTS = 50;
const MAX_META_BYTES = 1_000;

/** Keep only small, well-formed meta so a client can't stuff PII or bloat the
 *  row. Non-object or oversized meta collapses to {}. */
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  try {
    const json = JSON.stringify(meta);
    if (json.length > MAX_META_BYTES) return {};
    return JSON.parse(json);
  } catch {
    return {};
  }
}

router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : null;
  if (!deviceId || !UUID_RE.test(deviceId)) {
    return res.status(400).json({ ok: false, error: "deviceId must be a uuid" });
  }
  const platform =
    typeof body.platform === "string" && ALLOWED_PLATFORMS.has(body.platform)
      ? body.platform
      : null;

  const rawEvents = Array.isArray(body.events) ? body.events : [];
  // Keep only allowlisted events with a valid device-minted id, capped, and
  // de-duped by id within the batch (a client bug could repeat one). Each row
  // carries its own optional location so a multi-venue session attributes right.
  const rows = [];
  const seen = new Set();
  for (const e of rawEvents) {
    if (rows.length >= MAX_EVENTS) break;
    if (!e || typeof e !== "object") continue;
    if (typeof e.id !== "string" || !UUID_RE.test(e.id) || seen.has(e.id)) continue;
    if (typeof e.name !== "string" || !ALLOWED_EVENTS.has(e.name)) continue;
    seen.add(e.id);
    const locationId =
      typeof e.locationId === "string" && UUID_RE.test(e.locationId) ? e.locationId : null;
    rows.push({ id: e.id, name: e.name, meta: sanitizeMeta(e.meta), locationId });
  }
  if (rows.length === 0) return res.json({ ok: true, recorded: 0 });

  try {
    // One multi-row insert. A location id that doesn't exist resolves to null
    // (FK-safe subselect) rather than 23503. ON CONFLICT DO NOTHING absorbs a
    // re-sent batch, so `recorded` counts only genuinely new events.
    const result = await pool.query(
      `insert into funnel_event (client_event_id, event, device_id, location_id, platform, meta)
         select e.id, e.name, $1::uuid,
                (select l.id from location l where l.id = e.location_id),
                $2::text, e.meta
           from jsonb_to_recordset($3::jsonb)
             as e(id uuid, name text, location_id uuid, meta jsonb)
       on conflict (client_event_id) do nothing`,
      [deviceId, platform, JSON.stringify(rows.map((r) => ({
        id: r.id,
        name: r.name,
        location_id: r.locationId,
        meta: r.meta,
      })))]
    );
    return res.json({ ok: true, recorded: result.rowCount });
  } catch (err) {
    console.error("[events] beacon error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
