import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
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

// §5.1 step 3 — the play screen. One hole at a time; per-hole entry for all
// players; par for the current hole; stroke cap; hole navigation and
// edit; every edit persists to IndexedDB immediately (offline-first).
export default function Scorecard() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const [round, setRound] = useState<LocalRound | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hole, setHole] = useState(0); // 0-based index
  const [showJump, setShowJump] = useState(false);

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

  const course = round ? courseById(round.courseId) : undefined;

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

  function bump(playerIndex: number, delta: number) {
    const current = round!.scores[playerIndex]?.[hole] ?? null;
    // No auto-fill: an empty hole starts blank. First + registers 1; − does
    // nothing until there's a value to decrement.
    if (current == null) {
      if (delta > 0) void setStroke(playerIndex, 1);
      return;
    }
    void setStroke(playerIndex, clampStrokes(current + delta));
  }

  return (
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
              onClick={() => setShowJump((v) => !v)}
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
                  setHole(h);
                  setShowJump(false);
                }}
                className={`rounded-lg py-2 text-sm font-bold ${
                  h === hole
                    ? 'bg-fairway-500 text-fairway-950'
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
            <div className="text-4xl font-black" style={{ color: course.accent }}>
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
                    style={{ color: course.accent }}
                  >
                    {tag}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => bump(p, -1)}
                    disabled={strokes == null || strokes <= 1}
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-fairway-700 bg-fairway-950 text-3xl font-bold text-fairway-100 active:bg-fairway-800 disabled:opacity-30"
                    aria-label={`Decrease strokes for ${tag}`}
                  >
                    −
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-4xl font-black text-fairway-50">
                      {strokes ?? '–'}
                    </span>
                  </div>
                  <button
                    onClick={() => bump(p, +1)}
                    disabled={STROKE_CAP_ENABLED && strokes != null && strokes >= STROKE_CAP}
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-fairway-700 bg-fairway-950 text-3xl font-bold text-fairway-100 active:bg-fairway-800 disabled:opacity-30"
                    aria-label={`Increase strokes for ${tag}`}
                  >
                    +
                  </button>
                </div>
                {strokes == null && (
                  <p className="mt-2 text-center text-xs text-fairway-100/40">
                    Tap + to score this hole
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Hole navigation */}
        <div className="mt-6 flex gap-3">
          <Button
            variant="ghost"
            onClick={() => setHole((h) => Math.max(0, h - 1))}
            disabled={hole === 0}
          >
            ‹ Prev
          </Button>
          {hole < HOLE_COUNT - 1 ? (
            <Button
              variant="ghost"
              onClick={() => setHole((h) => Math.min(HOLE_COUNT - 1, h + 1))}
              disabled={!currentHoleScored}
            >
              Next ›
            </Button>
          ) : (
            <Button onClick={() => navigate(`/play/${clientId}/summary`)} disabled={!complete}>
              Finish
            </Button>
          )}
        </div>

        {hole < HOLE_COUNT - 1 && !currentHoleScored && (
          <p className="mt-3 text-center text-xs text-fairway-100/50">
            Score every player on this hole to continue.
          </p>
        )}

        {hole === HOLE_COUNT - 1 && !complete && (
          <p className="mt-3 text-center text-xs text-fairway-100/50">
            Enter every hole for all players to finish.
          </p>
        )}

        {STROKE_CAP_ENABLED && (
          <p className="mt-6 text-center text-xs text-fairway-100/30">
            Max {STROKE_CAP} strokes per hole
          </p>
        )}
      </Content>
    </Screen>
  );
}
