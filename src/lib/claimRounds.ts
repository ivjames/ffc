import { apiUrl, syncPending } from '../sync';
import { getAllRounds } from '../db';

// "Sign in to keep your scores" — attach this device's already-played rounds to
// the account. Tags collide by design, so we claim by the device's OWN round
// client ids (never the tag): the server links only the ones it has that are
// still unowned. Future rounds attach automatically at sync time once signed
// in; this covers rounds played before signing in.

/** The device round ids worth claiming — completed rounds (the ones that have
 *  synced), de-duped and capped to match the server's limit. Shared games are
 *  EXCLUDED: every participant stores the same `shared:<gameId>` id for one
 *  canonical server round, so a single account can't own it (whoever claimed
 *  first would win by sign-in order). Pure, for tests. */
export function collectClaimableClientIds(
  rounds: Array<{ clientId: string; completedAt: number | null }>,
): string[] {
  return [
    ...new Set(
      rounds
        .filter((r) => r.completedAt != null && !r.clientId.startsWith('shared:'))
        .map((r) => r.clientId),
    ),
  ].slice(0, 500);
}

/** Claim this device's rounds onto the signed-in account. Resolves to the
 *  number newly claimed (0 when signed out — the server 401s — or nothing to
 *  claim). Best-effort: never throws.
 *
 *  Flushes any pending sync FIRST so a round POST that was already in flight
 *  (still anonymous) lands on the server before we claim — otherwise the claim
 *  could find no row, and the later anonymous insert would leave the round
 *  unowned with nothing to re-trigger it. */
export async function claimMyRounds(): Promise<number> {
  try {
    await syncPending().catch(() => {});
    const clientIds = collectClaimableClientIds(await getAllRounds());
    if (clientIds.length === 0) return 0;
    const res = await fetch(apiUrl('/api/rounds/claim'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientIds }),
    });
    if (!res.ok) return 0;
    const data = (await res.json().catch(() => ({}))) as { claimed?: number };
    return typeof data.claimed === 'number' ? data.claimed : 0;
  } catch {
    return 0;
  }
}
