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
  applyOwnEcho,
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

  /** Push everything queued for this game; delivered writes leave the outbox.
   *  Loops until the outbox is empty so edits made while a POST was in flight
   *  are drained too — otherwise a tap landing mid-request would sit in
   *  IndexedDB until the next online/visibility event. */
  let flushRequested = false;
  async function flush(): Promise<void> {
    if (closed || !navigator.onLine) return;
    if (flushing) {
      // A drain is running — have it re-check the outbox before it exits.
      flushRequested = true;
      return;
    }
    flushing = true;
    try {
      do {
        flushRequested = false;
        const shared = current?.shared;
        if (!shared) return;
        const pending = await getOutbox(shared.gameId);
        if (pending.length === 0) continue; // exits unless another drain was requested
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
        // token was revoked): clear this batch and loop for anything that
        // queued during the POST. Transient failures keep the queue for the
        // next trigger.
        if (res.ok || res.status === 409 || res.status === 401) {
          await clearOutbox(pending.map((p) => p.key));
          flushRequested = true;
        } else {
          return;
        }
      } while (flushRequested);
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
        // Our own echoes adopt the server's stored (possibly ts-clamped)
        // value verbatim; everyone else's writes go through the LWW gate.
        cell.by === r.shared?.participantToken ? applyOwnEcho(r, cell) : applyRemoteCell(r, cell),
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
      // Enqueue AFTER the state mutation resolves and AWAIT it before
      // flushing, so a running drain's outbox re-read can never miss it.
      void mutate((r) => applyLocalStroke(r, slot, holeIdx, strokes, ts))
        .then(() =>
          enqueueOutbox({
            gameId: gameIdFromClientId(clientId),
            slot,
            hole: holeIdx + 1,
            strokes,
            ts,
          }),
        )
        .then(flush);
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
