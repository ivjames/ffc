// Hunt-photo retention (privacy). Player-submitted photos are the most
// sensitive data this app stores — real photographs of a physical venue,
// often with people (and kids) in frame. They exist for one feature: the
// group's own share flow during and shortly after their visit. Nothing about
// that needs the files forever, so they are deleted on a clock:
//
//   HUNT_PHOTO_RETENTION_DAYS   how long a stored photo lives (default 30).
//                               0 (or negative) disables the sweep — an
//                               explicit operator opt-out, not the default.
//
// The sweep is DB-driven: every hunt_find whose photo is older than the
// window has its file removed from disk and its photo_path cleared. The row
// itself (who found what, when, moderation verdict) is kept — that's
// gameplay/audit history with no image attached. Clearing photo_path is what
// turns off serving: both the player share endpoint (routes/hunt.js) and the
// admin review surface (routes/admin/photos.js) require photo_path is not
// null. File first, then DB — if the rm fails the path stays set and the
// next sweep retries.
//
// startHuntPhotoRetention() is called from index.js (the process entrypoint),
// NOT app.js, so importing the app in tests never starts background timers.
import { rm } from "node:fs/promises";
import { pool } from "../db.js";

const DEFAULT_RETENTION_DAYS = 30;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // catches up fast after downtime

/** HUNT_PHOTO_RETENTION_DAYS with .env.example semantics: blank/unset/garbage
 *  means the default. An explicit 0 (or negative) disables the sweep. */
export function resolvePhotoRetentionDays(raw = process.env.HUNT_PHOTO_RETENTION_DAYS) {
  if (raw == null || String(raw).trim() === "") return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_RETENTION_DAYS;
}

/** Delete every stored hunt photo older than the retention window.
 *  @returns {Promise<{swept: number}>} how many photos were removed. */
export async function sweepExpiredHuntPhotos() {
  const days = resolvePhotoRetentionDays();
  if (days <= 0) return { swept: 0 };
  const due = await pool.query(
    `select id, photo_path as "photoPath" from hunt_find
      where photo_path is not null
        and created_at < now() - ($1::int * interval '1 day')`,
    [days]
  );
  let swept = 0;
  for (const row of due.rows) {
    try {
      await rm(row.photoPath, { force: true }); // force: a missing file still clears the row
      await pool.query(`update hunt_find set photo_path = null where id = $1`, [row.id]);
      swept += 1;
    } catch (err) {
      // Leave the row for the next sweep rather than orphaning the file.
      console.error(`[hunt] photo retention: failed to remove ${row.photoPath}:`, err);
    }
  }
  if (swept > 0) {
    console.log(`[hunt] photo retention: deleted ${swept} photo(s) older than ${days} days`);
  }
  return { swept };
}

/** Run one sweep now and keep sweeping on an interval. unref'd so the timer
 *  never holds the process open. */
export function startHuntPhotoRetention() {
  const run = () =>
    sweepExpiredHuntPhotos().catch((err) =>
      console.error("[hunt] photo retention sweep failed:", err)
    );
  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
