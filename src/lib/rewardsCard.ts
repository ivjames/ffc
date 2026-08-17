import { useSyncExternalStore } from 'react';
import { apiUrl } from '../sync';
import { getCurrentLocationId, useCurrentLocationId } from './location';
import type { Player, PlayerTransaction } from './pos/types';

// The player's rewards card — which venue loyalty account this PERSON owns.
//
// This used to be a card id in localStorage, set by looking the number up
// against the vendor straight from the browser. That made the printed number
// the only credential in the system: type someone else's and you saw their
// name, tier, balances and history, and the ticket-write paths would credit
// whatever card id the request carried. The binding now lives server-side
// against the signed-in account (/api/loyalty, schema user_card_link), so a
// number links a card exactly once and then only that session can read it.
//
// Nothing about the card is cached in localStorage any more — the account is
// the durable thing, and it already survives visits and devices.

export type CardState = {
  /** The linked card, or null when this account has none at this venue. */
  player: Player | null;
  transactions: PlayerTransaction[];
  /** True once an answer has landed (so the UI can hold off on "link a card"). */
  known: boolean;
  loading: boolean;
  error: string | null;
  /** Which venue this answer is about. A card is bound per (account, venue),
   *  so a venue switch invalidates it — without this the old venue's balances
   *  would sit on screen at the new one. */
  locationId: string | null;
};

const EMPTY: CardState = {
  player: null,
  transactions: [],
  known: false,
  loading: false,
  error: null,
  locationId: null,
};

let state: CardState = EMPTY;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function emit(next: CardState): void {
  state = next;
  listeners.forEach((notify) => notify());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getCardState(): CardState {
  return state;
}

/** Drop everything we know about the card — used on sign-out, so one person's
 *  card can never be shown to whoever signs in next on a shared phone. */
export function resetCard(): void {
  emit(EMPTY);
}

/** Load the signed-in account's card for the current venue. De-duplicated, so
 *  several components mounting at once make one request. */
export function refreshCard(): Promise<void> {
  if (inFlight) return inFlight;
  const locationId = getCurrentLocationId();
  // Not emitted: useCard kicks this off from render (see the note in
  // lib/session.ts — notifying subscribers mid-render is a React error).
  state = { ...state, loading: true, error: null, locationId };
  inFlight = fetch(apiUrl(`/api/loyalty/me?locationId=${encodeURIComponent(locationId)}`))
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true) {
        // Signed out or the venue has no loyalty add-on: no card, not an error
        // worth showing — the surfaces that care are gated on those already.
        if (res.status === 401 || res.status === 403) {
          emit({ ...EMPTY, known: true, locationId });
          return;
        }
        emit({
          ...state,
          loading: false,
          known: true,
          error: data.error ?? `HTTP ${res.status}`,
          locationId,
        });
        return;
      }
      emit({
        player: data.player ?? null,
        transactions: data.transactions ?? [],
        known: true,
        loading: false,
        error: null,
        locationId,
      });
    })
    .catch(() => {
      emit({ ...state, loading: false, error: 'network error' });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Bind a card to this account by its printed number. */
export async function linkCard(cardNumber: string): Promise<{ ok: boolean; error?: string }> {
  const locationId = getCurrentLocationId();
  try {
    const res = await fetch(apiUrl('/api/loyalty/link'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, cardNumber }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) {
      return {
        ok: false,
        error:
          res.status === 404 ? 'No card found with that number.' : (data.error ?? `HTTP ${res.status}`),
      };
    }
    emit({
      player: data.player,
      transactions: [],
      known: true,
      loading: false,
      error: null,
      locationId,
    });
    void refreshCard(); // pull the history now that we're allowed to read it
    return { ok: true };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

export async function unlinkCard(): Promise<void> {
  const locationId = getCurrentLocationId();
  try {
    await fetch(apiUrl('/api/loyalty/link'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId }),
    });
  } catch {
    // Non-fatal — the refresh below reconciles with whatever the server says.
  }
  emit({ ...EMPTY, known: true, locationId });
}

/** Reactive read of the linked card for the CURRENT venue. Lazily loads on
 *  first use, and reloads when the player switches venue. */
export function useCard(): CardState {
  const locationId = useCurrentLocationId();
  const snapshot = useSyncExternalStore(subscribe, getCardState, getCardState);
  const stale = snapshot.locationId !== locationId;
  if ((stale || !snapshot.known) && !snapshot.loading) void refreshCard();
  // Never hand back another venue's card while the new one is loading.
  return stale ? { ...EMPTY, loading: true, locationId } : snapshot;
}

/** Just the linked card's vendor id, for the gating decisions that only need
 *  to know whether there IS one. */
export function getLinkedPlayerId(): string | null {
  return state.player?.id ?? null;
}

export function useLinkedPlayerId(): string | null {
  return useCard().player?.id ?? null;
}
