import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button, TagChip } from '../../ui/components';
import CourseTheme from '../../ui/CourseTheme';
import { accentInk } from '../../lib/theme';
import { courseById } from '../../data/courses';
import { getRound, putRound } from '../../db';
import type { LocalRound } from '../../types';
import {
  HOLE_COUNT,
  STROKE_CAP,
  STROKE_CAP_ENABLED,
  clampStrokes,
  isRoundComplete,
} from '../../lib/scoring';
import { playClick, playStroke, playUndo, playCup } from '../../lib/sound';
import { openSharedRound, type SharedHandle, type SharedStatus } from '../../sync/shared';
import { LivePill } from '../shared/Lobby';
import { DEV_MODE } from '../../lib/flags';

// Testing aid — the gap between simulated button taps. The auto-player drives
// the real +/Next handlers one tap per tick, so each tap fires its sound; the
// pace is how far apart those taps (and their sounds) land.
const AUTO_PLAY_MS = 500; // slow pace — half a second per tap
const FAST_FORWARD_MS = 62.5; // fast pace — a sixteenth of a second per tap

// Placeholder for a cell with no score yet: a large ghosted dot (a golf ball,
// if you squint). Reads as "blank scorecard paper" rather than data, so
// entered numbers stay the only things that look like scores.
function ScoreWatermark({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-3 w-3 rounded-full bg-current ${className}`} />;
}

// A plausible-but-random stroke count for a hole, biased toward its par and
// kept inside the sane/cap range. Used only by the auto-play testing tool.
function randomStrokes(par: number): number {
  const max = STROKE_CAP_ENABLED ? STROKE_CAP : par + 3;
  return clampStrokes(1 + Math.floor(Math.random() * max));
}

// §5.1 step 3 — the play screen. Demo flow: instead of a page per hole, the
// whole scorecard is one horizontally scrolling sheet — a hole-label row with
// every player's scores aligned in columns beneath it, like a paper card. The
// current hole's column is highlighted and kept centered; swipe (or tap a
// label) to move around the course, and "Next" advances for you. The pinned
// −/+ keys only ever edit the highlighted column; every edit persists to
// IndexedDB immediately (offline-first).
export default function Scorecard() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [round, setRound] = useState<LocalRound | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hole, setHole] = useState(0); // 0-based index
  // Testing aid: auto-play walks the course, randomly scoring every player on
  // each hole and advancing to the end. Pause/stop halts it mid-course.
  // `fastForward` runs the same hole-by-hole walk with no delay between holes.
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [fastForward, setFastForward] = useState(false);
  // Per-player nonce that only advances on an actual stroke edit. The score
  // number is keyed on it so the pop animation re-runs on a bump but NOT when
  // navigating between holes (which merely changes the displayed value).
  const [pops, setPops] = useState<Record<number, number>>({});
  // Shared-game live sync: connection status for the header pill, and the
  // manager handle local taps route through (it serializes local + remote
  // mutations so neither clobbers the other).
  const [sharedStatus, setSharedStatus] = useState<SharedStatus>('offline');
  const sharedHandleRef = useRef<SharedHandle | null>(null);
  // Horizontal hole strip: the scroller, one ref per hole cell, and the
  // scroll-settle timer that turns a finished swipe into a selection.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const scrollIdleRef = useRef<number | undefined>(undefined);
  // Swipe-to-select only arms on real user input on the strip. Programmatic
  // moves (tapping a hole, "Next", auto-play) disarm it so the smooth scroll
  // they trigger can't re-select an intermediate hole mid-flight.
  const scrollSelectArmedRef = useRef(false);

  useEffect(() => {
    void getRound(clientId).then((r) => {
      if (!r) {
        setNotFound(true);
        return;
      }
      setRound(r);
      // Resume at the first unfinished hole for the first player.
      const firstEmpty = (r.scores[0] ?? []).findIndex((s) => s == null);
      setHole(firstEmpty === -1 ? 0 : firstEmpty);
    });
  }, [clientId]);

  // Arriving from the setup screen's auto-play button carries a mode in the
  // navigation state; kick off the same walk here so the test runs straight
  // through from character creation to the final hole. Fires once, and only
  // after the round has loaded so we can skip an already-finished round.
  const autoStartRef = useRef(false);
  useEffect(() => {
    if (autoStartRef.current || !round) return;
    const mode = (location.state as { autoPlay?: 'slow' | 'fast' } | null)?.autoPlay;
    if (!mode) return;
    autoStartRef.current = true;
    // Consume the transient flag so a browser reload or Back — which remounts
    // this screen against the same history entry — can't relaunch auto-play
    // (and re-score) a round that's already been played.
    navigate(location.pathname, { replace: true, state: null });
    // A reload of an already-finished round lands here with a stale flag; only
    // walk a round that still has holes left to score.
    if (isRoundComplete(round.scores, round.playerTags.length)) return;
    setFastForward(mode === 'fast');
    setAutoPlaying(true);
  }, [round, location.state, location.pathname, navigate]);

  // Shared rounds: open the live-sync manager once the round has loaded and
  // identified itself as shared; remote updates land via setRound.
  const isShared = !!round?.shared;
  useEffect(() => {
    if (!isShared) return;
    const handle = openSharedRound(clientId, setRound, setSharedStatus);
    sharedHandleRef.current = handle;
    return () => {
      handle.close();
      sharedHandleRef.current = null;
    };
  }, [isShared, clientId]);

  const course = round ? courseById(round.courseId) : undefined;

  // Latest scores, readable from the timer callback.
  const roundRef = useRef(round);
  roundRef.current = round;

  // Per-hole random stroke goals for the auto-player. Regenerated whenever it
  // arrives at a new hole so each hole gets a fresh random score per player.
  const targetsRef = useRef<{ hole: number; targets: number[] }>({ hole: -1, targets: [] });

  // Auto-play tick — ONE simulated tap per interval, so every tap plays its
  // real sound. Each tick taps "+" for the next player still short of their
  // random goal; once all players are there it taps "Next" (or stops at the
  // end). Re-arms on every stroke (`round`) and hole change, so taps keep
  // flowing; the delay between them is the chosen pace.
  useEffect(() => {
    if (!autoPlaying || !round || !course) return;
    const delay = fastForward ? FAST_FORWARD_MS : AUTO_PLAY_MS;
    const id = window.setTimeout(() => {
      const prev = roundRef.current;
      if (!prev) return;
      // Fresh random goals when we land on a new hole.
      if (targetsRef.current.hole !== hole) {
        targetsRef.current = {
          hole,
          targets: prev.playerTags.map(() => randomStrokes(course.pars[hole])),
        };
      }
      const { targets } = targetsRef.current;
      // The next player still below their goal gets one "+" tap.
      const p = prev.playerTags.findIndex(
        (_t, i) => (prev.scores[i]?.[hole] ?? 0) < targets[i],
      );
      if (p !== -1) {
        bump(p, +1); // real "+": plays the stroke sound, pops, persists
        return;
      }
      // Every player has reached their score → tap through to the next hole.
      if (hole < HOLE_COUNT - 1) {
        goNext(); // real "Next": plays the cup sound and advances
      } else {
        setAutoPlaying(false); // reached the end
        setFastForward(false);
      }
    }, delay);
    return () => window.clearTimeout(id);
    // `course` excluded (stable per round); `bump`/`goNext` are stable enough
    // for this testing loop and re-created each render with fresh state anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlaying, fastForward, hole, round]);

  // Keep the highlighted hole centered in the strip. Instant on first load
  // (resuming mid-round shouldn't animate from hole 1), smooth afterwards.
  const hasRound = !!round;
  const centeredOnceRef = useRef(false);
  useEffect(() => {
    if (!hasRound) return;
    const cell = cellRefs.current[hole];
    // scrollIntoView is missing in jsdom; optional-call keeps tests happy.
    cell?.scrollIntoView?.({
      behavior: centeredOnceRef.current ? 'smooth' : 'auto',
      inline: 'center',
      block: 'nearest',
    });
    centeredOnceRef.current = true;
  }, [hole, hasRound]);

  // Clear any pending scroll-settle timer on unmount.
  useEffect(() => () => window.clearTimeout(scrollIdleRef.current), []);

  if (notFound) {
    return (
      <Screen>
        <TopBar title="Round" back="/" />
        <Content>
          <p className="text-fairway-100/70">That round no longer exists.</p>
        </Content>
      </Screen>
    );
  }
  if (!round || !course) return null;

  const par = course.pars[hole];
  const ink = accentInk(course.theme);
  // The current hole's column wash — the course accent thinned way down, so
  // the highlight reads as a marker stripe on the card, not a button.
  const columnTint = `color-mix(in srgb, ${course.accent} 18%, transparent)`;
  const holeName = course.holeNames?.[hole];
  const complete = isRoundComplete(round.scores, round.playerTags.length);
  // Every player must have a score on the current hole before advancing, so a
  // hole is never left half-scored by moving on.
  const currentHoleScored = round.playerTags.every((_t, p) => round.scores[p]?.[hole] != null);

  // Persist a single stroke edit (§5.1: persist on every edit). Shared rounds
  // route through the sync manager instead — it stamps the LWW metadata,
  // queues the write for the server, and echoes the new round back via
  // setRound; anyone in the group can edit any player's row.
  async function setStroke(playerIndex: number, value: number | null) {
    if (sharedHandleRef.current) {
      sharedHandleRef.current.applyLocal(playerIndex, hole, value);
      return;
    }
    setRound((prev) => {
      if (!prev) return prev;
      const row = [...(prev.scores[playerIndex] ?? Array(HOLE_COUNT).fill(null))];
      row[hole] = value;
      const next: LocalRound = {
        ...prev,
        scores: { ...prev.scores, [playerIndex]: row },
      };
      void putRound(next);
      return next;
    });
  }

  // Re-run the score-pop animation for one player after a real stroke edit.
  function popScore(playerIndex: number) {
    setPops((prev) => ({ ...prev, [playerIndex]: (prev[playerIndex] ?? 0) + 1 }));
  }

  function bump(playerIndex: number, delta: number) {
    const current = round!.scores[playerIndex]?.[hole] ?? null;
    // No auto-fill: an empty hole starts blank. First + registers 1; − does
    // nothing until there's a value to decrement.
    if (current == null) {
      if (delta > 0) {
        playStroke();
        popScore(playerIndex);
        void setStroke(playerIndex, 1);
      }
      return;
    }
    const next = clampStrokes(current + delta);
    // Only sound/animate an actual change (a bump at the cap/floor is a no-op).
    if (next !== current) {
      if (delta > 0) playStroke();
      else playUndo();
      popScore(playerIndex);
    }
    void setStroke(playerIndex, next);
  }

  // Advance to the next hole with the satisfying "into the cup" sound.
  function goNext() {
    playCup();
    scrollSelectArmedRef.current = false; // programmatic move — see armed ref
    setHole((h) => Math.min(HOLE_COUNT - 1, h + 1));
  }

  // Tap a hole cell to jump straight to it.
  function selectHole(h: number) {
    if (h === hole) return;
    playClick();
    scrollSelectArmedRef.current = false; // programmatic move — see armed ref
    setHole(h);
  }

  // The hole whose cell center sits closest to the strip's visible center.
  function nearestHole(): number {
    const strip = stripRef.current;
    if (!strip) return hole;
    const center = strip.scrollLeft + strip.clientWidth / 2;
    let best = hole;
    let bestDist = Infinity;
    cellRefs.current.forEach((el, i) => {
      if (!el) return;
      const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  // A user swipe settles → the hole nearest center becomes the current hole
  // (the centering effect then magnetically snaps it the rest of the way).
  function onStripScroll() {
    window.clearTimeout(scrollIdleRef.current);
    scrollIdleRef.current = window.setTimeout(() => {
      if (!scrollSelectArmedRef.current) return;
      const h = nearestHole();
      if (h !== hole) setHole(h);
      else {
        // Already on the nearest hole — still nudge it back to center so a
        // small drag doesn't leave the strip resting between holes.
        cellRefs.current[h]?.scrollIntoView?.({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest',
        });
      }
    }, 140);
  }

  // Real user input on the strip arms swipe-to-select.
  function armScrollSelect() {
    scrollSelectArmedRef.current = true;
  }

  return (
    <CourseTheme theme={course.theme} accent={course.accent}>
    <Screen>
      <TopBar
        title={course.name}
        back="/"
        right={
          <div className="flex items-center gap-1">
            {/* Shared game: live-connection pill (tap targets stay elsewhere). */}
            {round.shared && <LivePill status={sharedStatus} />}
            {/* Jump to the scavenger hunt, carrying where we came from so its
                back button returns here rather than to Home (§Phase 3). */}
            <button
              onClick={() => navigate('/golf/hunt', { state: { from: `/golf/play/${clientId}` } })}
              className="rounded-lg px-2 py-2 text-lg leading-none active:bg-fairway-800"
              aria-label="Scavenger hunt"
              title="Scavenger hunt"
            >
              🔍
            </button>
            {/* Challenge spinner — a quick group dare while waiting your turn;
                carries the course so the wheel uses that course's themed set,
                and returns here on back (§12). */}
            <button
              onClick={() =>
                navigate('/arcade/spinner', {
                  state: { from: `/golf/play/${clientId}`, courseId: round.courseId },
                })
              }
              className="rounded-lg px-2 py-2 text-lg leading-none active:bg-fairway-800"
              aria-label="Challenge spinner"
              title="Challenge spinner"
            >
              🎡
            </button>
          </div>
        }
      />

      <Content>
        {/* Hole header — hole label on the left, par medallion on the right. */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            {holeName ? (
              <>
                <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
                  Hole {hole + 1}
                </div>
                <div className="text-3xl font-black text-fairway-50">{holeName}</div>
              </>
            ) : (
              <>
                <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
                  Hole
                </div>
                <div className="text-3xl font-black text-fairway-50">{hole + 1}</div>
              </>
            )}
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
              Par
            </div>
            {/* Par medallion — a raised disc so the target reads as a physical
                token rather than a loose number. */}
            <div
              className="surface-1 flex h-12 w-12 items-center justify-center rounded-full text-2xl font-black"
              style={{ color: ink }}
            >
              {par}
            </div>
          </div>
        </div>

        {/* The scorecard sheet — hole labels sit directly above the scoring,
            and every player's scores line up in columns beneath them, like a
            paper scorecard. The sheet scrolls horizontally as one unit (labels
            and score rows together); the current hole's column is highlighted
            and kept centered. Swipe to browse, tap a hole label to jump — but
            the pinned −/+ keys only ever edit the highlighted column. Tags
            stay pinned on the left so you always know whose row is whose. */}
        <div className="flex items-stretch gap-2">
          {/* Pinned left rail: spacer over the label row, then player tags.
              Rows are flush (no gaps) so they track the ruled grid rows. */}
          <div className="flex shrink-0 flex-col">
            <div className="h-9" aria-hidden />
            {round.playerTags.map((tag, p) => (
              <div key={p} className="flex h-12 items-center">
                <TagChip tag={tag} color={course.accent} />
              </div>
            ))}
          </div>

          {/* Pinned − keys: always edit the current (highlighted) hole. */}
          <div className="flex shrink-0 flex-col">
            <div className="h-9" aria-hidden />
            {round.playerTags.map((tag, p) => {
              const strokes = round.scores[p]?.[hole] ?? null;
              return (
                <div key={p} className="flex h-12 items-center">
                  <button
                    onClick={() => bump(p, -1)}
                    disabled={autoPlaying || strokes == null || strokes <= 1}
                    className="key flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-2xl font-bold text-fairway-100 disabled:opacity-30 disabled:shadow-none"
                    aria-label={`Decrease strokes for ${tag}`}
                  >
                    −
                  </button>
                </div>
              );
            })}
          </div>

          {/* The sheet itself — one scroll container so the label row and
              every score row move together and columns stay aligned. */}
          <div
            ref={stripRef}
            onScroll={onStripScroll}
            onPointerDown={armScrollSelect}
            onTouchStart={armScrollSelect}
            onWheel={armScrollSelect}
            className="relative flex-1 overflow-x-auto"
            style={{ scrollbarWidth: 'none' }}
          >
            {/* Ruled like a paper card: thin lines between every row and
                column (divide-*), cells flush with no chrome of their own.
                The current hole is a tinted column running down the sheet
                rather than a highlighted button. The inline padding leaves
                half a viewport of lead-in/out (minus half a cell, 1.5rem) so
                the first and last holes can reach dead center too — without
                it, a tiny scroll on hole 1 would select hole 2 or 3, since
                hole 1's cell could never be the one nearest center. The
                percentage resolves against the scroller's visible width. */}
            <div
              className="w-max divide-y divide-fairway-700/40"
              style={{ paddingInline: 'calc(50% - 1.5rem)' }}
            >
              {/* Hole label row. */}
              <div role="tablist" aria-label="Holes" className="flex divide-x divide-fairway-700/40">
                {Array.from({ length: HOLE_COUNT }, (_, h) => {
                  const active = h === hole;
                  return (
                    <button
                      key={h}
                      ref={(el) => {
                        cellRefs.current[h] = el;
                      }}
                      onClick={() => selectHole(h)}
                      role="tab"
                      aria-selected={active}
                      aria-label={`Hole ${h + 1}`}
                      className={`flex h-9 w-12 shrink-0 items-center justify-center text-base ${
                        active ? 'font-black' : 'font-semibold text-fairway-300'
                      }`}
                      style={active ? { color: ink, backgroundColor: columnTint } : undefined}
                    >
                      {h + 1}
                    </button>
                  );
                })}
              </div>

              {/* One score row per player, columns aligned under the labels.
                  Only the highlighted column is live (it carries the status
                  role and the punch animation); the rest is the read-only
                  rest of the scorecard. */}
              {round.playerTags.map((tag, p) => (
                <div key={p} className="flex divide-x divide-fairway-700/40">
                  {Array.from({ length: HOLE_COUNT }, (_, h) => {
                    const strokes = round.scores[p]?.[h] ?? null;
                    const active = h === hole;
                    return (
                      <div
                        key={h}
                        role={active ? 'status' : undefined}
                        aria-label={active ? `Strokes for ${tag}` : undefined}
                        className="flex h-12 w-12 shrink-0 items-center justify-center"
                        style={active ? { backgroundColor: columnTint } : undefined}
                      >
                        {strokes == null ? (
                          // No score yet — the ghosted dot, a shade brighter
                          // in the live column.
                          <ScoreWatermark
                            className={
                              active ? 'text-fairway-50 opacity-30' : 'text-fairway-100 opacity-15'
                            }
                          />
                        ) : active ? (
                          // Keyed on a per-player nonce that only changes on a
                          // real stroke edit, so the punch fires on +/− but not
                          // when the highlight moves between holes.
                          <span
                            key={pops[p] ?? 0}
                            className="animate-score-punch inline-block text-2xl font-black text-fairway-50"
                          >
                            {strokes}
                          </span>
                        ) : (
                          <span className="text-lg font-bold text-fairway-200">{strokes}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Pinned + keys: always edit the current (highlighted) hole. */}
          <div className="flex shrink-0 flex-col">
            <div className="h-9" aria-hidden />
            {round.playerTags.map((tag, p) => {
              const strokes = round.scores[p]?.[hole] ?? null;
              return (
                <div key={p} className="flex h-12 items-center">
                  <button
                    onClick={() => bump(p, +1)}
                    disabled={
                      autoPlaying || (STROKE_CAP_ENABLED && strokes != null && strokes >= STROKE_CAP)
                    }
                    className="key flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-2xl font-bold text-fairway-100 disabled:opacity-30 disabled:shadow-none"
                    aria-label={`Increase strokes for ${tag}`}
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Hole navigation — going back (or skipping around) is a swipe on the
            strip; the one button drives the forward flow. */}
        <div className="mt-6 flex gap-3">
          {hole < HOLE_COUNT - 1 ? (
            <Button
              variant="ghost"
              sound="none"
              onClick={goNext}
              disabled={!currentHoleScored || autoPlaying}
            >
              Next ›
            </Button>
          ) : (
            <Button
              sound="cup"
              onClick={() => navigate(`/golf/play/${clientId}/summary`)}
              disabled={!complete || autoPlaying}
            >
              Finish
            </Button>
          )}
        </div>

        {/* Auto-play (testing, dev-mode only) — taps the real +/Next buttons
            across the whole course so their sounds fire in sequence. Play taps
            every half second; fast forward taps every sixteenth of a second.
            Either way, Pause stops mid-course. */}
        {DEV_MODE && (
        <div className="mt-3">
          {autoPlaying ? (
            <Button
              variant="danger"
              onClick={() => {
                setAutoPlaying(false);
                setFastForward(false);
              }}
            >
              ⏸ Pause
            </Button>
          ) : (
            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setFastForward(false);
                  setAutoPlaying(true);
                }}
                disabled={complete}
              >
                ▶ Auto play (test)
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFastForward(true);
                  setAutoPlaying(true);
                }}
                disabled={complete}
              >
                ⏭ Fast forward
              </Button>
            </div>
          )}
          {autoPlaying && (
            <p className="mt-2 text-center text-xs text-fairway-100/70">
              {fastForward ? 'Fast-forwarding' : 'Auto-playing'} hole {hole + 1} of {HOLE_COUNT}…
            </p>
          )}
        </div>
        )}

        {hole < HOLE_COUNT - 1 && !currentHoleScored && (
          <p className="mt-3 text-center text-xs text-fairway-100/70">
            Score every player on this hole to continue.
          </p>
        )}

        {hole === HOLE_COUNT - 1 && !complete && (
          <p className="mt-3 text-center text-xs text-fairway-100/70">
            Enter every hole for all players to finish.
          </p>
        )}

        {STROKE_CAP_ENABLED && (
          <p className="mt-6 text-center text-xs text-fairway-100/70">
            Max {STROKE_CAP} strokes per hole
          </p>
        )}
      </Content>
    </Screen>
    </CourseTheme>
  );
}
