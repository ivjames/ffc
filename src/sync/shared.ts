// Live sync manager for ONE shared round: subscribes to the game's SSE stream,
// funnels every mutation (remote events AND this device's taps) through a
// single promise queue into IndexedDB, and drains the offline outbox whenever
// connectivity returns. The queue is what keeps a local tap from clobbering a
// concurrently-arriving remote cell — whole-record putRound is only ever
// issued from one place, in order.
import type { LocalRound } from '../types';
import { getRound, putRound, enqueueOutbox, getOutbox, clearOutbox } from '../db';
import {
  applyRemoteCell,
  applySnapshot,
  applyPlayerJoined,
  applyLocalStroke,
  applyCompleted,
  type GameSnapshot,
  type RemoteCell,
} from '../lib/sharedMerge';
import { postScores, completeGame, sseUrl } from '../lib/gamesApi';

export type SharedStatus = 'live' | 'reconnecting' | 'offline';

export type SharedHandle = {
  /** Record a tap on any player's cell (0-based hole) and ship it. */
  applyLocal(slot: number, holeIdx: number, strokes: number | null): void;
  /** Finalize the game server-side (idempotent). */
  complete(): Promise<{ ok: boolean; error?: string }>;
  close(): void;
};

export function openSharedRound(
  clientId: string,
  onRound: (round: LocalRound) => void,
  onStatus: (status: SharedStatus) => void,
): SharedHandle {
  let current: LocalRound | null = null;
  let es: EventSource | null = null;
  let closed = false;
  let flushing = false;
  let queue: Promise<unknown> = Promise.resolve();

  // Serialize every state mutation; fn returns null for "no change".
  function mutate(fn: (round: LocalRound) => LocalRound | null): Promise<void> {
    const step = queue.then(async () => {
      if (closed) return;
      current ??= (await getRound(clientId)) ?? null;
      if (!current?.shared) return;
      const next = fn(current);
      if (!next) return;
      current = next;
      await putRound(next);
      onRound(next);
    });
    queue = step.catch((err) => console.warn('[shared] mutation failed', err));
    return queue as Promise<void>;
  }

  /** Push everything queued for this game; delivered writes leave the outbox. */
  async function flush(): Promise<void> {
    if (flushing || closed || !navigator.onLine) return;
    flushing = true;
    try {
      const shared = current?.shared;
      if (!shared) return;
      const pending = await getOutbox(shared.gameId);
      if (pending.length === 0) return;
      const res = await postScores(
        shared.gameId,
        shared.participantToken,
        pending.map(({ entry }) => ({
          slot: entry.slot,
          hole: entry.hole,
          strokes: entry.strokes,
          ts: entry.ts,
        })),
      );
      // Delivered (or permanently undeliverable — the game closed or the
      // token was revoked): clear the queue. Transient failures keep it.
      if (res.ok || res.status === 409 || res.status === 401) {
        await clearOutbox(pending.map((p) => p.key));
      }
    } finally {
      flushing = false;
    }
  }

  function connect() {
    if (closed) return;
    es = new EventSource(sseUrl(gameIdFromClientId(clientId), participantTokenSync()));
    es.addEventListener('open', () => onStatus('live'));
    es.addEventListener('error', () => {
      // EventSource auto-reconnects; the snapshot on reconnect re-syncs us.
      onStatus(navigator.onLine ? 'reconnecting' : 'offline');
    });
    es.addEventListener('snapshot', (e) => {
      const snapshot = JSON.parse((e as MessageEvent).data) as GameSnapshot;
      void mutate((r) => applySnapshot(r, snapshot));
      void queue.then(flush);
    });
    es.addEventListener('score', (e) => {
      const cell = JSON.parse((e as MessageEvent).data) as RemoteCell;
      void mutate((r) =>
        // Our own writes echo back with our participant id — the LWW gate
        // makes them no-ops, so no self-filtering is needed.
        applyRemoteCell(r, cell),
      );
    });
    es.addEventListener('player_joined', (e) => {
      const { slot, tag } = JSON.parse((e as MessageEvent).data) as { slot: number; tag: string };
      void mutate((r) => applyPlayerJoined(r, slot, tag));
    });
    es.addEventListener('game_completed', () => {
      void mutate((r) => applyCompleted(r));
    });
  }

  // The EventSource URL needs the token before the round has loaded; both are
  // derivable synchronously once the first mutate() resolves, so bootstrap by
  // loading the round first, then connecting.
  function gameIdFromClientId(id: string): string {
    return id.replace(/^shared:/, '');
  }
  function participantTokenSync(): string {
    return current?.shared?.participantToken ?? '';
  }

  const onOnline = () => {
    onStatus('reconnecting');
    void flush();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') void flush();
  };

  // Bootstrap: load the round, surface it, connect the stream, drain the queue.
  void mutate((r) => r).then(() => {
    if (closed || !current?.shared) return;
    connect();
    void flush();
  });
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  return {
    applyLocal(slot, holeIdx, strokes) {
      const ts = Date.now();
      void mutate((r) => {
        const next = applyLocalStroke(r, slot, holeIdx, strokes, ts);
        void enqueueOutbox({
          gameId: r.shared!.gameId,
          slot,
          hole: holeIdx + 1,
          strokes,
          ts,
        });
        return next;
      }).then(flush);
    },
    async complete() {
      // Drain any straggler writes first so the server sees the full grid.
      await flush();
      const shared = current?.shared;
      if (!shared) return { ok: false, error: 'not a shared round' };
      const res = await completeGame(shared.gameId, shared.participantToken);
      if (!res.ok) return { ok: false, error: res.error };
      await mutate((r) => applyCompleted(r));
      return { ok: true };
    },
    close() {
      closed = true;
      es?.close();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
