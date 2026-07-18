import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { fetchLeaderboard, type LeaderboardRow } from '../../sync';

type Period = 'day' | 'week' | 'month' | 'all';
const PERIODS: Period[] = ['day', 'week', 'month', 'all'];

// Passed via router state when arriving from a round's final scorecard, so we
// can highlight that session's scores on the board. A tag isn't a stable
// identity (tags get reused), so we match on course + this round's exact total
// per tag — highlighting only the score just played, never an older best.
type HighlightState = {
  highlightCourseId?: string;
  highlightScores?: { tag: string; total: number }[];
};

// P2 preview. The full-screen /tv board is Phase 2, but the API already serves
// the arcade high-score data, so this is a lightweight live view. Polls every
// few seconds (§9 — no realtime service needed).
export default function TvLeaderboard() {
  const { state } = useLocation();
  const { highlightCourseId, highlightScores } = (state as HighlightState | null) ?? {};
  // Key on tag + total so we highlight the exact score from this session, not
  // a player's older personal best (the board keeps best-per-tag-course).
  const highlightSet = new Set((highlightScores ?? []).map((s) => `${s.tag}:${s.total}`));
  const isHighlighted = (r: LeaderboardRow) =>
    r.courseId === highlightCourseId && highlightSet.has(`${r.tag}:${r.total}`);

  const [period, setPeriod] = useState<Period>('all');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await fetchLeaderboard(period);
        if (alive) {
          setRows(data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load leaderboard');
      }
    }
    void load();
    const id = setInterval(load, 5000); // poll every 5s
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [period]);

  return (
    <Screen>
      <TopBar title="Leaderboard" back="/" />
      <Content>
        <div className="mb-4 grid grid-cols-4 gap-2">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg py-2 text-sm font-semibold capitalize ${
                period === p
                  ? 'bg-fairway-700 text-fairway-50'
                  : 'border border-fairway-700 text-fairway-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Leaderboard needs the backend API running. {error}
          </div>
        )}

        {!error && rows && rows.length === 0 && (
          <p className="py-8 text-center text-fairway-100/70">
            No scores yet — finish a round to get on the board.
          </p>
        )}

        {!error && rows && rows.length > 0 && (
          <ol className="space-y-2">
            {rows.map((r, i) => {
              const mine = isHighlighted(r);
              return (
                <li
                  key={`${r.tag}-${r.courseId}-${i}`}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                    mine
                      ? 'border-fairway-400 bg-fairway-500/15 ring-1 ring-fairway-400/60'
                      : 'border-fairway-800 bg-fairway-900/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-mono text-sm text-fairway-100/70">
                      {i + 1}
                    </span>
                    <span className="font-arcade text-2xl font-bold text-fairway-50">{r.tag}</span>
                    <span className="text-xs text-fairway-100/70">{r.courseName}</span>
                    {mine && (
                      <span className="rounded-full bg-fairway-500/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fairway-300">
                        You
                      </span>
                    )}
                  </div>
                  <span className="text-2xl font-black text-fairway-50">{r.total}</span>
                </li>
              );
            })}
          </ol>
        )}

        {!error && !rows && <p className="py-8 text-center text-fairway-100/70">Loading…</p>}
      </Content>
    </Screen>
  );
}
