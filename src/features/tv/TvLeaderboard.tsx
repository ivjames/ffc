import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { TopBar } from '../../ui/components';
import Confetti from '../../ui/Confetti';
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
  const hasHighlight = (highlightScores ?? []).length > 0;

  // Default to today's board, except when arriving from a finished round: the
  // highlighted score may have been played just before the venue's local
  // midnight, which the "day" filter (from local midnight) would exclude — so
  // start on "all" to guarantee the just-played round is on the board.
  const [period, setPeriod] = useState<Period>(hasHighlight ? 'all' : 'day');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Celebrate exactly once, the first time the board loads with any scores on
  // it. Firing on first populated load (not only when arriving from a finished
  // round) means the leaderboard always greets you with confetti — including
  // when opened straight from Home. Guarded by a ref so the 5s poll never
  // re-triggers it.
  const [celebrate, setCelebrate] = useState(false);
  const celebrated = useRef(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await fetchLeaderboard(period);
        if (alive) {
          setRows(data);
          setError(null);
          if (!celebrated.current && data.length > 0) {
            celebrated.current = true;
            setCelebrate(true);
          }
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

  // Board position is the rank in the full ascending-by-total standings. When we
  // arrive from a final scorecard, pin the just-played rows to the TOP of the
  // list so the players see their scores and positions immediately — but keep
  // each row's real rank number, so a highlighted row still reads "5th" even
  // though it's shown first. Everyone else stays in standings order below.
  const rankedRows = (rows ?? []).map((row, i) => ({ row, rank: i + 1 }));
  const orderedRows = hasHighlight
    ? [...rankedRows].sort((a, b) => {
        const am = isHighlighted(a.row) ? 0 : 1;
        const bm = isHighlighted(b.row) ? 0 : 1;
        return am - bm || a.rank - b.rank; // mine first, then by real rank
      })
    : rankedRows;

  // Split the just-played rows out of the standings so they can be pinned above
  // the scroll region, while everyone else fills the scrollable list below.
  const yourRows = orderedRows.filter(({ row }) => isHighlighted(row));
  const restRows = orderedRows.filter(({ row }) => !isHighlighted(row));

  const renderRow = ({ row: r, rank }: { row: LeaderboardRow; rank: number }, i: number) => {
    const mine = isHighlighted(r);
    return (
      <li
        key={`${r.tag}-${r.courseId}-${rank}`}
        style={{ '--i': Math.min(i, 12) } as CSSProperties}
        className={`animate-rise-in flex items-center justify-between rounded-2xl border px-4 py-3 ${
          mine
            ? 'border-fairway-400 bg-fairway-500/15 ring-1 ring-fairway-400/60'
            : 'border-fairway-800 bg-fairway-900/40'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="w-6 text-center font-mono text-sm text-fairway-100/70">{rank}</span>
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
  };

  return (
    // Fixed-height column (h-full = viewport minus the body's safe-area padding):
    // header + tabs + pinned scores stay put and only the standings list scrolls,
    // so the board never grows past the screen.
    <div className="mx-auto flex h-full w-full max-w-md flex-col">
      <Confetti fire={celebrate} />
      <TopBar title="Leaderboard" back="/" />
      <main className="animate-page-in flex min-h-0 flex-1 flex-col px-4 py-4">
        <div className="mb-4 grid shrink-0 grid-cols-4 gap-2">
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

        {/* Just-played scores pinned above the standings. Capped at a fraction
            of the viewport with its own scroll so a full four-player highlight
            can't eat the whole column on short/landscape screens — every score
            stays reachable and the fixed-height layout never overflows. */}
        {!error && yourRows.length > 0 && (
          <div className="mb-3 shrink-0">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
              Your last round
            </div>
            <ol className="-mx-1 max-h-[38vh] space-y-2 overflow-y-auto px-1">
              {yourRows.map((row, i) => renderRow(row, i))}
            </ol>
          </div>
        )}

        {/* The rest of the standings — this is the only part that scrolls. */}
        {!error && restRows.length > 0 && (
          <ol className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-2">
            {restRows.map((row, i) => renderRow(row, i))}
          </ol>
        )}

        {!error && !rows && <p className="py-8 text-center text-fairway-100/70">Loading…</p>}
      </main>
    </div>
  );
}
