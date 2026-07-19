import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import CourseTheme from '../../ui/CourseTheme';
import { accentInk } from '../../lib/theme';
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
  const ink = accentInk(course.theme);
  const winnerIdx = winners(round.scores, round.playerTags.length);
  const winnerSet = new Set(winnerIdx);
  const tied = winnerIdx.length > 1;
  const ranked = round.playerTags
    .map((tag, p) => ({ tag, p, total: playerTotal(round.scores[p] ?? []) }))
    .sort((a, b) => a.total - b.total)
    .map((row, i) => ({ ...row, rank: i + 1 }));
  // Winner(s) get the hero card; everyone else fills the standings below — so
  // the winner is celebrated once, not repeated as a plain row.
  const heroRows = ranked.filter((row) => winnerSet.has(row.p));
  const restRows = ranked.filter((row) => !winnerSet.has(row.p));
  const heroDiff = heroRows[0].total - par;

  return (
    <CourseTheme theme={course.theme} accent={course.accent}>
    <Screen>
      <Confetti />
      <TopBar title="Final scorecard" back="/" />
      <Content>
        <div className="mb-4 text-center">
          <div className="text-sm text-fairway-100/70">{course.name}</div>
          <div className="mt-1 text-xs text-fairway-100/70">Par {par}</div>
        </div>

        {/* Winner hero — the champion's spotlight. Named once here, then the
            rest of the field follows below, so no tag is shown twice.

            Two elements: the outer wrapper carries the looping glow halo, the
            inner card the one-shot pop-in entrance. They can't share an element
            because both utilities set the `animation` shorthand and the later
            one would overwrite the other — and the inner card's overflow-hidden
            (which clips the spotlight) would also clip a glow drawn on it, so
            the halo has to live on an un-clipped parent. */}
        <div
          className="animate-glow-pulse mb-6 rounded-3xl"
          style={{ '--glow': course.accent } as CSSProperties}
        >
          <div
            className="surface animate-pop-in relative overflow-hidden rounded-3xl border border-fairway-500/40 p-5"
            style={{ '--i': 0 } as CSSProperties}
          >
            {/* Accent spotlight behind the trophy (left), in the course's own color. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-48"
              style={{
                background: `radial-gradient(70% 100% at 0% 50%, ${course.accent}40, transparent 70%)`,
              }}
            />
            {/* One horizontal row: trophy left, champion in the middle, score
                right — a compact hero rather than a tall stack. */}
            <div className="relative flex items-center gap-4">
              <div className="animate-trophy-pop w-14 shrink-0 text-center text-5xl leading-none">
                🏆
              </div>
              <div className="min-w-0 flex-1 text-center">
                <div className="text-xs font-semibold uppercase tracking-[0.25em] text-fairway-400">
                  {tied ? 'Tied for the win' : 'Winner'}
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-0.5">
                  {heroRows.map((row) => (
                    <span
                      key={row.p}
                      className="font-arcade text-3xl font-black"
                      style={{ color: ink }}
                    >
                      {row.tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-2xl font-black text-fairway-50">{heroRows[0].total}</span>
                <span className="ml-2 text-sm text-fairway-100/70">{formatOverUnder(heroDiff)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* The rest of the field. */}
        {restRows.length > 0 && (
          <div className="mb-6 space-y-2">
            {restRows.map((row) => {
              const diff = row.total - par;
              return (
                <div
                  key={row.p}
                  style={{ '--i': row.rank } as CSSProperties}
                  className="surface-1 animate-rise-in flex items-center gap-4 rounded-2xl border border-fairway-800/60 px-5 py-3"
                >
                  {/* Same three zones and column widths as the hero — place
                      left, tag centered, score right — so the columns line up
                      down the whole card. */}
                  <span className="w-14 shrink-0 text-center font-mono text-2xl font-black text-fairway-100/50">
                    {row.rank}
                  </span>
                  <div className="min-w-0 flex-1 text-center">
                    <span className="font-arcade text-xl font-bold" style={{ color: ink }}>
                      {row.tag}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-xl font-black text-fairway-50">{row.total}</span>
                    <span className="ml-2 text-sm text-fairway-100/70">{formatOverUnder(diff)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Hole-by-hole grid — split into front/back nines so 18 columns don't
            overflow and scroll on a phone. Each nine is 9 holes + a label
            column = 10 columns, which fits the width. */}
        <div className="mb-6 space-y-2">
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
  const ink = accentInk(course.theme);
  return (
    <div className="surface-1 overflow-hidden rounded-2xl border border-fairway-800/60">
      {/* Fixed layout so columns are sized by these widths, not their content.
          Otherwise the back nine's two-digit hole numbers (10–18) and varying
          scores make its columns wider than the front nine's, so the two tables
          don't line up. The label column is a fixed width and the nine hole
          columns split the rest evenly and identically across both nines. */}
      <table className="w-full table-fixed border-collapse text-center text-sm leading-none">
        <colgroup>
          <col className="w-14" />
          {holes.map((h) => (
            <col key={h} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-fairway-900/60 text-fairway-100/70">
            <th className="px-2 py-1.5 text-left font-semibold">{label}</th>
            {holes.map((h) => (
              <th key={h} className="px-0.5 py-1.5 font-normal">
                {h + 1}
              </th>
            ))}
          </tr>
          <tr className="bg-fairway-950 text-fairway-100/70">
            <th className="px-2 py-1 text-left font-normal">Par</th>
            {holes.map((h) => (
              <td key={h} className="px-0.5 py-1">
                {course.pars[h]}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {round.playerTags.map((tag, p) => (
            <tr key={p} className="border-t border-fairway-800">
              <td
                className="font-arcade px-2 py-1.5 text-left font-bold"
                style={{ color: ink }}
              >
                {tag}
              </td>
              {holes.map((h) => {
                const s = round.scores[p]?.[h];
                const under = s != null && s < course.pars[h];
                const over = s != null && s > course.pars[h];
                // Score coloring is a functional signal, so it keeps its own
                // hues (green under / amber over) independent of the neutral
                // environment ramp. The hues come from `--score-*` vars that
                // darken in light mode (index.css) to stay legible; par is a
                // neutral chrome shade.
                const signal = under ? 'var(--score-under)' : over ? 'var(--score-over)' : undefined;
                return (
                  <td
                    key={h}
                    className={`px-0.5 py-1.5 ${signal ? '' : 'text-fairway-100'}`}
                    style={signal ? { color: signal } : undefined}
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
    return <p className="text-center text-xs text-fairway-100/70">Saved to leaderboard ✓</p>;
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
  return <p className="text-center text-xs text-fairway-100/70">{text}</p>;
}
