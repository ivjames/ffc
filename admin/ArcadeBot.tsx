// Master Control → Ops → Arcade bot: both halves of the arcade tool on one
// page, in the order they're meant to be used.
//
//   1. Capture — plays the real mini-games in headless Chromium and writes a
//      score profile. Slow (~2.5 rounds/min), and it needs a browser on the API
//      host, which an API box has no reason to ship. When there isn't one the
//      panel says so and the controls stay disabled rather than handing you a
//      Playwright stack trace in the log pane.
//   2. Replay — posts the awards a captured profile implies, at a volume a
//      browser could never reach. Needs a profile and a venue with game rewards
//      switched on.
//
// They're independent processes, so both can run at once and each has its own
// status/logs. See ARCADE-BOT.md for the design and server/routes/admin/
// arcadeBot.js for the control plane.
import { useEffect, useMemo, useState } from 'react';
import { api, type ArcadeProfile, type ArcadeRunner, type ArcadeCaptureParams, type ArcadeReplayParams } from './api';
import { Banner, Button, Card, Field, Input, PageHeader, Pill, Select, Spinner, fmtDateTime, useAsync } from './ui';
import ArcadeBotCharts from './ArcadeBotCharts';

const fmtInt = (n: number) => Math.round(n).toLocaleString();

function uptime(startedAt: string | null): string {
  if (!startedAt) return '';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

/** How a profile will replay: the skill its rounds were actually played at.
 *  Replay draws from the recorded samples, so this is a property of the file,
 *  not of the replay knobs — a fixed-skill capture pays that same standard of
 *  play forever. */
function skillBlurb(p: ArcadeProfile): { text: string; fixed: boolean } | null {
  const s = p.summary;
  if (!s || s.skillMean === null || s.skillMin === null || s.skillMax === null) return null;
  // A single round is trivially "fixed" — don't call that out as one.
  const fixed = s.skillMax - s.skillMin < 0.01 && s.samples > 1;
  if (fixed) return { text: `fixed skill ${s.skillMin.toFixed(2)}`, fixed: true };
  return {
    text: `skill ${s.skillMin.toFixed(2)}–${s.skillMax.toFixed(2)} (mean ${s.skillMean.toFixed(2)})`,
    fixed: false,
  };
}

/** Pull a trailing shell command off the browser-probe reason, so the UI can
 *  show it as something to copy rather than as prose. */
function splitCommand(reason: string): [string, string | null] {
  const at = reason.search(/(cd |npm ci|npx )/);
  if (at < 0) return [reason, null];
  return [reason.slice(0, at).replace(/[:\s]+$/, ''), reason.slice(at).trim()];
}

/** Shared runner header + log tail for either slot. */
function RunnerPanel({ runner, onStop, canControl, busy }: {
  runner: ArcadeRunner;
  onStop: () => void;
  canControl: boolean;
  busy: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {runner.running ? <Pill tone="amber">running · pid {runner.pid}</Pill> : <Pill>stopped</Pill>}
        {runner.running && runner.startedAt && (
          <span className="text-xs text-slate-500">
            up {uptime(runner.startedAt)} · since {fmtDateTime(runner.startedAt)}
          </span>
        )}
        {!runner.running && runner.lastExit && (
          <span className="text-xs text-slate-500">
            last run exited {fmtDateTime(runner.lastExit.at)} (code {String(runner.lastExit.code)}
            {runner.lastExit.signal ? `, ${runner.lastExit.signal}` : ''})
          </span>
        )}
        {runner.running && canControl && (
          <Button variant="danger" onClick={onStop} disabled={busy} className="ml-auto">
            Stop
          </Button>
        )}
      </div>
      {runner.logs.length > 0 && (
        <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
          {runner.logs.slice(-40).map((l, i) => (
            <div key={i}>{l.line}</div>
          ))}
        </pre>
      )}
    </>
  );
}

/** Checkbox grid over the game registry. Empty selection = every game. */
function GamePicker({ games, value, onChange }: {
  games: { key: string; label: string; estRoundMs: number | null }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const set = new Set(value);
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {games.map((g) => (
          <label key={g.key} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={set.has(g.key)}
              onChange={(e) => onChange(e.target.checked ? [...value, g.key] : value.filter((k) => k !== g.key))}
            />
            {g.label}
          </label>
        ))}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {value.length === 0 ? `No selection — all ${games.length} games.` : `${value.length} selected.`}{' '}
        {value.length > 0 && (
          <button type="button" className="underline" onClick={() => onChange([])}>
            clear
          </button>
        )}
      </div>
    </div>
  );
}

export default function ArcadeBot() {
  const { data: status, error, loading, reload } = useAsync(() => api.arcadeStatus(), []);

  const [cap, setCap] = useState({ rounds: 10, seed: 1, skill: '' as string, workers: 3, games: [] as string[] });
  const [rep, setRep] = useState({
    locationId: '',
    profile: '',
    plays: 50,
    players: 4,
    concurrency: 6,
    seed: 1,
    intervalMin: '' as string,
    sweeps: '' as string,
    dryRun: true,
    games: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [capErr, setCapErr] = useState<string | null>(null);
  const [repErr, setRepErr] = useState<string | null>(null);

  const running = (status?.capture.running ?? false) || (status?.replay.running ?? false);

  // Poll while either slot runs (keep pid/uptime/logs live) and also while a
  // refresh is failing, so a transient error self-heals instead of stranding
  // stale state. Same reasoning as the synthetic panel.
  useEffect(() => {
    if (!running && !error) return;
    const id = setInterval(() => reload(), 4000);
    return () => clearInterval(id);
  }, [running, error, reload]);

  // Default the profile picker to the newest capture once one exists.
  const newestProfile = status?.profiles[0]?.name ?? '';
  useEffect(() => {
    setRep((r) => (r.profile === '' && newestProfile ? { ...r, profile: newestProfile } : r));
  }, [newestProfile]);

  const venue = useMemo(
    () => status?.venues.find((v) => v.id === rep.locationId) ?? null,
    [status, rep.locationId]
  );
  const chosenProfile = useMemo(
    () => status?.profiles.find((p) => p.name === rep.profile) ?? null,
    [status, rep.profile]
  );

  // Switching profiles can strand a game the new one never captured. Drop
  // those rather than sending a selection the server will reject.
  const chosenKeys = chosenProfile?.summary?.gameKeys;
  const chosenKeysSig = chosenKeys?.join(',') ?? '';
  useEffect(() => {
    if (!chosenKeys) return;
    setRep((r) => {
      const kept = r.games.filter((g) => chosenKeys.includes(g));
      return kept.length === r.games.length ? r : { ...r, games: kept };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKeysSig]);

  async function run(fn: () => Promise<unknown>, setErr: (m: string | null) => void, what: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${what} failed`);
    } finally {
      setBusy(false);
    }
  }

  // First load only: the 4s poll flips `loading` on every tick, and gating the
  // page on it would re-flash everything.
  if (loading && !status) return <Spinner label="Loading arcade bot…" />;
  if (error && !status) return <Banner kind="error">{error.message}</Banner>;
  if (!status) return null;

  const { canControl, browser, app, profiles, venues, games, syntheticAwards } = status;

  const captureParams: ArcadeCaptureParams = {
    rounds: cap.rounds,
    seed: cap.seed,
    skill: cap.skill === '' ? null : Number(cap.skill),
    workers: cap.workers,
    games: cap.games,
  };
  const replayParams: ArcadeReplayParams = {
    locationId: rep.locationId,
    profile: rep.profile,
    plays: rep.plays,
    players: rep.players,
    concurrency: rep.concurrency,
    seed: rep.seed,
    intervalMin: rep.intervalMin === '' ? null : Number(rep.intervalMin),
    sweeps: rep.sweeps === '' ? null : Number(rep.sweeps),
    dryRun: rep.dryRun,
    games: rep.games,
  };

  // The games the chosen profile can actually replay, labelled from the
  // registry. An unknown key (a profile from an older registry) still shows,
  // under its raw key, rather than vanishing from a list that claims to be
  // complete.
  const replayable = (chosenProfile?.summary?.gameKeys ?? []).map(
    (k) => games.find((g) => g.key === k) ?? { key: k, label: k, estRoundMs: null }
  );

  // A capture's wall clock is the honest number to show: the browser plays every
  // round for real, and the games are nowhere near equal (Skee-Ball ~20s a round,
  // Go-Karts ~3 min). Sum the bot's own per-game estimates so this matches what
  // the script prints; fall back to a flat minute a round if they didn't load.
  const selected = cap.games.length ? games.filter((g) => cap.games.includes(g.key)) : games;
  const capMinutes =
    (cap.rounds * selected.reduce((t, g) => t + (g.estRoundMs ?? 60_000), 0)) /
    60_000 /
    Math.max(1, Math.min(cap.workers || 1, 4));

  return (
    <div className="space-y-4">
      {error && (
        <Banner kind="error">
          Couldn’t refresh status — showing last-known state, retrying… ({error.message})
        </Banner>
      )}

      <PageHeader
        title="Arcade bot"
        description={
          <>
            Synthetic arcade traffic in two steps: <strong>capture</strong> plays the real mini-games
            in a browser and writes a score profile, then <strong>replay</strong> posts the awards
            that profile implies at volume. Every award carries a reserved{' '}
            <code>synthetic:&lt;run&gt;:&lt;uuid&gt;</code> session id, so a run is reversible on our
            side. See <code>ARCADE-BOT.md</code>.
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            {fmtInt(syntheticAwards.total)} synthetic awards all-time · {fmtInt(syntheticAwards.last24h)} in 24h ·{' '}
            {fmtInt(syntheticAwards.tickets)} tickets
          </span>
          <span className="ml-auto">
            {games.length} games · {profiles.length} profile{profiles.length === 1 ? '' : 's'}
          </span>
        </div>
      </Card>

      {/* ---- 1. Capture ---- */}
      <Card>
        <div className="flex items-center gap-2">
          <h2 className="font-medium">1 · Capture a profile</h2>
          <span className="text-xs text-slate-500">
            plays the games for real{app?.reachable && app.base ? `, in ${app.base}` : ''}
          </span>
        </div>

        {browser && !browser.available && (
          <div className="mt-3">
            <Banner kind="error">
              <strong>No browser on this host — capture is unavailable.</strong>{' '}
              {/* The reason usually ends in a shell command. Split it onto its own
                  line so it can be copied without picking it out of a sentence. */}
              {(() => {
                const [prose, cmd] = splitCommand(browser?.reason ?? '');
                return (
                  <>
                    {prose}
                    {cmd && (
                      <code className="mt-2 block overflow-x-auto rounded bg-red-100 px-2 py-1 text-xs">
                        {cmd}
                      </code>
                    )}
                  </>
                );
              })()}
              <div className="mt-2">
                <Button
                  variant="ghost"
                  onClick={() => run(() => api.arcadeRecheckBrowser(), setCapErr, 're-check')}
                  disabled={busy}
                >
                  {busy ? 'Checking…' : 'Re-check'}
                </Button>
              </div>
            </Banner>
          </div>
        )}
        {app && !app.reachable && (
          <div className="mt-3">
            <Banner kind="error">
              <strong>The player app isn’t answering — capture is unavailable.</strong>{' '}
              {app.reason}
              <div className="mt-2">
                <Button
                  variant="ghost"
                  onClick={() => run(() => api.arcadeRecheckBrowser(), setCapErr, 're-check')}
                  disabled={busy}
                >
                  {busy ? 'Checking…' : 'Re-check'}
                </Button>
              </div>
            </Banner>
          </div>
        )}
        {browser?.available && app?.reachable && (
          <p className="mt-2 text-xs text-slate-500">
            Browser at <code>{browser.at}</code> · app answering at <code>{app.base}</code>
            {app.why ? ` (${app.why})` : ''}.
          </p>
        )}

        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <Field label="Rounds per game" hint="1–200. Each round is really played.">
            <Input
              type="number"
              min={1}
              max={200}
              value={cap.rounds}
              onChange={(e) => setCap((c) => ({ ...c, rounds: e.target.valueAsNumber }))}
            />
          </Field>
          <Field
            label="Skill"
            hint="Leave blank — that samples a real player mix. 0–1 pins every round to one ability (1 = the regression floor)."
          >
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              placeholder="mixed"
              value={cap.skill}
              onChange={(e) => setCap((c) => ({ ...c, skill: e.target.value }))}
            />
          </Field>
          <Field label="Seed" hint="Same seed replays the same run.">
            <Input
              type="number"
              min={1}
              value={cap.seed}
              onChange={(e) => setCap((c) => ({ ...c, seed: e.target.valueAsNumber }))}
            />
          </Field>
          <Field label="Workers" hint="Concurrent browser pages (1–4). Same seed, same scores at any count.">
            <Input
              type="number"
              min={1}
              max={4}
              value={cap.workers}
              onChange={(e) => setCap((c) => ({ ...c, workers: e.target.valueAsNumber }))}
            />
          </Field>
        </div>

        <div className="mt-3">
          <div className="text-sm font-medium text-slate-700">Games</div>
          <GamePicker games={games} value={cap.games} onChange={(g) => setCap((c) => ({ ...c, games: g }))} />
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {cap.rounds > 0 && Number.isFinite(capMinutes) ? (
            <>
              ≈ {fmtInt(cap.rounds * selected.length)} rounds, roughly{' '}
              <strong>{capMinutes < 1 ? '<1' : fmtInt(capMinutes)} min</strong> of wall clock. No model
              calls, so there’s no token spend — the cost is time and load on the dev app.
            </>
          ) : null}
        </p>

        {canControl ? (
          <div className="mt-3 flex items-center gap-2">
            <Button
              onClick={() => run(() => api.arcadeCapture(captureParams), setCapErr, 'capture')}
              disabled={
                busy ||
                !browser?.available ||
                !app?.reachable ||
                status.capture.running ||
                !Number.isInteger(cap.rounds)
              }
            >
              {status.capture.running ? 'Capture running…' : 'Start capture'}
            </Button>
            {capErr && <span className="text-sm text-red-700">{capErr}</span>}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">Capture is limited to super admins.</p>
        )}

        <div className="mt-3">
          <RunnerPanel
            runner={status.capture}
            canControl={canControl}
            busy={busy}
            onStop={() => run(() => api.arcadeStop('capture'), setCapErr, 'stop')}
          />
        </div>
      </Card>

      {/* ---- 2. Replay ---- */}
      <Card>
        <div className="flex items-center gap-2">
          <h2 className="font-medium">2 · Replay it at volume</h2>
          <span className="text-xs text-slate-500">posts awards to this API</span>
        </div>

        {profiles.length === 0 && (
          <div className="mt-3">
            <Banner kind="info">
              No captured profiles yet. Capture one above, or drop a profile JSON into{' '}
              <code>data/arcade-profiles/</code> on the API host.
            </Banner>
          </div>
        )}

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Profile" hint="Scores come from here — recapture after retuning a game.">
            <Select
              className="w-full"
              value={rep.profile}
              onChange={(e) => setRep((r) => ({ ...r, profile: e.target.value }))}
            >
              <option value="">Select a profile…</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} · {fmtDateTime(p.modifiedAt)}
                  {p.summary
                    ? ` · ${p.summary.games} game${p.summary.games === 1 ? '' : 's'}, ` +
                      `${p.summary.samples} round${p.summary.samples === 1 ? '' : 's'}`
                    : ''}
                  {skillBlurb(p) ? ` · ${skillBlurb(p)!.text}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Venue" hint="Awards land on this venue's cards.">
            <Select
              className="w-full"
              value={rep.locationId}
              onChange={(e) => setRep((r) => ({ ...r, locationId: e.target.value }))}
            >
              <option value="">Select a venue…</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.orgName ? `${v.orgName} — ${v.name}` : v.name}
                  {v.gameRewards ? '' : ' (game rewards off)'}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {chosenProfile?.summary?.samples === 0 && (
          <div className="mt-3">
            <Banner kind="error">
              <strong>This profile recorded 0 rounds</strong> — there is nothing for replay to draw
              from. A capture writes its profile even when every round failed (the app being down
              mid-run does it), so re-capture rather than replaying this one.
            </Banner>
          </div>
        )}

        {chosenProfile &&
          (() => {
            const b = skillBlurb(chosenProfile);
            if (!b) return null;
            return b.fixed ? (
              <p className="mt-3 text-xs text-amber-700">
                This profile was captured at a <strong>fixed skill of {b.text.replace('fixed skill ', '')}</strong>,
                so every award it replays is that same standard of play — fine for load, wrong for
                traffic that should look like an arcade. Capture with the skill field blank for a
                player mix.
              </p>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Player mix: {b.text} across {chosenProfile.summary?.samples ?? 0} captured rounds.
              </p>
            );
          })()}

        {venue && !venue.gameRewards && (
          <div className="mt-3">
            <Banner kind="error">
              <strong>{venue.name} has game rewards switched off</strong> — every award will come back
              403. Turn it on in the venue’s loyalty settings first, or pick another venue.
            </Banner>
          </div>
        )}

        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <Field label="Plays" hint="Awards per sweep (1–5000).">
            <Input
              type="number"
              min={1}
              max={5000}
              value={rep.plays}
              onChange={(e) => setRep((r) => ({ ...r, plays: e.target.valueAsNumber }))}
            />
          </Field>
          <Field label="Players" hint="New accounts+cards to fabricate. Auth allows 10/hour.">
            <Input
              type="number"
              min={0}
              max={10}
              value={rep.players}
              onChange={(e) => setRep((r) => ({ ...r, players: e.target.valueAsNumber }))}
            />
          </Field>
          <Field label="Concurrency" hint="Parallel in-flight awards (1–32).">
            <Input
              type="number"
              min={1}
              max={32}
              value={rep.concurrency}
              onChange={(e) => setRep((r) => ({ ...r, concurrency: e.target.valueAsNumber }))}
            />
          </Field>
          <Field label="Seed" hint="Same seed, same score draw.">
            <Input
              type="number"
              min={1}
              value={rep.seed}
              onChange={(e) => setRep((r) => ({ ...r, seed: e.target.valueAsNumber }))}
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Interval (minutes)" hint="Blank = one sweep and exit. Set to trickle traffic.">
            <Input
              type="number"
              min={1}
              max={1440}
              placeholder="one sweep"
              value={rep.intervalMin}
              onChange={(e) => setRep((r) => ({ ...r, intervalMin: e.target.value }))}
            />
          </Field>
          <Field label="Sweeps" hint="Blank = run until stopped (with an interval set).">
            <Input
              type="number"
              min={1}
              max={1000}
              placeholder="unlimited"
              value={rep.sweeps}
              onChange={(e) => setRep((r) => ({ ...r, sweeps: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-3">
          <div className="text-sm font-medium text-slate-700">Games</div>
          {/* Only what THIS profile captured. Offering the whole registry let
              you pick a game the profile has no samples for, which makes
              arcade-traffic throw "profile has no game" and exit having posted
              nothing. */}
          <GamePicker
            games={replayable}
            value={rep.games}
            onChange={(g) => setRep((r) => ({ ...r, games: g }))}
          />
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={rep.dryRun}
            onChange={(e) => setRep((r) => ({ ...r, dryRun: e.target.checked }))}
          />
          Dry run — draw the scores and print what would be posted, without posting
        </label>

        <p className="mt-2 text-xs text-slate-500">
          The server’s per-game ceiling and per-card daily cap apply to bot traffic exactly as they do
          to real players, so tickets <em>paid</em> can be lower than requested — the run reports both.
          Our ledger rows are deletable by run id, but a settled award has already credited the loyalty
          vendor, which no local delete undoes.
        </p>

        {canControl ? (
          <div className="mt-3 flex items-center gap-2">
            <Button
              onClick={() => run(() => api.arcadeReplay(replayParams), setRepErr, 'replay')}
              disabled={
                busy ||
                status.replay.running ||
                !rep.profile ||
                !rep.locationId ||
                chosenProfile?.summary?.samples === 0 ||
                !Number.isInteger(rep.plays)
              }
            >
              {status.replay.running ? 'Replay running…' : rep.dryRun ? 'Start dry run' : 'Start replay'}
            </Button>
            {repErr && <span className="text-sm text-red-700">{repErr}</span>}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">Replay is limited to super admins.</p>
        )}

        <div className="mt-3">
          <RunnerPanel
            runner={status.replay}
            canControl={canControl}
            busy={busy}
            onStop={() => run(() => api.arcadeStop('replay'), setRepErr, 'stop')}
          />
        </div>
      </Card>

      <ArcadeBotCharts profiles={profiles} games={games} />
    </div>
  );
}
