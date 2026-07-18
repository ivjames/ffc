import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import CourseTheme from '../../ui/CourseTheme';
import Confetti from '../../ui/Confetti';
import { courseById } from '../../data/courses';
import { getRound, putRound } from '../../db';
import { syncPending } from '../../sync';
import { playFanfare } from '../../lib/sound';
import type { CourseSeed, LocalRound } from '../../types';
import {
  coursePar,
  playerTotal,
  formatOverUnder,
  winners,
} from '../../lib/scoring';

// §5.1 step 4 — final scorecard summary. On arrival the round is marked
// completed and queued for sync (§3: persist finished rounds from v1).
export default function Summary() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const [round, setRound] = useState<LocalRound | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  // Celebrate exactly once when the final scorecard first appears.
  const celebrated = useRef(false);

  useEffect(() => {
    if (celebrated.current || notFound) return;
    if (!round) return;
    celebrated.current = true;
    playFanfare();
  }, [round, notFound]);

  useEffect(() => {
    let alive = true;
    void getRound(clientId).then(async (r) => {
      if (!r) {
        if (alive) setNotFound(true);
        return;
      }
      // Mark complete + queue for sync exactly once.
      if (r.syncState === 'active') {
        r = { ...r, completedAt: r.completedAt ?? Date.now(), syncState: 'pending' };
        await putRound(r);
      }
      if (alive) setRound(r);
      // Push now, then reflect the real outcome in the status note. The worker
      // still retries on reconnect (§9); this just stops the note lying while
      // we sit on the summary.
      if (r.syncState === 'pending') {
        await syncPending();
        const updated = await getRound(clientId);
        if (!alive || !updated) return;
        setRound(updated);
        // Online but still pending after the push means the server rejected it
        // or was unreachable — surface that instead of a stuck "Saving…".
        if (updated.syncState === 'pending' && navigator.onLine) setSyncFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [clientId]);

  const course = round ? courseById(round.courseId) : undefined;

  if (notFound) {
    return (
      <Screen>
        <TopBar title="Summary" back="/" />
        <Content>
          <p className="text-fairway-100/70">That round no longer exists.</p>
        </Content>
      </Screen>
    );
  }
  if (!round || !course) return null;

  const par = coursePar(course.pars);
  const winnerIdx = winners(round.scores, round.playerTags.length);
  const ranked = round.playerTags
    .map((tag, p) => ({ tag, p, total: playerTotal(round.scores[p] ?? []) }))
    .sort((a, b) => a.total - b.total);

  return (
    <CourseTheme theme={course.theme} accent={course.accent}>
    <Screen>
      <Confetti />
      <TopBar title="Final scorecard" back="/" />
      <Content>
        <div className="mb-4 text-center">
          <div className="text-sm text-fairway-100/60">{course.name}</div>
          <div className="mt-1 text-xs text-fairway-100/40">Par {par}</div>
        </div>

        {/* Winner banner */}
        <div className="mb-6 rounded-2xl border border-fairway-500/40 bg-fairway-900/60 p-4 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
            {winnerIdx.length > 1 ? 'Tied' : 'Winner'}
          </div>
          <div className="mt-1 flex items-center justify-center gap-2 text-2xl font-black">
            <span className="animate-trophy-pop inline-block">🏆</span>
            {winnerIdx.map((p) => (
              <span key={p} className="font-arcade" style={{ color: course.accent }}>
                {round.playerTags[p]}
              </span>
            ))}
          </div>
        </div>

        {/* Standings */}
        <div className="mb-6 space-y-2">
          {ranked.map((row, rank) => {
            const diff = row.total - par;
            return (
              <div
                key={row.p}
                className="flex items-center justify-between rounded-xl border border-fairway-800 bg-fairway-900/40 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-5 text-center font-mono text-sm text-fairway-100/50">
                    {rank + 1}
                  </span>
                  <span className="font-arcade text-xl font-bold" style={{ color: course.accent }}>
                    {row.tag}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-fairway-50">{row.total}</span>
                  <span className="ml-2 text-sm text-fairway-100/50">{formatOverUnder(diff)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Hole-by-hole grid — split into front/back nines so 18 columns don't
            overflow and scroll on a phone. Each nine is 9 holes + a label
            column = 10 columns, which fits the width. */}
        <div className="mb-6 space-y-3">
          <NineGrid round={round} course={course} label="Front" start={0} />
          <NineGrid round={round} course={course} label="Back" start={9} />
        </div>

        <SyncNote state={round.syncState} failed={syncFailed} />

        <div className="mt-4 space-y-2">
          <Button
            variant="ghost"
            onClick={() =>
              navigate('/tv', {
                state: {
                  highlightCourseId: round.courseId,
                  // Carry this session's exact totals — a tag alone isn't a stable
                  // identity (tags get reused), so the board matches tag + course +
                  // this round's total to highlight only the score just played.
                  highlightScores: round.playerTags.map((tag, p) => ({
                    tag,
                    total: playerTotal(round.scores[p] ?? []),
                  })),
                },
              })
            }
          >
            🏆 View leaderboard
          </Button>
          <Button onClick={() => navigate('/')}>Done</Button>
        </div>
      </Content>
    </Screen>
    </CourseTheme>
  );
}

// One nine of the hole-by-hole grid (9 holes starting at `start`). Splitting the
// 18 holes into two of these keeps each table to 10 columns so it fits a phone
// without horizontal scrolling.
function NineGrid({
  round,
  course,
  label,
  start,
}: {
  round: LocalRound;
  course: CourseSeed;
  label: string;
  start: number;
}) {
  const holes = Array.from({ length: 9 }, (_, i) => start + i);
  return (
    <div className="overflow-hidden rounded-xl border border-fairway-800">
      <table className="w-full border-collapse text-center text-sm">
        <thead>
          <tr className="bg-fairway-900/60 text-fairway-100/60">
            <th className="px-2 py-2 text-left font-semibold">{label}</th>
            {holes.map((h) => (
              <th key={h} className="px-1 py-2 font-normal">
                {h + 1}
              </th>
            ))}
          </tr>
          <tr className="bg-fairway-950 text-fairway-100/40">
            <th className="px-2 py-1 text-left font-normal">Par</th>
            {holes.map((h) => (
              <td key={h} className="px-1 py-1">
                {course.pars[h]}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {round.playerTags.map((tag, p) => (
            <tr key={p} className="border-t border-fairway-800">
              <td
                className="font-arcade px-2 py-2 text-left font-bold"
                style={{ color: course.accent }}
              >
                {tag}
              </td>
              {holes.map((h) => {
                const s = round.scores[p]?.[h];
                const under = s != null && s < course.pars[h];
                const over = s != null && s > course.pars[h];
                return (
                  <td
                    key={h}
                    className={`px-1 py-2 ${
                      under ? 'text-fairway-400' : over ? 'text-amber-400' : 'text-fairway-100'
                    }`}
                  >
                    {s ?? '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SyncNote({ state, failed }: { state: LocalRound['syncState']; failed: boolean }) {
  if (state === 'synced') {
    return <p className="text-center text-xs text-fairway-100/40">Saved to leaderboard ✓</p>;
  }
  if (failed) {
    return (
      <p className="text-center text-xs text-amber-400/80">
        Couldn’t reach the leaderboard — saved on this device, will retry.
      </p>
    );
  }
  const text = navigator.onLine
    ? 'Saving to leaderboard…'
    : 'Saved on this device — will sync when back online';
  return <p className="text-center text-xs text-fairway-100/40">{text}</p>;
}
