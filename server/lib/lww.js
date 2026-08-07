// Per-cell last-write-wins for shared_score. The scorecard is a grid of
// independent (slot, hole) registers; a write carries the device's tap
// timestamp and its participant id, and it wins iff (ts, participant) is
// lexicographically greater than what's stored — a total order, so every
// replica (server and each device's mirror in src/lib/sharedMerge.ts — keep
// the comparison in sync) converges on the same grid regardless of arrival
// order, and replays are harmless no-ops.

// A device with a wildly wrong clock must not plant a far-future timestamp
// that makes a cell unwritable by everyone else — clamp to now + 2 minutes.
export const TS_CLAMP_AHEAD_MS = 2 * 60 * 1000;

export function clampTs(ts, now = Date.now()) {
  return Math.min(ts, now + TS_CLAMP_AHEAD_MS);
}

/**
 * Apply one cell write with the LWW guard. `client` is a pg client/pool.
 * @returns {Promise<boolean>} true if the write took effect.
 */
export async function applyCellWrite(client, gameId, { slot, hole, strokes, ts }, participantId) {
  const clamped = clampTs(ts);
  const result = await client.query(
    `insert into shared_score (game_id, slot, hole, strokes, ts_client, updated_by)
       values ($1, $2, $3, $4, $5, $6)
     on conflict (game_id, slot, hole) do update
       set strokes    = excluded.strokes,
           ts_client  = excluded.ts_client,
           updated_by = excluded.updated_by,
           updated_at = now()
       where (excluded.ts_client, excluded.updated_by::text)
           > (shared_score.ts_client, shared_score.updated_by::text)
     returning ts_client as "ts"`,
    [gameId, slot, hole, strokes, clamped, participantId]
  );
  return result.rowCount === 1 ? { applied: true, ts: Number(result.rows[0].ts) } : { applied: false };
}
