import { apiUrl } from '../sync';
import { getAllRounds } from '../db';

// "Sign in to keep your scores" — attach this device's already-played rounds to
// the account. Tags collide by design, so we claim by the device's OWN round
// client ids (never the tag): the server links only the ones it has that are
// still unowned. Future rounds attach automatically at sync time once signed
// in; this covers rounds played before signing in.

/** The device round ids worth claiming — completed rounds (the ones that have
 *  synced), de-duped and capped to match the server's limit. Pure, for tests. */
export function collectClaimableClientIds(
  rounds: Array<{ clientId: string; completedAt: number | null }>,
): string[] {
  return [
    ...new Set(rounds.filter((r) => r.completedAt != null).map((r) => r.clientId)),
  ].slice(0, 500);
}

/** Claim this device's rounds onto the signed-in account. Resolves to the
 *  number newly claimed (0 when signed out — the server 401s — or nothing to
 *  claim). Best-effort: never throws. */
export async function claimMyRounds(): Promise<number> {
  try {
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
