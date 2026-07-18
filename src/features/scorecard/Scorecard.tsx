import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
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

// Testing aid — the gap between simulated button taps. The auto-player drives
// the real +/Next handlers one tap per tick, so each tap fires its sound; the
// pace is how far apart those taps (and their sounds) land.
const AUTO_PLAY_MS = 500; // slow pace — half a second per tap
const FAST_FORWARD_MS = 62.5; // fast pace — a sixteenth of a second per tap

// A plausible-but-random stroke count for a hole, biased toward its par and
// kept inside the sane/cap range. Used only by the auto-play testing tool.
function randomStrokes(par: number): number {
  const max = STROKE_CAP_ENABLED ? STROKE_CAP : par + 3;
  return clampStrokes(1 + Math.floor(Math.random() * max));
}

// §5.1 step 3 — the play screen. One hole at a time; per-hole entry for all
// players; par for the current hole; stroke cap; hole navigation and
// edit; every edit persists to IndexedDB immediately (offline-first).
export default function Scorecard() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [round, setRound] = useState<LocalRound | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hole, setHole] = useState(0); // 0-based index
  const [showJump, setShowJump] = useState(false);
  // Testing aid: auto-play walks the course, randomly scoring every player on
  // each hole and advancing to the end. Pause/stop halts it mid-course.
  // `fastForward` runs the same hole-by-hole walk with no delay between holes.
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [fastForward, setFastForward] = useState(false);
  // Per-player nonce that only advances on an actual stroke edit. The score
  // number is keyed on it so the pop animation re-runs on a bump but NOT when
  // navigating between holes (which merely changes the displayed value).
  const [pops, setPops] = useState<Record<number, number>>({});

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
  // through from character creation to the final hole. Guarded to fire once.
  const autoStartRef = useRef(false);
  useEffect(() => {
    const mode = (location.state as { autoPlay?: 'slow' | 'fast' } | null)?.autoPlay;
    if (!mode || autoStartRef.current) return;
    autoStartRef.current = true;
    setFastForward(mode === 'fast');
    setAutoPlaying(true);
  }, [location.state]);

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
  const holeName = course.holeNames?.[hole];
  const complete = isRoundComplete(round.scores, round.playerTags.length);
  // Every player must have a score on the current hole before advancing, so a
  // hole is never left half-scored by moving on.
  const currentHoleScored = round.playerTags.every((_t, p) => round.scores[p]?.[hole] != null);

  // Persist a single stroke edit (§5.1: persist on every edit).
  async function setStroke(playerIndex: number, value: number | null) {
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
    setHole((h) => Math.min(HOLE_COUNT - 1, h + 1));
  }

  return (
    <CourseTheme theme={course.theme} accent={course.accent}>
    <Screen>
      <TopBar
        title={course.name}
        back="/"
        right={
          <div className="flex items-center gap-1">
            {/* Jump to the scavenger hunt, carrying where we came from so its
                back button returns here rather than to Home (§Phase 3). */}
            <button
              onClick={() => navigate('/hunt', { state: { from: `/play/${clientId}` } })}
              className="rounded-lg px-2 py-2 text-lg leading-none active:bg-fairway-800"
              aria-label="Scavenger hunt"
              title="Scavenger hunt"
            >
              🔍
            </button>
            <button
              onClick={() => {
                playClick();
                setShowJump((v) => !v);
              }}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-fairway-300 active:bg-fairway-800"
            >
              Holes
            </button>
          </div>
        }
      />

      {showJump && (
        <div className="grid grid-cols-6 gap-2 border-b border-fairway-800 bg-fairway-900/50 p-3">
          {Array.from({ length: HOLE_COUNT }, (_, h) => {
            const done = round.playerTags.every((_t, p) => round.scores[p]?.[h] != null);
            return (
              <button
                key={h}
                onClick={() => {
                  playClick();
                  setHole(h);
                  setShowJump(false);
                }}
                className={`rounded-lg py-2 text-sm font-bold ${
                  h === hole
                    ? 'bg-fairway-700 text-fairway-50'
                    : done
                      ? 'bg-fairway-800 text-fairway-200'
                      : 'border border-fairway-700 text-fairway-300'
                }`}
              >
                {h + 1}
              </button>
            );
          })}
        </div>
      )}

      <Content>
        {/* Hole header */}
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
                <div className="text-4xl font-black text-fairway-50">{hole + 1}</div>
              </>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
              Par
            </div>
            <div className="text-4xl font-black" style={{ color: ink }}>
              {par}
            </div>
          </div>
        </div>

        {/* Player rows */}
        <div className="space-y-3">
          {round.playerTags.map((tag, p) => {
            const strokes = round.scores[p]?.[hole] ?? null;
            return (
              <div
                key={p}
                className="rounded-2xl border border-fairway-800 bg-fairway-900/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className="font-arcade text-xl font-bold"
                    style={{ color: ink }}
                  >
                    {tag}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => bump(p, -1)}
                    disabled={autoPlaying || strokes == null || strokes <= 1}
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-fairway-700 bg-fairway-950 text-3xl font-bold text-fairway-100 active:bg-fairway-800 disabled:opacity-30"
                    aria-label={`Decrease strokes for ${tag}`}
                  >
                    −
                  </button>
                  <div className="flex-1 text-center">
                    {/* Keyed on a per-player nonce that only changes on a real
                        stroke edit, so the pop fires on +/− but not when
                        navigating between holes. */}
                    <span
                      key={pops[p] ?? 0}
                      className="inline-block text-4xl font-black text-fairway-50 animate-score-pop"
                    >
                      {strokes ?? '–'}
                    </span>
                  </div>
                  <button
                    onClick={() => bump(p, +1)}
                    disabled={
                      autoPlaying || (STROKE_CAP_ENABLED && strokes != null && strokes >= STROKE_CAP)
                    }
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-fairway-700 bg-fairway-950 text-3xl font-bold text-fairway-100 active:bg-fairway-800 disabled:opacity-30"
                    aria-label={`Increase strokes for ${tag}`}
                  >
                    +
                  </button>
                </div>
                {/* Fixed-height slot so the card doesn't shrink when this hint
                    disappears on scoring — reserve the row whether or not the
                    text is showing. */}
                <p className="mt-2 h-4 text-center text-xs leading-4 text-fairway-100/70">
                  {strokes == null ? 'Tap + to score this hole' : ''}
                </p>
              </div>
            );
          })}
        </div>

        {/* Hole navigation */}
        <div className="mt-6 flex gap-3">
          <Button
            variant="ghost"
            onClick={() => setHole((h) => Math.max(0, h - 1))}
            disabled={hole === 0 || autoPlaying}
          >
            ‹ Prev
          </Button>
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
              onClick={() => navigate(`/play/${clientId}/summary`)}
              disabled={!complete || autoPlaying}
            >
              Finish
            </Button>
          )}
        </div>

        {/* Auto-play (testing) — taps the real +/Next buttons across the whole
            course so their sounds fire in sequence. Play taps every half
            second; fast forward taps every sixteenth of a second. Either way,
            Pause stops mid-course. */}
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
