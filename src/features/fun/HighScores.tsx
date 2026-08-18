import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Screen, TopBar, Content } from '../../ui/components';
import { useCurrentLocationId } from '../../lib/location';
import { useSession } from '../../lib/session';
import { playClick } from '../../lib/sound';
import { fetchBoards, formatScore, rowLabel, type BoardsResult } from '../../lib/gameScores';

// /arcade/scores — every mini-game's high score board at this venue, in one
// screen. The per-game boards on each end screen answer "how did I do?"; this
// one answers "who owns this arcade?", which is the board a venue actually
// wants on a phone being passed around a table.
//
// One request serves the whole screen (/api/game-scores/boards): twenty
// separate fetches would be twenty round trips on venue wifi, and the boards
// would pop in one at a time.
//
// Games with no scores yet are still listed. An empty board is information —
// it's the invitation to go set the first record — and dropping them would
// make the screen's contents shift around as records land.

const PERIODS = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
] as const;

/** Rows per game on this screen. Shorter than a game's own end-screen board —
 *  twenty full top-tens is a very long page — with the full board a tap away. */
const PREVIEW_ROWS = 5;

export default function HighScores() {
  const locationId = useCurrentLocationId();
  const me = useSession().user;
  const [period, setPeriod] = useState<string>('all');
  const [data, setData] = useState<BoardsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!locationId) return;
    let live = true;
    setLoading(true);
    void fetchBoards({ locationId, period, limit: PREVIEW_ROWS }).then((r) => {
      if (!live) return;
      setData(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [locationId, period]);

  const boards = data?.boards ?? [];
  // Boards with scores first, so the live competition is what you see on open
  // and the not-yet-played games collect at the bottom as a to-do list.
  const ordered = [...boards].sort((a, b) => b.board.length - a.board.length);

  return (
    <Screen>
      <TopBar title="High Scores" back="/arcade" />
      <Content>
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                playClick();
                setPeriod(p.key);
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                period === p.key
                  ? 'bg-fairway-400 text-fairway-950'
                  : 'border border-fairway-800 text-fairway-100/70'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {!locationId && (
          <p className="text-sm text-fairway-100/70">
            Pick a venue first — boards are per location.
          </p>
        )}

        {locationId && loading && (
          <p className="text-sm text-fairway-100/70">Loading the boards…</p>
        )}

        {locationId && !loading && data === null && (
          <p className="text-sm text-fairway-100/70">
            Couldn't reach the boards. They'll be here when you're back online.
          </p>
        )}

        {locationId && !loading && data !== null && (
          <div className="flex flex-col gap-3">
            {ordered.map((b) => (
              <section
                key={`${b.game}:${b.variant}`}
                className="rounded-2xl border border-fairway-800/60 bg-fairway-900/40 px-4 py-3"
              >
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-bold text-fairway-50">
                    {b.label}
                    {b.variantLabel && (
                      <span className="font-normal text-fairway-300"> · {b.variantLabel}</span>
                    )}
                  </h2>
                  <span className="text-[0.7rem] uppercase tracking-wide text-fairway-400">
                    {b.direction === 'low' ? 'lowest' : 'highest'} {b.noun}
                  </span>
                </div>

                {b.board.length === 0 ? (
                  <p className="mt-1.5 text-xs text-fairway-100/60">
                    No scores yet — go set the record.
                  </p>
                ) : (
                  <ol className="mt-1.5 flex flex-col gap-0.5">
                    {b.board.map((row) => (
                      <li
                        key={row.userId}
                        className={`flex items-center gap-3 rounded-lg px-2 py-1 text-sm ${
                          row.userId === me?.id
                            ? 'bg-fairway-400/15 font-bold text-fairway-50'
                            : 'text-fairway-100/80'
                        }`}
                      >
                        <span className="w-4 text-right tabular-nums text-fairway-400">
                          {row.rank}
                        </span>
                        <span className="tag-chip shrink-0">{rowLabel(row)}</span>
                        <span className="ml-auto tabular-nums">
                          {formatScore(row.score, b.unit)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
        )}

        {me == null && (
          <Link
            to="/me/account?next=/arcade/scores"
            className="surface-1 mt-4 flex items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-3"
          >
            <span className="text-sm text-fairway-100/80">
              🏆 Sign in to get your scores on these boards
            </span>
            <span className="shrink-0 text-sm font-semibold text-fairway-400">Sign in</span>
          </Link>
        )}
      </Content>
    </Screen>
  );
}
