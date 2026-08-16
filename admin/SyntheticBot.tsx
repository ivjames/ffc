// Master Control → Synthetic: the load/soak bot control plane. Shows what the
// bot would play (courses + venue open state), previews the annual player
// volume a cadence projects (so an operator can dial it to a real target like
// ~70k players/yr), and — for super_admins — starts/stops the bot live.
//
// The SYNTHETIC_BOT_KEY never reaches this page: the server injects it into the
// child process and reports only whether one is set (`keySet`). See
// server/routes/admin/syntheticBot.js.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SyntheticBotParams, type SyntheticProjection } from './api';
import { Button, Card, Field, Input, Banner, PageHeader, Pill, Select, Spinner, Table, Th, Td, fmtDateTime, useAsync } from './ui';

const fmtInt = (n: number) => Math.round(n).toLocaleString();

// Uptime like "1h 04m" from an ISO start (empty if unknown).
function uptime(startedAt: string | null): string {
  if (!startedAt) return '';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

export default function SyntheticBot() {
  const { data: status, error, loading, reload } = useAsync(() => api.syntheticStatus(), []);

  // Form state keeps locationId as a plain string ('' = all venues); the payload
  // below converts '' → null for the API.
  type FormParams = {
    playsPerCourse: number;
    intervalMin: number;
    maxPlayers: number;
    locationId: string;
    ignoreHours: boolean;
  };
  const [params, setParams] = useState<FormParams>({
    playsPerCourse: 2,
    intervalMin: 60,
    maxPlayers: 4,
    locationId: '',
    ignoreHours: false,
  });
  const [projection, setProjection] = useState<SyntheticProjection | null>(null);
  const [projErr, setProjErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const running = status?.runner.running ?? false;

  // Poll status while the bot runs (keep pid/uptime/logs live), and ALSO while a
  // refresh is failing — so a transient error self-heals instead of stranding
  // stale state (e.g. a Start that succeeded but whose reload failed would
  // otherwise show "stopped" forever, and running-gated polling would never
  // retry).
  useEffect(() => {
    if (!running && !error) return;
    const id = setInterval(() => reload(), 4000);
    return () => clearInterval(id);
  }, [running, error, reload]);

  // Debounced projection preview whenever a knob changes.
  const payload = useMemo<SyntheticBotParams>(
    () => ({
      playsPerCourse: params.playsPerCourse,
      intervalMin: params.intervalMin,
      maxPlayers: params.maxPlayers,
      ignoreHours: params.ignoreHours,
      locationId: params.locationId || null,
    }),
    [params]
  );
  const payloadKey = JSON.stringify(payload);
  const seq = useRef(0);
  useEffect(() => {
    // Skip previews with a half-typed number field.
    if (!Number.isInteger(payload.playsPerCourse) || !Number.isInteger(payload.intervalMin)) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api.syntheticProjection(payload).then(
        (p) => {
          if (mine === seq.current) {
            setProjection(p);
            setProjErr(null);
          }
        },
        (e) => {
          if (mine === seq.current) setProjErr(e instanceof Error ? e.message : 'projection failed');
        }
      );
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  const venues = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of status?.courses ?? []) m.set(c.locationId, c.locationName);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [status]);

  async function doStart() {
    setBusy(true);
    setActionErr(null);
    try {
      await api.syntheticStart(payload);
      await reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'start failed');
    } finally {
      setBusy(false);
    }
  }
  async function doStop() {
    setBusy(true);
    setActionErr(null);
    try {
      await api.syntheticStop();
      await reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'stop failed');
    } finally {
      setBusy(false);
    }
  }

  // Only take over the whole page on the FIRST load (no data yet). The runner
  // poll refetches every 4s and useAsync flips `loading` each time — gating the
  // page on it would unmount and re-flash everything on every tick. Once we have
  // a status, keep rendering it and let the data update in place.
  if (loading && !status) return <Spinner label="Loading synthetic bot…" />;
  if (error && !status) return <Banner kind="error">{error.message}</Banner>;
  if (!status) return null;

  const { keySet, canControl, policy, courses, syntheticRounds, runner } = status;
  const target = 70000;
  const eff = projection?.effective.playersPerYear ?? 0;
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  return (
    <div className="space-y-4">
      {/* A refresh failed but we still have prior data: keep the page (no flash)
          and flag the staleness non-blockingly. Polling above keeps retrying. */}
      {error && (
        <Banner kind="error">
          Couldn’t refresh status — showing last-known state, retrying… ({error.message})
        </Banner>
      )}
      <PageHeader
        title="Synthetic player bot"
        description={
          <>
            Drives synthetic rounds through the real production path (load/soak test, smoke test,
            demo seed). Every round is tagged <code>synthetic</code> and lives under a reserved{' '}
            <code>synthetic:&lt;run&gt;:&lt;uuid&gt;</code> client id, so a run is fully reversible.
          </>
        }
      />

      {!keySet && (
        <Banner kind="error">
          <strong>Bot disabled — no key set.</strong> The server rejects every synthetic round until{' '}
          <code>SYNTHETIC_BOT_KEY</code> is set. Add it to <code>server/.env</code> (mint one with{' '}
          <code>node scripts/course-bot.mjs --gen-key</code>) and run <code>ffc restart</code>.
        </Banner>
      )}

      {/* --- Runner status --- */}
      <Card>
        <div className="flex items-center gap-3">
          <span className="font-medium">Status</span>
          {running ? (
            <Pill tone="amber">running · pid {runner.pid}</Pill>
          ) : (
            <Pill>stopped</Pill>
          )}
          {running && runner.startedAt && (
            <span className="text-xs text-slate-500">
              up {uptime(runner.startedAt)} · since {fmtDateTime(runner.startedAt)}
            </span>
          )}
          <span className="ml-auto text-xs text-slate-500">
            {fmtInt(syntheticRounds.total)} synthetic rounds all-time · {fmtInt(syntheticRounds.last24h)} in 24h
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Pill tone={policy.countsOnBoard ? 'amber' : 'slate'}>
            {policy.countsOnBoard ? 'counts on leaderboards' : 'excluded from leaderboards'}
          </Pill>
          <Pill tone={policy.mintsRewards ? 'amber' : 'slate'}>
            {policy.mintsRewards ? 'mints reward tickets' : 'no reward tickets'}
          </Pill>
        </div>
        {!running && runner.lastExit && (
          <p className="mt-2 text-xs text-slate-500">
            last run exited {fmtDateTime(runner.lastExit.at)} (code {String(runner.lastExit.code)}
            {runner.lastExit.signal ? `, ${runner.lastExit.signal}` : ''})
          </p>
        )}
        {runner.logs.length > 0 && (
          <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
            {runner.logs.slice(-20).map((l, i) => (
              <div key={i}>{l.line}</div>
            ))}
          </pre>
        )}
      </Card>

      {/* --- Controls + projection --- */}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue" hint="Scope the run to one venue, or play every live course.">
            <Select
              className="w-full"
              value={params.locationId}
              onChange={(e) => setParams((p) => ({ ...p, locationId: e.target.value }))}
            >
              <option value="">All venues ({venues.length})</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Plays per course / sweep" hint="1–20 rounds per course each sweep.">
            <Input
              type="number"
              min={1}
              max={20}
              value={params.playsPerCourse}
              onChange={(e) => setParams((p) => ({ ...p, playsPerCourse: e.target.valueAsNumber }))}
            />
          </Field>
          <Field label="Interval (minutes)" hint="Minutes between sweeps. 60 = a few plays every hour.">
            <Input
              type="number"
              min={1}
              max={1440}
              value={params.intervalMin}
              onChange={(e) => setParams((p) => ({ ...p, intervalMin: e.target.valueAsNumber }))}
            />
          </Field>
          <Field label="Max players / round" hint="Each round has 1..max players (uniform).">
            <Input
              type="number"
              min={1}
              max={4}
              value={params.maxPlayers}
              onChange={(e) => setParams((p) => ({ ...p, maxPlayers: e.target.valueAsNumber }))}
            />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={params.ignoreHours}
            onChange={(e) => setParams((p) => ({ ...p, ignoreHours: e.target.checked }))}
          />
          Ignore business hours (play 24/7 — pure load testing)
        </label>

        {/* Projection */}
        <div className="mt-4 rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
          {projErr ? (
            <Banner kind="error">{projErr}</Banner>
          ) : projection ? (
            <div className="space-y-1 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">{nf.format(eff)}</span>
                <span className="text-slate-500">
                  projected players / year ({params.ignoreHours ? '24/7' : 'while venues are open'}) ·{' '}
                  {projection.courseCount} course{projection.courseCount === 1 ? '' : 's'} · avg{' '}
                  {projection.avgPlayers.toFixed(1)} players/round
                </span>
              </div>
              <div className="text-xs text-slate-500">
                24/7 ceiling {nf.format(projection.max.playersPerYear)} · hours-gated{' '}
                {nf.format(projection.gated.playersPerYear)} players/yr
              </div>
              <div className="text-xs">
                {eff === 0 ? (
                  <span className="text-amber-700">
                    0 — venues have no hours set (or all closed). Set hours, or enable 24/7 above.
                  </span>
                ) : (
                  <span className={Math.abs(eff - target) / target < 0.1 ? 'text-emerald-700' : 'text-slate-500'}>
                    {(eff / target).toFixed(2)}× the 70,000/yr target
                  </span>
                )}
              </div>
            </div>
          ) : (
            <span className="text-sm text-slate-400">Computing projection…</span>
          )}
        </div>

        {/* Actions */}
        {canControl ? (
          <div className="mt-4 flex items-center gap-2">
            {running ? (
              <Button variant="danger" onClick={doStop} disabled={busy}>
                {busy ? 'Stopping…' : 'Stop bot'}
              </Button>
            ) : (
              <Button onClick={doStart} disabled={busy || !keySet || courses.length === 0}>
                {busy ? 'Starting…' : 'Start bot'}
              </Button>
            )}
            {running && <span className="text-xs text-slate-500">Stop finishes the current sweep, then exits.</span>}
            {actionErr && <span className="text-sm text-red-700">{actionErr}</span>}
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-500">Start/stop is limited to super admins.</p>
        )}
      </Card>

      {/* --- Courses the bot would play --- */}
      <Card className="p-0">
        <div className="px-3 pt-3 font-medium">Courses ({courses.length})</div>
        <Table>
          <thead>
            <tr>
              <Th>Venue</Th>
              <Th>Course</Th>
              <Th>Open now</Th>
              <Th>Open hrs/wk</Th>
              <Th>Pars</Th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.courseId}>
                <Td>{c.locationName}</Td>
                <Td>{c.courseName}</Td>
                <Td>{c.openNow ? <Pill tone="amber">open</Pill> : <Pill>closed</Pill>}</Td>
                <Td>
                  {c.weeklyOpenHours > 0 ? `${c.weeklyOpenHours.toFixed(0)}h` : <span className="text-amber-700">unset</span>}
                </Td>
                <Td>{c.parsKnown ? '✓' : <span className="text-slate-400">flat</span>}</Td>
              </tr>
            ))}
            {courses.length === 0 && (
              <tr>
                <Td colSpan={5} className="py-3 text-center text-slate-400">
                  No live courses found.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
