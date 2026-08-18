import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button, TagChip } from '../../ui/components';
import CourseTheme from '../../ui/CourseTheme';
import { getActiveRound } from '../../db';
import { courseById, locationById } from '../../data/courses';
import { useCurrentLocationId } from '../../lib/location';
import type { LocalRound } from '../../types';
import { DEV_MODE } from '../../lib/flags';
import {
  fetchHuntItems,
  fetchHuntProgress,
  verifyFind,
  fileToUpload,
  shareFindPhoto,
  type HuntItem,
  type HuntFind,
  type HuntOwner,
} from './api';
import VenueHuntStart from './VenueHuntStart';
import Icon from '../../ui/Icon';
import {
  endVenueHuntSession,
  getVenueHuntSession,
  type VenueHuntSession,
} from './venueSession';

// §Phase 3 — AI scavenger hunt. Players snap a photo of a target item; the Node
// API proxies a vision model that verifies it, and confirmed finds are tracked
// per player and per group.
//
// TWO MODES, one screen. What changes between them is only where the GROUP
// comes from and which list is being played:
//
//   'course'  the original. A play-time activity tied to an in-progress round:
//             the roster is the round's, the list is the course's, and you
//             can't start one without starting a game. Lives at /golf/hunt.
//   'venue'   the course-free hunt, for venues with no mini golf (and as a
//             park-wide extra at ones that have it). The group is a local
//             venue-hunt session the players start themselves (venueSession.ts)
//             and the list is the venue's. Lives at /hunt.
//
// Everything below the group — items, judging, progress, sharing — is identical,
// so both modes render this one component with a different `group`.
type HuntMode = 'course' | 'venue';

// The two modes' state, reduced to what the screen actually needs.
type HuntGroup = {
  /** The group key, sent as `roundClientId` in both modes. */
  key: string;
  /** Arcade tags of everyone in the group. */
  players: string[];
  /** Which list is being played. */
  owner: HuntOwner;
};

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

// Dev-mode affordance: drop the `capture` hint on the file input so the OS
// picker also offers the phone's photo library (upload a saved image), not just
// the live camera. In production (DEV_MODE off) `capture` forces the rear camera
// so players must take a real photo. Pairs with the server's
// HUNT_ALLOW_PHOTO_OF_PHOTO (see server/.env.example) for photo-of-photo checks.
const ALLOW_UPLOAD = DEV_MODE;

/**
 * The furthest hole anyone in the group has carded — where the group is
 * standing, not where it's headed.
 *
 * Deliberately NOT `furthest + 1`. Between carding the ninth and starting the
 * tenth a group is still on the ninth, and guessing forward there would report
 * hole 10 for a photo taken at the turn — costing a player a badge for
 * finishing the hunt exactly when the badge says to. Reporting the hole just
 * played resolves that boundary in the player's favour, and once the tenth is
 * carded it reads 10 correctly.
 *
 * Undefined when there's no round (the venue-wide hunt) or nothing is scored
 * yet — the server treats that as "unknown" rather than hole zero.
 */
function currentHole(round: LocalRound | null): number | undefined {
  if (!round) return undefined;
  let furthest = 0;
  for (const card of Object.values(round.scores)) {
    if (!card) continue;
    card.forEach((s, i) => {
      if (s != null) furthest = Math.max(furthest, i + 1);
    });
  }
  return furthest === 0 ? undefined : Math.min(18, furthest);
}

export default function Hunt({ mode = 'course' }: { mode?: HuntMode }) {
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
  const [session, setSession] = useState<VenueHuntSession | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [finds, setFinds] = useState<HuntFind[]>([]);
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  // Hints are hidden until the player asks — track which item hints are revealed.
  const [revealedHints, setRevealedHints] = useState<Set<string>>(new Set());
  // Which find's photo is currently being fetched for sharing.
  const [sharingFindId, setSharingFindId] = useState<string | null>(null);

  async function onSharePhoto(find: HuntFind, itemName: string) {
    if (!roundClientId || sharingFindId) return;
    setSharingFindId(find.id);
    try {
      await shareFindPhoto(find, roundClientId, itemName);
    } catch {
      // Photo unavailable (offline, or not yet approved) — quietly do nothing;
      // the button is best-effort sugar, not a gameplay path.
    } finally {
      setSharingFindId(null);
    }
  }

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

  // Venue mode plays the CURRENTLY SELECTED venue's list — the same venue the
  // rest of the app is pointed at (GPS-detected or picked by hand), so the
  // hunt can never drift onto another site's list.
  const currentLocationId = useCurrentLocationId();
  const venue = locationById(currentLocationId);
  const course = round ? courseById(round.courseId) : undefined;

  // The group, from whichever source this mode uses. Null until one exists:
  // no active round (course mode) or no started session (venue mode).
  const group: HuntGroup | null = useMemo(() => {
    if (mode === 'course') {
      return round
        ? { key: round.clientId, players: round.playerTags, owner: { courseId: round.courseId } }
        : null;
    }
    return session
      ? {
          key: session.clientId,
          players: session.playerTags,
          owner: { locationId: session.locationId },
        }
      : null;
  }, [mode, round, session]);

  // The hunt identifies a player solely by tag (that's all the server stores),
  // so collapse any duplicate tags to a single chip — two "ABC" players are one
  // hunt identity, and showing two chips just double-highlights on select.
  const players = useMemo(() => [...new Set(group?.players ?? [])], [group]);
  const roundClientId = group?.key ?? null;

  // Keep the "playing as" selection valid: pick the first player whenever the
  // current one isn't in the roster (initial load, or a new venue session with
  // a different roster).
  useEffect(() => {
    if (players.length > 0 && !players.includes(selectedPlayer)) {
      setSelectedPlayer(players[0]);
    }
  }, [players, selectedPlayer]);

  // Load the group, then its list.
  //
  // The two modes differ in whether the LIST depends on the GROUP. On a course
  // hunt it does — the list is the round's course's, so no round means nothing
  // to fetch. In venue mode the list is the venue's, independent of any
  // session, so it loads either way and the start screen can say how many
  // things there are to find before anyone commits.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      try {
        if (mode === 'course') {
          const activeRound = await getActiveRound();
          if (cancelled) return;
          setRound(activeRound ?? null);
          if (activeRound) {
            const list = await fetchHuntItems({ courseId: activeRound.courseId });
            if (!cancelled) setItems(list);
          }
        } else {
          setSession(getVenueHuntSession(currentLocationId));
          const list = await fetchHuntItems({ locationId: currentLocationId });
          if (!cancelled) setItems(list);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load the hunt');
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, currentLocationId]);

  // Refresh a group's progress whenever we have a group to key on.
  const refreshProgress = useCallback(async () => {
    if (!roundClientId) {
      setFinds([]);
      return;
    }
    try {
      setFinds(await fetchHuntProgress(roundClientId));
    } catch {
      // Non-fatal — verification still works; progress just won't refresh.
    }
  }, [roundClientId]);

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

  // itemId -> the group's sharable photos, one per player (their latest).
  // Countable items can pile up many finds per player; one share chip each
  // keeps the card sane.
  const sharablePerItem = useMemo(() => {
    const map = new Map<string, HuntFind[]>();
    for (const f of finds) {
      if (!f.sharable) continue;
      const list = map.get(f.itemId) ?? [];
      const existing = list.findIndex((x) => x.playerTag === f.playerTag);
      // Progress is ordered oldest-first, so a later row replaces the earlier.
      if (existing >= 0) list[existing] = f;
      else list.push(f);
      map.set(f.itemId, list);
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
    if (!file || !itemId || !group || !playerTag) return;

    setItemStates((s) => ({ ...s, [itemId]: { kind: 'verifying' } }));
    try {
      const { base64, mediaType } = await fileToUpload(file);
      const result = await verifyFind({
        itemId,
        owner: group.owner,
        playerTag,
        roundClientId: group.key,
        // Where the group is up to, for the "finished the hunt early" badge.
        // Undefined in venue mode (no round) and before the first score.
        hole: currentHole(round),
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

  // Gate (course mode): the on-course hunt is only available during a round.
  if (mode === 'course' && loaded && !round) {
    return (
      <Screen>
        <TopBar title="Scavenger hunt" back={backTo} />
        <Content>
          <div className="mt-10 text-center">
            <Icon name="nav.hunt" className="text-5xl" />
            <h2 className="mt-3 text-xl font-bold text-fairway-50">
              Start a round to play
            </h2>
            <p className="mx-auto mt-2 max-w-xs text-sm text-fairway-100/70">
              The scavenger hunt runs alongside your game — begin a round and it'll be
              ready for your group on the course.
            </p>
            <div className="mt-6">
              <Button onClick={() => navigate('/golf/new')}>Start new round</Button>
            </div>
          </div>
        </Content>
      </Screen>
    );
  }

  // Gate (venue mode): this venue doesn't run the course-free hunt. Reached by
  // typing /hunt or following a stale link — Home only shows the tile where
  // it's on — so it explains rather than 404s. An empty list counts as "not
  // offered": the server answers the same way for a venue that switched the
  // hunt off, and either way there's nothing to play.
  if (mode === 'venue' && loaded && !loadError && (items?.length ?? 0) === 0) {
    return (
      <Screen>
        <TopBar title="Scavenger hunt" back={backTo} />
        <Content>
          <div className="mt-10 text-center">
            <Icon name="nav.hunt" className="text-5xl" />
            <h2 className="mt-3 text-xl font-bold text-fairway-50">
              No hunt here yet
            </h2>
            <p className="mx-auto mt-2 max-w-xs text-sm text-fairway-100/70">
              {venue?.name ?? 'This venue'} isn't running a scavenger hunt right now.
              Check back soon!
            </p>
            <div className="mt-6">
              <Button onClick={() => navigate('/')}>Back to home</Button>
            </div>
          </div>
        </Content>
      </Screen>
    );
  }

  // Venue mode with a list but no group yet — collect the roster and mint a
  // session. (Course mode never lands here: its group arrives with the round.)
  // Skipped on a load error so the main screen can show it: inviting a group to
  // start a hunt we couldn't load the list for would strand them at an empty
  // board with no explanation.
  if (mode === 'venue' && loaded && !loadError && !group) {
    return (
      <VenueHuntStart
        backTo={backTo}
        venueName={venue?.name}
        accent={venue?.accent}
        itemCount={items?.length ?? 0}
        locationId={currentLocationId}
        onStarted={setSession}
      />
    );
  }

  return (
    // A venue hunt has no course to take its accent from, so it wears the
    // venue's own.
    <CourseTheme theme={course?.theme} accent={mode === 'venue' ? venue?.accent : course?.accent}>
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
        <p className="mb-1 text-sm text-fairway-100/70">
          {mode === 'venue' ? (
            <>
              Things to find around{' '}
              <span className="font-semibold text-fairway-50">{venue?.name ?? 'the park'}</span>.
              Snap a photo of each — we'll check it and mark it off.
            </>
          ) : course ? (
            <>
              Things to find on <span className="font-semibold text-fairway-50">{course.name}</span>.
              Snap a photo of each — we'll check it and mark it off.
            </>
          ) : (
            <>Find each thing on the course and snap a photo. We'll check it and mark it off.</>
          )}
        </p>
        {/* The photo pipeline's player-facing disclosure — photos go to an AI
            check and live on the venue server for a while (see /me/privacy). */}
        <p className="mb-4 text-xs text-fairway-100/80">
          Photos are checked by AI and stored so your group can share them.{' '}
          <Link to="/me/privacy" className="underline">
            How photos are handled
          </Link>
        </p>

        {/* Who's playing — the round roster, or the venue session's. */}
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
              Playing as
            </div>
            {/* Venue mode owns its own group, so it needs a way to end it —
                a round ends itself, but a venue session would otherwise
                outlive the visit and hand the next group the same tally.
                Local only: the finds themselves stay on the server. */}
            {mode === 'venue' && (
              <button
                onClick={() => {
                  endVenueHuntSession();
                  setSession(null);
                  setItemStates({});
                }}
                className="text-xs font-semibold text-fairway-100/70 underline active:opacity-70"
              >
                Finish hunt
              </button>
            )}
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
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-danger">
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
                  foundByMe ? 'surface border-fairway-500/60' : 'surface-1 border-fairway-800/60'
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
                          {hintShown ? (
                        'Hide hint'
                      ) : (
                        <>
                          <Icon name="action.hint" /> Hint
                        </>
                      )}
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
                    {/* Share the group's own photos (auto-moderation approved
                        only — the server refuses anything else). */}
                    {(sharablePerItem.get(item.id)?.length ?? 0) > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {sharablePerItem.get(item.id)!.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => void onSharePhoto(f, item.name)}
                            disabled={sharingFindId !== null}
                            className="surface-1 rounded-full border border-fairway-800/60 px-2.5 py-1 text-xs font-semibold text-fairway-200 transition-transform active:translate-y-px disabled:opacity-40"
                          >
                            {sharingFindId === f.id ? (
                          'Sharing…'
                        ) : (
                          <>
                            <Icon name="action.share" /> {f.playerTag}'s photo
                          </>
                        )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onSnapClick(item.id)}
                    disabled={state.kind === 'verifying' || !canSnap}
                    className="btn-accent shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-fairway-50 transition-transform active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0"
                  >
                    {state.kind === 'verifying'
                      ? 'Checking…'
                      : item.countable
                        ? myCount > 0
                          ? (
                              <>
                                <Icon name="action.take-photo" /> Snap another
                              </>
                            )
                          : (
                              <>
                                <Icon name="action.take-photo" /> Snap
                              </>
                            )
                        : foundByMe
                          ? 'Found'
                          : (
                              <>
                                <Icon name="action.take-photo" /> Snap
                              </>
                            )}
                  </button>
                </div>

                {state.kind === 'result' && (
                  <div
                    className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                      state.verified
                        ? 'bg-fairway-500/15 text-fairway-200'
                        : state.flagged
                          ? 'bg-amber-500/15 text-warning'
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
    </CourseTheme>
  );
}
