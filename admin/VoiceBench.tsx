import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TtsClip, type TtsPlan, type TtsRun, type TtsRunSummary, type TtsVenue } from './api';
import {
  Banner,
  Button,
  Card,
  Field,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  fmtDateTime,
  useObjectUrl,
} from './ui';

// Master Control → Ops → Voice bench. Amazon Polly reading this venue's real
// questions, so a voice is chosen by ear rather than from a spec sheet.
//
// This was a server-rendered page outside the SPA, copied from the vision
// bench's shape. That made it unfindable (no nav entry) and unlike every other
// screen. It is a screen; it belongs here.
//
// The estimate arrives on its own and again on every change, so the cost is on
// screen before anything is spent. There is one action, because a disabled
// primary button that explains nothing is how the first version wasted an
// afternoon.

/** A priced plan, plus the EXACT request that produced it. Carrying only the
 *  venue was a spend bug: with a reprice still in flight, Synthesize paired the
 *  old plan's venue with the live question count and billed five questions
 *  against a one-question estimate. */
type PricedPlan = TtsPlan & { asked: { locationId: string; questions: number } };

/** One clip's player. The bytes need the admin auth header, which an
 *  <audio src> cannot carry — same constraint as the photo thumbnails. */
function ClipPlayer({ runId, file }: { runId: string; file: string }) {
  const fetchBlob = useCallback(() => api.fetchTtsClip(runId, file), [runId, file]);
  const { url, failed } = useObjectUrl(fetchBlob, [runId, file]);
  if (failed) return <span className="text-xs text-red-700">unavailable</span>;
  if (!url) return <span className="text-xs text-slate-400">loading…</span>;
  return <audio controls preload="none" src={url} className="h-8 w-full max-w-[240px]" />;
}

/** One line of the game, with every voice/engine/style that read it.
 *
 *  Collapsed by default past the first: a run is seventy clips, and mounting
 *  seventy players means seventy authenticated fetches at once on a tablet.
 *  Opening a section is what loads its audio. */
function LineSection({
  label,
  clips,
  runId,
  open,
  onToggle,
}: {
  label: string;
  clips: TtsClip[];
  runId: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="p-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-xs text-slate-400">{open ? 'hide' : `${clips.length} clips`}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 pb-3 pt-2">
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {clips[0]?.text}
          </p>
          <Table size="xs">
            <thead>
              <tr>
                <Th>Voice</Th>
                <Th>Engine</Th>
                <Th>Style</Th>
                <Th>Listen</Th>
                <Th align="right">Chars</Th>
              </tr>
            </thead>
            <tbody>
              {clips.map((c) => (
                <tr key={c.file}>
                  <Td>{c.voice}</Td>
                  <Td>{c.engine}</Td>
                  <Td>{c.styleLabel}</Td>
                  <Td>
                    {c.error ? (
                      <span className="text-xs text-red-700">{c.error}</span>
                    ) : (
                      <ClipPlayer runId={runId} file={c.file} />
                    )}
                  </Td>
                  <Td align="right">{c.billed ?? c.chars}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export default function VoiceBench() {
  const [venues, setVenues] = useState<TtsVenue[]>([]);
  const [venueId, setVenueId] = useState('');
  const [questions, setQuestions] = useState(3);
  const [runs, setRuns] = useState<TtsRunSummary[]>([]);
  const [plan, setPlan] = useState<PricedPlan | null>(null);
  const [run, setRun] = useState<TtsRun | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Which pricing request is current. Changing venue twice quickly leaves two
  // in flight, and the slower one must not land: it would show ITS estimate
  // beside a button that would then spend on a venue the form no longer shows.
  const planSeq = useRef(0);

  useEffect(() => {
    let live = true;
    Promise.all([api.ttsVenues(), api.ttsRuns().catch(() => ({ runs: [] }))])
      .then(([v, r]) => {
        if (!live) return;
        setVenues(v.venues);
        setRuns(r.runs);
        setVenueId(v.venues[0]?.id ?? '');
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const price = useCallback(async (locationId: string, count: number) => {
    if (!locationId) return;
    const seq = ++planSeq.current;
    setError(null);
    setStatus('Pricing…');
    try {
      const asked = { locationId, questions: count };
      const priced = await api.ttsPlan(asked);
      if (seq !== planSeq.current) return; // superseded by a newer selection
      setPlan({ ...priced, asked });
      setStatus('Nothing spent yet — Synthesize bills the amount above.');
    } catch (e) {
      if (seq !== planSeq.current) return;
      // The one button is also the retry, so it must never be left inert.
      setPlan(null);
      setStatus(null);
      setError(`${(e as Error).message} — Synthesize retries.`);
    }
  }, []);

  useEffect(() => {
    if (venueId) void price(venueId, questions);
  }, [venueId, questions, price]);

  async function synthesize() {
    if (!plan) return price(venueId, questions);
    setBusy(true);
    setError(null);
    setStatus('Synthesizing… (a few seconds)');
    try {
      // Submit what was PRICED — the whole request, not just its venue. The
      // selects may already have moved on with a reprice still in flight.
      const res = await api.ttsRun(plan.asked);
      setRun(res.run);
      setOpenLine(res.run.clips[0]?.lineLabel ?? null);
      setRuns((await api.ttsRuns().catch(() => ({ runs }))).runs);
      if (res.run.errors === res.run.clips.length) {
        setError('Every clip failed — see the rows below.');
        setStatus(null);
      } else {
        setStatus(res.run.errors ? `${res.run.errors} of ${res.run.clips.length} clips failed.` : 'Done.');
      }
    } catch (e) {
      setError((e as Error).message);
      setStatus(null);
    }
    setBusy(false);
  }

  async function replay(runId: string) {
    if (!runId) return;
    setError(null);
    setStatus('Loading run…');
    try {
      const res = await api.ttsRunGet(runId);
      setRun(res.run);
      setOpenLine(res.run.clips[0]?.lineLabel ?? null);
      setStatus('Loaded — no spend.');
    } catch (e) {
      setError((e as Error).message);
      setStatus(null);
    }
  }

  if (loading) return <Spinner />;

  const byLine = new Map<string, TtsClip[]>();
  for (const c of run?.clips ?? []) {
    if (!byLine.has(c.lineLabel)) byLine.set(c.lineLabel, []);
    byLine.get(c.lineLabel)!.push(c);
  }
  const split = Object.entries(plan?.byEngine ?? {})
    .map(([name, e]) => `${e.clips} ${name} ($${e.usd.toFixed(4)})`)
    .join(' + ');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Voice bench"
        description="Amazon Polly reading this venue's real questions, so live trivia's read-aloud voice is chosen by ear. Play it on the tablet you host from, through the speaker the room hears — a voice that reads well on a laptop can vanish over a PA."
      />

      {error && <Banner kind="error">{error}</Banner>}

      <Card>
        {/* min-w-0 on each cell: a grid item defaults to min-width:auto, so the
            replay <select>'s very long option text ("venue · date · $x.xxxx")
            sets its intrinsic width and pushes the column out through the
            card's right edge. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0">
          <Field label="Venue">
            <Select className="w-full" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.orgName ? `${v.orgName} — ${v.name}` : v.name}
                </option>
              ))}
            </Select>
          </Field>
          </div>
          <div className="min-w-0">
          <Field label="Questions">
            <Select className="w-full" value={String(questions)} onChange={(e) => setQuestions(Number(e.target.value))}>
              <option value="1">1</option>
              <option value="3">3 (shortest, middle, longest)</option>
              <option value="5">5</option>
            </Select>
          </Field>
          </div>
          <div className="min-w-0">
          <Field label="Or replay a past run" hint="Costs nothing — it plays what was already made.">
            <Select className="w-full" defaultValue="" onChange={(e) => void replay(e.target.value)}>
              <option value="">—</option>
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {`${r.venue ?? r.runId} · ${fmtDateTime(r.createdAt)} · $${r.usd.toFixed(4)}`}
                </option>
              ))}
            </Select>
          </Field>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={synthesize} disabled={busy}>
            {busy ? 'Synthesizing…' : 'Synthesize'}
          </Button>
          {status && <span className="text-sm text-slate-500">{status}</span>}
        </div>
      </Card>

      {plan && (
        <Card>
          <div className="tabular-nums">
            Would synthesize <strong>{plan.clips} clips</strong> — {plan.chars.toLocaleString()}{' '}
            billable characters, <strong>${plan.usd.toFixed(4)}</strong>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {split && `${split}. `}
            {plan.generative === false && `Generative is not available in ${plan.region} — neural only. `}
            Neural is $16/M, generative $30/M. Nothing spent yet; the first 1M neural characters a
            month are free for the first 12 months.
          </p>
        </Card>
      )}

      {run && (
        <>
          <Card>
            <div className="tabular-nums">
              Billed: <strong>{run.billed.toLocaleString()} characters</strong> —{' '}
              <strong>${run.usd.toFixed(4)}</strong>{' '}
              <span className="text-sm text-slate-500">(AWS RequestCharacters, not an estimate)</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {run.clips.length} clips
              {run.errors ? <span className="text-red-700"> · {run.errors} failed</span> : null} ·{' '}
              {run.venue}
            </p>
          </Card>
          {[...byLine.entries()].map(([label, clips]) => (
            <LineSection
              key={label}
              label={label}
              clips={clips}
              runId={run.runId}
              open={openLine === label}
              onToggle={() => setOpenLine(openLine === label ? null : label)}
            />
          ))}
        </>
      )}
    </div>
  );
}
