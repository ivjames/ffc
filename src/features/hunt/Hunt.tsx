import { useEffect, useMemo, useRef, useState } from 'react';
import { Screen, TopBar, Content, TagChip } from '../../ui/components';
import { getActiveRound } from '../../db';
import { sanitizeTagInput, isValidTag } from '../../lib/sanitize';
import type { LocalRound } from '../../types';
import {
  fetchHuntItems,
  fetchHuntProgress,
  verifyFind,
  fileToBase64,
  type HuntItem,
  type HuntFind,
} from './api';

// §Phase 3 — AI scavenger hunt. Players snap a photo of a target item; the Node
// API proxies a vision model that verifies it, and confirmed finds are tracked
// per player and per group (the round's roster).

type ItemState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'result'; verified: boolean; flagged?: boolean; reason?: string };

export default function Hunt() {
  const [items, setItems] = useState<HuntItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [round, setRound] = useState<LocalRound | null>(null);
  const [soloTag, setSoloTag] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [finds, setFinds] = useState<HuntFind[]>([]);
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});

  // A single hidden file input drives the camera; captureItemId says which item
  // the next photo is for.
  const fileRef = useRef<HTMLInputElement>(null);
  const captureItemId = useRef<string | null>(null);

  const players = round?.playerTags ?? [];
  const roundClientId = round?.clientId ?? null;

  // Load items + the active round (for the roster) on mount.
  useEffect(() => {
    void (async () => {
      try {
        const [loadedItems, activeRound] = await Promise.all([
          fetchHuntItems(),
          getActiveRound(),
        ]);
        setItems(loadedItems);
        setRound(activeRound ?? null);
        if (activeRound?.playerTags.length) {
          setSelectedPlayer(activeRound.playerTags[0]);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load the hunt');
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

  const activeTag = players.length ? selectedPlayer : soloTag;
  const canSnap = isValidTag(activeTag);

  function onSnapClick(itemId: string) {
    captureItemId.current = itemId;
    fileRef.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    const itemId = captureItemId.current;
    captureItemId.current = null;
    if (!file || !itemId) return;
    if (!isValidTag(activeTag)) return;

    setItemStates((s) => ({ ...s, [itemId]: { kind: 'verifying' } }));
    try {
      const { base64, mediaType } = await fileToBase64(file);
      const result = await verifyFind({
        itemId,
        playerTag: activeTag,
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
        },
      }));
    }
  }

  return (
    <Screen>
      <TopBar title="Scavenger hunt" back="/" />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileChosen}
      />
      <Content>
        <p className="mb-4 text-sm text-fairway-100/70">
          Find each thing on the course and snap a photo. We'll check it and mark it off.
        </p>

        {/* Who's playing — pick from the round roster, or enter a tag solo. */}
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fairway-400">
            Playing as
          </div>
          {players.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {players.map((tag, i) => (
                <button
                  key={i}
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
          ) : (
            <div>
              <input
                inputMode="text"
                autoCapitalize="characters"
                placeholder="ABC"
                value={soloTag}
                onChange={(e) => setSoloTag(sanitizeTagInput(e.target.value))}
                className="font-arcade w-24 rounded-lg border border-fairway-700 bg-fairway-900/60 px-3 py-2 text-center text-xl font-bold tracking-widest text-fairway-50 placeholder:text-fairway-100/30"
              />
              <p className="mt-1 text-xs text-fairway-100/50">
                Enter your 3-character tag, or start a round to play as a group.
              </p>
            </div>
          )}
        </div>

        {loadError && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {loadError}
          </div>
        )}

        {!items && !loadError && (
          <p className="text-sm text-fairway-100/50">Loading…</p>
        )}

        <ul className="space-y-3">
          {items?.map((item) => {
            const finders = foundBy.get(item.id);
            const state = itemStates[item.id] ?? { kind: 'idle' };
            const foundByMe = finders?.has(activeTag) ?? false;
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
                      {foundByMe && <span className="text-fairway-400">✓</span>}
                    </div>
                    {item.hint && (
                      <div className="mt-0.5 text-xs text-fairway-100/50">{item.hint}</div>
                    )}
                    {finders && finders.size > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-fairway-100/40">
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
                    disabled={!canSnap || state.kind === 'verifying' || foundByMe}
                    className="shrink-0 rounded-xl bg-fairway-500 px-4 py-2 text-sm font-semibold text-fairway-950 transition active:scale-[0.98] active:bg-fairway-400 disabled:opacity-40 disabled:active:scale-100"
                  >
                    {state.kind === 'verifying' ? 'Checking…' : foundByMe ? 'Found' : '📷 Snap'}
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
                      ? `Nice — ${activeTag} found it!`
                      : state.flagged
                        ? "That looks like a photo of a screen — take a real one."
                        : state.reason || 'Not quite — try again.'}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {!canSnap && items && (
          <p className="mt-4 text-center text-xs text-fairway-100/40">
            Pick who's playing to start snapping.
          </p>
        )}
      </Content>
    </Screen>
  );
}
