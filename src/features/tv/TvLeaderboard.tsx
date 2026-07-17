import { useEffect, useState } from 'react';
import { Screen, TopBar, Content } from '../../ui/components';
import { fetchLeaderboard, type LeaderboardRow } from '../../sync';

type Period = 'day' | 'week' | 'month' | 'all';
const PERIODS: Period[] = ['day', 'week', 'month', 'all'];

// P2 preview. The full-screen /tv board is Phase 2, but the API already serves
// the arcade high-score data, so this is a lightweight live view. Polls every
// few seconds (§9 — no realtime service needed).
export default function TvLeaderboard() {
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
                  ? 'bg-fairway-500 text-fairway-950'
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
          <p className="py-8 text-center text-fairway-100/50">
            No scores yet — finish a round to get on the board.
          </p>
        )}

        {!error && rows && rows.length > 0 && (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={`${r.tag}-${r.courseId}-${i}`}
                className="flex items-center justify-between rounded-xl border border-fairway-800 bg-fairway-900/40 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center font-mono text-sm text-fairway-100/50">
                    {i + 1}
                  </span>
                  <span className="font-arcade text-2xl font-bold text-fairway-50">{r.tag}</span>
                  <span className="text-xs text-fairway-100/50">{r.courseName}</span>
                </div>
                <span className="text-2xl font-black text-fairway-400">{r.total}</span>
              </li>
            ))}
          </ol>
        )}

        {!error && !rows && <p className="py-8 text-center text-fairway-100/40">Loading…</p>}
      </Content>
    </Screen>
  );
}
