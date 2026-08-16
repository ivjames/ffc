import { useCallback, useEffect, useState } from 'react';
import { api, type AdminFeedback, type AdminFeedbackStatus } from './api';
import { Button, Card, Banner, EmptyState, PageHeader, Pill, Segmented, Spinner, fmtDateTime, useObjectUrl } from './ui';

// Reviewer commentary — the operator side of the in-app feedback widget
// (player side: the 💬 pill in the app's dev cluster). Every note arrives with
// the screen it was filed from and the build it was filed against, so a
// comment like "this is confusing" is still actionable a week later.
//
// Triage is two states, not a workflow: open until someone marks it resolved,
// and reversible. Delete is for notes that shouldn't persist at all (a
// mis-file, a duplicate, a screenshot that caught something it shouldn't).

// The thumbnail uses the shared authed-image hook (not BlobThumb) because a
// loaded screenshot is clickable: it's the evidence, so it opens full size.
function Screenshot({ id }: { id: string }) {
  const { url, failed } = useObjectUrl(() => api.fetchFeedbackScreenshot(id), [id]);
  const [expanded, setExpanded] = useState(false);

  if (failed) {
    return (
      <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs text-slate-400">
        unavailable
      </div>
    );
  }
  if (!url) return <div className="h-28 w-28 shrink-0 animate-pulse rounded-md bg-slate-100" />;
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title="Click to enlarge"
        className="shrink-0"
      >
        <img
          src={url}
          alt="Reviewer screenshot"
          className="h-28 w-28 rounded-md object-cover ring-1 ring-slate-200"
        />
      </button>
      {expanded && (
        // A screenshot is the evidence — a 112px thumbnail can't show what the
        // reviewer is pointing at, so clicking opens it full size.
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-6"
          onClick={() => setExpanded(false)}
        >
          <img src={url} alt="Reviewer screenshot" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </>
  );
}

function FeedbackRow({
  note,
  onChanged,
  onRemoved,
}: {
  note: AdminFeedback;
  onChanged: (next: AdminFeedback) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolved = note.status === 'resolved';

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={`flex items-start gap-4 ${resolved ? 'opacity-60' : ''}`}>
      {note.hasScreenshot && <Screenshot id={note.id} />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{note.reviewer || 'Anonymous reviewer'}</span>
          {note.screenPath && <Pill>{note.screenPath}</Pill>}
          {resolved && <Pill tone="amber">resolved</Pill>}
        </div>
        {/* The comment is the payload — preserve the reviewer's line breaks
            rather than collapsing a structured note into one paragraph. */}
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{note.body}</p>
        <div className="mt-2 text-xs text-slate-400">
          {note.locationName ? `${note.locationName} · ` : ''}
          {fmtDateTime(note.createdAt)}
          {note.appBuild ? ` · build ${note.appBuild}` : ''}
          {resolved && note.resolvedBy ? ` · resolved by ${note.resolvedBy}` : ''}
        </div>
        {note.userAgent && (
          <div className="mt-1 truncate text-xs text-slate-300" title={note.userAgent}>
            {note.userAgent}
          </div>
        )}
        {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next: AdminFeedbackStatus = resolved ? 'open' : 'resolved';
              const res = await api.setFeedbackStatus(note.id, next);
              onChanged({
                ...note,
                status: res.status,
                resolvedAt: res.resolvedAt,
                resolvedBy: res.resolvedBy,
              });
            })
          }
        >
          {busy ? '…' : resolved ? 'Re-open' : 'Mark resolved'}
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm('Delete this note and its screenshot? This cannot be undone.')) {
              return;
            }
            void run(async () => {
              await api.removeFeedback(note.id);
              onRemoved();
            });
          }}
        >
          Delete
        </Button>
      </div>
    </Card>
  );
}

const PAGE_SIZE = 50;

type Filter = 'open' | 'resolved' | 'all';

export default function Feedback() {
  // Paged by hand rather than useAsync: a full page signals more may exist,
  // and "Load older" appends the next page via the last row's createdAt cursor.
  const [filter, setFilter] = useState<Filter>('open');
  const [notes, setNotes] = useState<AdminFeedback[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadPage = useCallback(
    async (existing: AdminFeedback[]) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.listFeedback({
          before: existing.length > 0 ? existing[existing.length - 1].createdAt : undefined,
          limit: PAGE_SIZE,
          status: filter === 'all' ? undefined : filter,
        });
        setNotes([...existing, ...page]);
        setHasMore(page.length === PAGE_SIZE);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    setNotes(null);
    void loadPage([]);
  }, [loadPage]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Feedback"
        description="Notes filed by reviewers from inside the app — each one carries the screen it was written on, the build it was written against, and a screenshot when the reviewer attached one. Mark a note resolved once it's been dealt with (reversible), or delete it outright."
      />

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'all', label: 'All' },
        ]}
      />

      {error && <Banner kind="error">{error.message}</Banner>}
      {notes && (
        <div className="space-y-2">
          {notes.map((n) => (
            <FeedbackRow
              key={n.id}
              note={n}
              onChanged={(next) =>
                setNotes((cur) => {
                  if (!cur) return cur;
                  // A note that no longer matches the active filter drops out
                  // of the list — resolving from the Open tab should clear it,
                  // not leave a greyed row behind.
                  if (filter !== 'all' && next.status !== filter) {
                    return cur.filter((x) => x.id !== next.id);
                  }
                  return cur.map((x) => (x.id === next.id ? next : x));
                })
              }
              onRemoved={() => setNotes((cur) => cur?.filter((x) => x.id !== n.id) ?? null)}
            />
          ))}
          {notes.length === 0 && !loading && (
            <EmptyState>
              {filter === 'resolved' ? 'Nothing resolved yet.' : 'No feedback right now.'}
            </EmptyState>
          )}
        </div>
      )}
      {loading && <Spinner />}
      {notes && hasMore && !loading && (
        <div className="text-center">
          <Button variant="ghost" onClick={() => void loadPage(notes)}>
            Load older notes
          </Button>
        </div>
      )}
    </div>
  );
}
