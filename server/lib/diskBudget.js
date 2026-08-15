// Serialized disk-budget reservations for the byte-storing routes.
//
// Every feature that writes uploaded bytes to the droplet bounds itself with a
// global budget: "sum the bytes already stored, refuse if this upload would
// push past the ceiling". Read and then written as two separate statements,
// that is not a ceiling at all — concurrent uploads all read the same sum
// before any of them inserts, all conclude there is room, and all store. The
// overshoot is bounded only by how many requests happen to arrive at once,
// times the per-upload size limit.
//
// The fix is to make the check and the row that CONSUMES the checked room
// commit together, under a lock that no other reservation can hold at the same
// time. A transaction-scoped Postgres advisory lock does exactly that and is
// released automatically on commit/rollback — including if the process dies
// mid-request, which is why this is preferred over a lock table.
//
// The lock is deliberately held across the file write too. That keeps the
// invariant simple — a committed row always has its bytes on disk — at the
// cost of serializing uploads within a feature, which is the right trade at
// this app's traffic (uploads are already IP-rate-limited).

/** Advisory-lock keys, one per feature that reserves disk. Arbitrary; they
 *  only have to be distinct from each other and from any other advisory lock
 *  this app takes. (The hex spells the feature, which is just a kindness to
 *  whoever finds one of these in `pg_locks`.) */
export const BUDGET_LOCKS = {
  boothPhoto: 0x626f6f74, // "boot"
  feedback: 0x66656564, // "feed"
};

/**
 * Run `fn(client)` inside one transaction holding `lockKey`, and commit.
 * Whatever `fn` returns is returned; a throw rolls back and re-throws.
 *
 * `lockKey` may be null for a request that consumes NO budget (e.g. filing a
 * comment with no screenshot). Such a request still gets its transaction but
 * takes no lock, so it never queues behind someone else's upload.
 *
 * Files written inside `fn` are NOT cleaned up here — a rollback leaves them
 * orphaned, so callers that write bytes must remove their own file on throw.
 */
export async function inBudgetReservation(pool, lockKey, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (lockKey !== null) {
      await client.query("select pg_advisory_xact_lock($1)", [lockKey]);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
