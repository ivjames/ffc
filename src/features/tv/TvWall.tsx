import { useEffect, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import AnnouncementBanner from '../../ui/AnnouncementBanner';
import { useCurrentLocationId } from '../../lib/location';
import { LOCATIONS, locationById, courseById } from '../../data/courses';
import { themeEmoji } from '../../lib/theme';
import { fetchCourseBoards, courseBoardsStreamUrl, type CourseBoard } from '../../sync';

// The venue display wall — every course's board side by side on one big
// screen, separate from the phone-first /tv route. Built for a TV stick
// pointed at a URL, so there is NO interaction: everything is configured by
// query params and the screen just polls.
//
//   /tv/wall?location=upland&period=day&by=player&limit=10
//
//   location  venue slug or id (default: the device's current location)
//   period    day|week|month|all      (default day — the daily race)
//   by        player|team             (default player)
//   limit     rows per course, 1..50  (default 10)

type Period = 'day' | 'week' | 'month' | 'all';
const PERIOD_LABEL: Record<Period, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
  all: 'All time',
};

// SSE is the live path (a board updates the moment a round syncs); this slow
// poll runs alongside as a safety net for proxies that silently kill streams.
const SAFETY_POLL_MS = 60_000;
const DEFAULT_ACCENT = '#38bdf8';

function resolveLocationId(param: string | null, fallback: string): string {
  if (!param) return fallback;
  const match = LOCATIONS.find((l) => l.slug === param || l.id === param);
  return match?.id ?? fallback;
}

export default function TvWall() {
  const [params] = useSearchParams();
  const currentLocationId = useCurrentLocationId();
  const locationId = resolveLocationId(params.get('location'), currentLocationId);
  const location = locationById(locationId);

  const rawPeriod = params.get('period') ?? 'day';
  const period: Period = (['day', 'week', 'month', 'all'] as const).includes(rawPeriod as Period)
    ? (rawPeriod as Period)
    : 'day';
  const by = params.get('by') === 'team' ? ('team' as const) : ('player' as const);
  const rawLimit = Number(params.get('limit'));
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 50 ? rawLimit : 10;

  const [boards, setBoards] = useState<CourseBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const opts = { locationId, period, by, limit };

    const apply = (data: { courses: CourseBoard[] }) => {
      if (!alive) return;
      setBoards(data.courses);
      setError(null);
    };

    async function pollOnce() {
      try {
        apply(await fetchCourseBoards(opts));
      } catch (e) {
        // Keep showing the last good boards; the error only surfaces when we
        // never had data (a wall flashing errors between updates helps no one).
        if (alive) setError(e instanceof Error ? e.message : 'Could not load boards');
      }
    }

    // Live updates over SSE — the server pushes a `boards` event the moment a
    // completed round syncs. EventSource reconnects on its own after drops;
    // the slow safety poll keeps the wall fresh if a proxy silently kills the
    // stream, and gives an instant first paint before the stream opens.
    const es = new EventSource(courseBoardsStreamUrl(opts));
    es.addEventListener('boards', (e) => {
      try {
        apply(JSON.parse((e as MessageEvent).data));
      } catch {
        /* malformed frame — the next push or poll corrects it */
      }
    });

    void pollOnce();
    const pollId = setInterval(pollOnce, SAFETY_POLL_MS);
    return () => {
      alive = false;
      es.close();
      clearInterval(pollId);
    };
  }, [locationId, period, by, limit]);

  const columns = boards ?? [];

  return (
    <div className="flex h-full flex-col px-6 py-4">
      {/* Header: venue + window on the left, announcements riding the rest. */}
      <div className="mb-4 flex shrink-0 items-center gap-6">
        <div className="shrink-0">
          <h1 className="text-3xl font-black tracking-tight text-fairway-50">
            ⛳️ {location?.name ?? 'Mini Golf'} Leaderboard
          </h1>
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-fairway-400">
            {PERIOD_LABEL[period]}
            {by === 'team' && ' · Teams'}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <AnnouncementBanner locationId={locationId} />
        </div>
      </div>

      {error && !boards && (
        <div className="m-auto rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-200">
          The board needs the backend API running. {error}
        </div>
      )}
      {!error && !boards && (
        <p className="m-auto text-fairway-100/70">Loading…</p>
      )}

      {columns.length > 0 && (
        <div
          className="grid min-h-0 flex-1 gap-4"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map((board) => {
            // Accent/emoji come from the bundled course styling when we have
            // it; a course onboarded after this build falls back to theme/default.
            const seed = courseById(board.courseId);
            const accent = seed?.accent ?? DEFAULT_ACCENT;
            return (
              <section
                key={board.courseId}
                className="surface-1 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-fairway-800/60"
              >
                <header
                  className="flex shrink-0 items-center gap-2 px-4 py-3"
                  style={{ background: `${accent}24`, borderBottom: `2px solid ${accent}` }}
                >
                  <span className="text-2xl" aria-hidden="true">
                    {themeEmoji(board.theme)}
                  </span>
                  <span className="truncate text-lg font-black text-fairway-50">
                    {board.courseName}
                  </span>
                </header>
                {board.rows.length === 0 ? (
                  <p className="m-auto px-4 text-center text-sm text-fairway-100/80">
                    No scores yet — be the first!
                  </p>
                ) : (
                  <ol className="min-h-0 flex-1 overflow-hidden px-3 py-2">
                    {board.rows.map((row) => (
                      <li
                        key={`${row.tag}-${row.rank}`}
                        style={{ '--i': Math.min(row.rank, 12) } as CSSProperties}
                        className="animate-rise-in flex items-center gap-3 border-b border-fairway-800/40 py-1.5 last:border-b-0"
                      >
                        <span className="w-7 shrink-0 text-center font-mono text-sm text-fairway-100/80">
                          {row.rank}
                        </span>
                        <span className="font-arcade min-w-0 flex-1 truncate text-xl font-bold text-fairway-50">
                          {row.tag}
                        </span>
                        <span className="shrink-0 text-xl font-black" style={{ color: accent }}>
                          {row.total}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}

      {boards && columns.length === 0 && (
        <p className="m-auto text-fairway-100/70">No courses at this location.</p>
      )}
    </div>
  );
}
