import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button, TagChip } from '../../ui/components';
import { getActiveRound } from '../../db';
import { courseById } from '../../data/courses';
import type { LocalRound } from '../../types';
import {
  fetchHuntItems,
  fetchHuntProgress,
  verifyFind,
  fileToUpload,
  type HuntItem,
  type HuntFind,
} from './api';

// §Phase 3 — AI scavenger hunt. Players snap a photo of a target item; the Node
// API proxies a vision model that verifies it, and confirmed finds are tracked
// per player and per group (the round's roster).
//
// The hunt is a *play-time* activity: it's only available while a round is in
// progress, so we don't invite people to wander the course during others' games.
// (Broadening it to the whole park is a possible later expansion.)

type ItemState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | {
      kind: 'result';
      verified: boolean;
      flagged?: boolean;
      reason?: string;
      // The player who actually took this shot, captured at submit time. The
      // live `selectedPlayer` can change while verification is in flight (the
      // group hands the phone around), so the congrats line must use this, not
      // the current selection — otherwise it credits the wrong person.
      playerTag: string;
      count?: number;
    };

// TESTING ONLY — remove before production. When VITE_HUNT_ALLOW_UPLOAD is
// 'true' at build time, we drop the `capture` hint on the file input so the
// picker also offers the phone's photo library (upload a saved image), not just
// the live camera. Unset in production so players must take a real photo.
const ALLOW_UPLOAD = import.meta.env.VITE_HUNT_ALLOW_UPLOAD === 'true';

export default function Hunt() {
  const navigate = useNavigate();
  // Intelligent back: return to wherever the hunt was opened from (e.g. the
  // scorecard passes its own path in navigation state) and fall back to Home
  // when opened directly or from the menu.
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from ?? '/';
  const [items, setItems] = useState<HuntItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [round, setRound] = useState<LocalRound | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [finds, setFinds] = useState<HuntFind[]>([]);
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  // Hints are hidden until the player asks — track which item hints are revealed.
  const [revealedHints, setRevealedHints] = useState<Set<string>>(new Set());

  function toggleHint(itemId: string) {
    setRevealedHints((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  // A single hidden file input drives the camera; captureItemId says which item
  // the next photo is for.
  const fileRef = useRef<HTMLInputElement>(null);
  const captureItemId = useRef<string | null>(null);

  // The hunt identifies a player solely by tag (that's all the server stores),
  // so collapse any duplicate tags to a single chip — two "ABC" players are one
  // hunt identity, and showing two chips just double-highlights on select.
  const players = useMemo(
    () => [...new Set(round?.playerTags ?? [])],
    [round],
  );
  const roundClientId = round?.clientId ?? null;
  const course = round ? courseById(round.courseId) : undefined;

  // Load the active round first (the hunt is gated on it), then items.
  useEffect(() => {
    void (async () => {
      try {
        const activeRound = await getActiveRound();
        setRound(activeRound ?? null);
        if (activeRound) {
          setSelectedPlayer(activeRound.playerTags[0]);
          // The item list is scoped to the round's course (one list per course).
          setItems(await fetchHuntItems(activeRound.courseId));
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load the hunt');
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Refresh a group's progress whenever we have a round to key on.
  const refreshProgress = useMemo(
    () => async () => {
      if (!roundClientId) return;
      try {
        setFinds(await fetchHuntProgress(roundClientId));
      } catch {
        // Non-fatal — verification still works; progress just won't refresh.
      }
    },
    [roundClientId],
  );

  useEffect(() => {
    void refreshProgress();
  }, [refreshProgress]);

  // itemId -> tags of players who've found it (from group progress).
  const foundBy = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const f of finds) {
      if (!map.has(f.itemId)) map.set(f.itemId, new Set());
      map.get(f.itemId)!.add(f.playerTag);
    }
    return map;
  }, [finds]);

  // itemId -> (playerTag -> how many they've found). Only meaningful for
  // countable items, where a player can rack up more than one.
  const findCounts = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const f of finds) {
      let byPlayer = map.get(f.itemId);
      if (!byPlayer) map.set(f.itemId, (byPlayer = new Map()));
      byPlayer.set(f.playerTag, (byPlayer.get(f.playerTag) ?? 0) + 1);
    }
    return map;
  }, [finds]);

  function onSnapClick(itemId: string) {
    captureItemId.current = itemId;
    fileRef.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    const itemId = captureItemId.current;
    captureItemId.current = null;
    // Snapshot who's playing NOW — this is the finder for this shot. The
    // selection can change before the async verify returns; the server is told
    // this tag, so the UI result must report the same one.
    const playerTag = selectedPlayer;
    if (!file || !itemId || !round || !roundClientId || !playerTag) return;

    setItemStates((s) => ({ ...s, [itemId]: { kind: 'verifying' } }));
    try {
      const { base64, mediaType } = await fileToUpload(file);
      const result = await verifyFind({
        itemId,
        courseId: round.courseId,
        playerTag,
        roundClientId,
        imageBase64: base64,
        mediaType,
      });
      setItemStates((s) => ({
        ...s,
        [itemId]: {
          kind: 'result',
          verified: result.verified,
          flagged: result.flagged,
          reason: result.alreadyFound ? 'Already found.' : result.reason,
          playerTag,
          count: result.count,
        },
      }));
      if (result.verified) void refreshProgress();
    } catch (err) {
      setItemStates((s) => ({
        ...s,
        [itemId]: {
          kind: 'result',
          verified: false,
          reason: err instanceof Error ? err.message : 'Verification failed',
          playerTag,
        },
      }));
    }
  }

  // Gate: the hunt is only available during an in-progress round.
  if (loaded && !round) {
    return (
      <Screen>
        <TopBar title="Scavenger hunt" back={backTo} />
        <Content>
          <div className="mt-10 text-center">
            <div className="text-5xl">🔍</div>
            <h2 className="mt-3 text-xl font-bold text-fairway-50">
              Start a round to play
            </h2>
            <p className="mx-auto mt-2 max-w-xs text-sm text-fairway-100/70">
              The scavenger hunt runs alongside your game — begin a round and it'll be
              ready for your group on the course.
            </p>
            <div className="mt-6">
              <Button onClick={() => navigate('/new')}>Start new round</Button>
            </div>
          </div>
        </Content>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Scavenger hunt" back={backTo} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        // TESTING: when uploads are allowed, omit `capture` so the OS offers the
        // photo library too; otherwise force the rear camera as in production.
        capture={ALLOW_UPLOAD ? undefined : 'environment'}
        className="hidden"
        onChange={onFileChosen}
      />
      <Content>
        <p className="mb-4 text-sm text-fairway-100/70">
          {course ? (
            <>
              Things to find on <span className="font-semibold text-fairway-50">{course.name}</span>.
              Snap a photo of each — we'll check it and mark it off.
            </>
          ) : (
            <>Find each thing on the course and snap a photo. We'll check it and mark it off.</>
          )}
        </p>

        {/* Who's playing — pick from the round roster. */}
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fairway-400">
            Playing as
          </div>
          <div className="flex flex-wrap gap-2">
            {players.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedPlayer(tag)}
                className={`rounded-lg p-1 transition ${
                  selectedPlayer === tag
                    ? 'ring-2 ring-fairway-400'
                    : 'opacity-60 active:opacity-100'
                }`}
                aria-pressed={selectedPlayer === tag}
              >
                <TagChip tag={tag} />
              </button>
            ))}
          </div>
        </div>

        {loadError && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {loadError}
          </div>
        )}

        {!items && !loadError && (
          <p className="text-sm text-fairway-100/70">Loading…</p>
        )}

        <ul className="space-y-3">
          {items?.map((item) => {
            const finders = foundBy.get(item.id);
            const state = itemStates[item.id] ?? { kind: 'idle' };
            const foundByMe = finders?.has(selectedPlayer) ?? false;
            const myCount = item.countable
              ? findCounts.get(item.id)?.get(selectedPlayer) ?? 0
              : 0;
            const hintShown = revealedHints.has(item.id);
            // Countable items stay snappable so you can keep finding more; one-off
            // items lock once you've found them.
            const canSnap = item.countable || !foundByMe;
            return (
              <li
                key={item.id}
                className={`rounded-2xl border p-4 ${
                  foundByMe
                    ? 'border-fairway-500/60 bg-fairway-900/60'
                    : 'border-fairway-800/60 bg-fairway-950/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-fairway-50">{item.name}</span>
                      {item.countable
                        ? myCount > 0 && (
                            <span className="rounded-full bg-fairway-500/20 px-2 py-0.5 text-xs font-bold text-fairway-300">
                              ×{myCount}
                            </span>
                          )
                        : foundByMe && <span className="text-fairway-400">✓</span>}
                    </div>
                    {item.hint && (
                      <div className="mt-1">
                        <button
                          onClick={() => toggleHint(item.id)}
                          aria-expanded={hintShown}
                          className="text-xs font-semibold text-fairway-400 active:opacity-70"
                        >
                          {hintShown ? 'Hide hint' : '💡 Hint'}
                        </button>
                        {hintShown && (
                          <div className="mt-1 text-xs text-fairway-100/70">{item.hint}</div>
                        )}
                      </div>
                    )}
                    {finders && finders.size > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-fairway-100/70">
                          Found by
                        </span>
                        {[...finders].map((t) => (
                          <span key={t} className="scale-75 origin-left">
                            <TagChip tag={t} />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onSnapClick(item.id)}
                    disabled={state.kind === 'verifying' || !canSnap}
                    className="shrink-0 rounded-xl bg-fairway-700 px-4 py-2 text-sm font-semibold text-fairway-50 transition active:scale-[0.98] active:bg-fairway-800 disabled:opacity-40 disabled:active:scale-100"
                  >
                    {state.kind === 'verifying'
                      ? 'Checking…'
                      : item.countable
                        ? myCount > 0
                          ? '📷 Snap another'
                          : '📷 Snap'
                        : foundByMe
                          ? 'Found'
                          : '📷 Snap'}
                  </button>
                </div>

                {state.kind === 'result' && (
                  <div
                    className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                      state.verified
                        ? 'bg-fairway-500/15 text-fairway-200'
                        : state.flagged
                          ? 'bg-amber-500/15 text-amber-200'
                          : 'bg-fairway-800/40 text-fairway-100/70'
                    }`}
                  >
                    {state.verified
                      ? item.countable
                        ? `Nice — that's ${state.count ?? myCount} for ${state.playerTag}!`
                        : `Nice — ${state.playerTag} found it!`
                      : state.flagged
                        ? "That looks like a photo of a screen — take a real one."
                        : state.reason || 'Not quite — try again.'}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Content>
    </Screen>
  );
}
