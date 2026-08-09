// Booth-photo retention (privacy) — the photo booth's counterpart to
// lib/photoRetention.js. Booth photos are guest snapshots decorated for fun;
// nothing about the feature needs them beyond the visit, so they age out:
//
//   PHOTO_BOOTH_RETENTION_DAYS   how long a stored photo lives (default 30).
//                                0 (or negative) disables the sweep — an
//                                explicit operator opt-out, not the default.
//
// One deliberate difference from the hunt sweep: a booth_photo row carries no
// gameplay credit or moderation history, so the sweep deletes the ROW along
// with the file — an empty gallery, not a gallery of tombstones. File first,
// then DB — if the rm fails the row stays and the next sweep retries.
//
// startBoothPhotoRetention() is called from index.js (the process entrypoint),
// NOT app.js, so importing the app in tests never starts background timers.
import { rm } from "node:fs/promises";
import { pool } from "../db.js";

const DEFAULT_RETENTION_DAYS = 30;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // catches up fast after downtime

/** PHOTO_BOOTH_RETENTION_DAYS with .env.example semantics: blank/unset/garbage
 *  means the default. An explicit 0 (or negative) disables the sweep. */
export function resolveBoothRetentionDays(raw = process.env.PHOTO_BOOTH_RETENTION_DAYS) {
  if (raw == null || String(raw).trim() === "") return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_RETENTION_DAYS;
}

/** Delete every stored booth photo older than the retention window.
 *  @returns {Promise<{swept: number}>} how many photos were removed. */
export async function sweepExpiredBoothPhotos() {
  const days = resolveBoothRetentionDays();
  if (days <= 0) return { swept: 0 };
  const due = await pool.query(
    `select id, photo_path as "photoPath" from booth_photo
      where created_at < now() - ($1::int * interval '1 day')`,
    [days]
  );
  let swept = 0;
  for (const row of due.rows) {
    try {
      await rm(row.photoPath, { force: true }); // force: a missing file still clears the row
      await pool.query(`delete from booth_photo where id = $1`, [row.id]);
      swept += 1;
    } catch (err) {
      // Leave the row for the next sweep rather than orphaning the file.
      console.error(`[photos] booth retention: failed to remove ${row.photoPath}:`, err);
    }
  }
  if (swept > 0) {
    console.log(`[photos] booth retention: deleted ${swept} photo(s) older than ${days} days`);
  }
  return { swept };
}

/** Run one sweep now and keep sweeping on an interval. unref'd so the timer
 *  never holds the process open. */
export function startBoothPhotoRetention() {
  const run = () =>
    sweepExpiredBoothPhotos().catch((err) =>
      console.error("[photos] booth retention sweep failed:", err)
    );
  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
