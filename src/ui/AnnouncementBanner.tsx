import { useEffect, useState } from 'react';
import { markAnnouncementsSeen, useAnnouncements } from '../lib/announcements';

// Rotating announcement banner (punchlist #1). One card slot; multiple live
// announcements cycle through it on a timer. Renders nothing when there's
// nothing to say, so screens can mount it unconditionally.
const ROTATE_MS = 8000;

export default function AnnouncementBanner({
  locationId,
  className = '',
}: {
  locationId: string | null;
  className?: string;
}) {
  const announcements = useAnnouncements(locationId);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (announcements.length < 2) return;
    const id = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [announcements.length]);

  const current = announcements.length ? announcements[index % announcements.length] : null;
  // Record a view when an announcement is actually shown (view memory). The lib
  // de-dupes per session, so re-visiting on rotation doesn't re-report.
  useEffect(() => {
    if (current) markAnnouncementsSeen([current.id]);
  }, [current?.id]);

  if (!current) return null;
  const a = current;

  return (
    <div
      className={`surface-1 rounded-2xl border border-fairway-800/60 px-4 py-2.5 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="text-lg" aria-hidden="true">
          📣
        </span>
        {/* Keyed on the row so each rotation re-runs the entrance animation. */}
        <div key={a.id} className="animate-rise-in min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-fairway-50">{a.title}</div>
          {a.body && <div className="truncate text-xs text-fairway-100/70">{a.body}</div>}
        </div>
        {announcements.length > 1 && (
          <span className="shrink-0 text-[10px] font-semibold text-fairway-400">
            {(index % announcements.length) + 1}/{announcements.length}
          </span>
        )}
      </div>
    </div>
  );
}
