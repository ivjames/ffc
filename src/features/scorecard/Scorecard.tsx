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
  playerTotal,
  overUnderEntered,
  formatOverUnder,
  isRoundComplete,
} from '../../lib/scoring';

// §5.1 step 3 — the play screen. One hole at a time; per-hole entry for all
// players; par + running totals + over/under; stroke cap; hole navigation and
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
  const complete = isRoundComplete(round.scores, round.playerTags.length);

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
    const current = round!.scores[playerIndex]?.[hole];
    // First tap from empty starts at par (fast entry); then +/- from there.
    const base = current ?? par;
    void setStroke(playerIndex, clampStrokes(base + delta));
  }

  return (
    <Screen>
      <TopBar
        title={course.name}
        back="/"
        right={
          <button
            onClick={() => setShowJump((v) => !v)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-fairway-300 active:bg-fairway-800"
          >
            Holes
          </button>
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
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
              Hole
            </div>
            <div className="text-4xl font-black text-fairway-50">{hole + 1}</div>
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
            const total = playerTotal(round.scores[p] ?? []);
            const diff = overUnderEntered(course.pars, round.scores[p] ?? []);
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
                  <span className="text-sm text-fairway-100/60">
                    Total {total} ·{' '}
                    <span className="font-semibold text-fairway-200">{formatOverUnder(diff)}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => bump(p, -1)}
                    disabled={strokes != null && strokes <= 1}
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
                  <button
                    onClick={() => setStroke(p, par)}
                    className="mt-2 w-full rounded-lg py-1 text-xs font-medium text-fairway-400 active:bg-fairway-800"
                  >
                    Tap to score (starts at par {par})
                  </button>
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
            <Button variant="ghost" onClick={() => setHole((h) => Math.min(HOLE_COUNT - 1, h + 1))}>
              Next ›
            </Button>
          ) : (
            <Button onClick={() => navigate(`/play/${clientId}/summary`)} disabled={!complete}>
              Finish
            </Button>
          )}
        </div>

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
