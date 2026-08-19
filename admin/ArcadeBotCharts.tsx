// Master Control → Ops → Arcade bot, section 3: what the bot actually produced.
//
// The two halves of the tool answer different questions, so this reads in the
// same order they run:
//
//   CAPTURE — is this a believable arcade? A profile is a recording, and what
//     it records is a population of rounds. The charts show the SHAPE of that
//     population (spread per game, skill against outcome) rather than a headline
//     average, because "mean 154" hides the difference between ten mediocre
//     rounds and five terrible ones plus five great ones.
//
//   REPLAY — what did that become in the ledger? Volume over time, and the one
//     number the economy actually cares about: tickets PAID versus requested,
//     which is where the server's per-round ceiling and per-card daily cap show
//     up as a visible gap rather than a footnote.
//
// Both read live from this API, so they show this box's data — a chart of a
// profile captured somewhere else would be a screenshot, not an instrument.
import { useMemo, useState } from 'react';
import { api, type ArcadeProfile } from './api';
import { Banner, Card, Select, Spinner, Table, Th, Td, useAsync } from './ui';
import {
  ChartHead,
  Empty,
  Legend,
  PaidVsClamped,
  RangeBars,
  SkillScatter,
  StatTile,
  TimeBars,
  VIZ,
  fmt,
  type RangeRow,
} from './viz';

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

/** Bucket labels: an hour bucket needs the hour, a day bucket doesn't. */
function bucketLabel(iso: string, unit: 'hour' | 'day') {
  const d = new Date(iso);
  return unit === 'hour'
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// --- Capture -----------------------------------------------------------------

function CaptureCharts({
  profile,
  lowerIsBetter,
}: {
  profile: ArcadeProfile;
  lowerIsBetter: (key: string) => boolean;
}) {
  const { data, error, loading } = useAsync(() => api.arcadeProfile(profile.name), [profile.name]);

  // "Best" points DOWN for a time-scored game (Go-Karts): its best round is
  // stats.min, and normalising by max would label the slowest race best. rel()
  // maps a score to 0..1 with 1 = best in either direction (best/v inverts a
  // time so faster plots higher).
  const bestOf = (g: { key: string; stats: { min: number; max: number } | null }) =>
    g.stats ? (lowerIsBetter(g.key) ? g.stats.min : g.stats.max) : 0;
  const relOf = (key: string, best: number) => (v: number) =>
    best <= 0 || v <= 0 ? 0 : lowerIsBetter(key) ? Math.min(1, best / v) : Math.min(1, v / best);

  const rows = useMemo<RangeRow[]>(() => {
    if (!data) return [];
    return data.games
      .filter((g) => g.stats && g.rounds > 0)
      .map((g) => {
        const st = g.stats!;
        const best = bestOf(g);
        const rel = relOf(g.key, best);
        const low = lowerIsBetter(g.key);
        return {
          key: g.key,
          label: g.label,
          relLo: rel(low ? st.p90 : st.p10),
          relMid: rel(st.p50),
          relHi: rel(low ? st.p10 : st.p90),
          midText: fmt(st.p50),
          title:
            `${g.label} — p10 ${fmt(st.p10)}, p50 ${fmt(st.p50)}, p90 ${fmt(st.p90)}, ` +
            `best ${fmt(best)} (${g.rounds} rounds${low ? ', lower is better' : ''})`,
        };
      })
      // Widest spread first: the games whose distribution actually has shape are
      // the interesting ones, and a flat row at the bottom is its own signal.
      .sort((a, b) => Math.abs(b.relHi - b.relLo) - Math.abs(a.relHi - a.relLo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const points = useMemo(() => {
    if (!data) return [];
    return data.games.flatMap((g) => {
      const best = bestOf(g);
      if (best <= 0) return [];
      const rel = relOf(g.key, best);
      return g.samples
        .filter((s) => s.skill !== null)
        .map((s) => ({
          skill: s.skill as number,
          rel: rel(s.score),
          title: `${g.label} — skill ${(s.skill as number).toFixed(2)} → ${fmt(s.score)} (${s.tickets} tickets)`,
        }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const totalRounds = data?.games.reduce((n, g) => n + g.rounds, 0) ?? 0;
  const skills = points.map((p) => p.skill);

  if (loading && !data) return <Spinner label="Reading the profile…" />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;
  if (totalRounds === 0) return <Empty label="That profile recorded no rounds." />;

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-4">
        <StatTile label="Rounds played" value={fmt(totalRounds)} sub={`${data.games.length} games`} />
        <StatTile
          label="Skill range"
          value={skills.length ? `${Math.min(...skills).toFixed(2)}–${Math.max(...skills).toFixed(2)}` : '—'}
          sub={skills.length ? `mean ${(skills.reduce((a, b) => a + b, 0) / skills.length).toFixed(2)}` : undefined}
        />
        <StatTile
          label="Tickets per round"
          value={fmt(
            data.games.reduce((t, g) => t + g.samples.reduce((s, x) => s + x.tickets, 0), 0) / Math.max(1, totalRounds)
          )}
          sub="mean, before server caps"
        />
        {data.wallMs !== null ? (
          <StatTile
            label="Capture cost"
            value={`${Math.max(1, Math.round(data.wallMs / 60000))} min`}
            sub={`wall clock on ${data.workers ?? 1} worker${(data.workers ?? 1) === 1 ? '' : 's'}`}
          />
        ) : (
          // An older profile records only per-round times. Their sum is
          // aggregate BROWSER time — workers x the wall on a parallel capture —
          // so it must not be captioned "wall clock".
          <StatTile
            label="Capture cost"
            value={`${Math.round(
              data.games.reduce((t, g) => t + (g.stats?.meanRoundMs ?? 0) * g.rounds, 0) / 60000
            )} min`}
            sub="browser time, summed across workers"
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div>
          <ChartHead
            title="Score spread per game"
            aside={<>p10–p90 · median tick · as a share of each game’s best</>}
          />
          <RangeBars rows={rows} />
          <p className="mt-2 text-xs text-slate-500">
            Scores are shown against each game’s own best round, because a Skee-Ball 780 and a Darts
            370 share no scale. A wide band is a mixed field of players; a hairline is one machine
            playing the same round over and over.
          </p>
        </div>
        <div>
          <ChartHead title="Skill → score" aside={`${fmt(points.length)} rounds`} />
          <SkillScatter points={points} />
          <p className="mt-2 text-xs text-slate-500">
            Every captured round, skill against how close it came to that game’s best. A cloud that
            rises left-to-right means the skill knob reaches the game; a flat one means it doesn’t —
            which is a finding about the game, not the chart.
          </p>
        </div>
      </div>

      {/* Table-view twin: p10/p90 ride the tooltip in the chart, so they have to
          be readable without hovering anything. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
          Table view ({rows.length} game{rows.length === 1 ? '' : 's'})
        </summary>
        <div className="mt-2">
          <Table>
            <thead>
              <tr>
                <Th>Game</Th>
                <Th>Rounds</Th>
                <Th>p10</Th>
                <Th>Median</Th>
                <Th>p90</Th>
                <Th>Best</Th>
                <Th>Sec/round</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const g = data.games.find((x) => x.key === r.key);
                if (!g?.stats) return null;
                return (
                  <tr key={r.key}>
                    <Td>{r.label}{lowerIsBetter(r.key) ? ' (time)' : ''}</Td>
                    <Td className="tabular-nums">{fmt(g.rounds)}</Td>
                    <Td className="tabular-nums">{fmt(g.stats.p10)}</Td>
                    <Td className="tabular-nums">{fmt(g.stats.p50)}</Td>
                    <Td className="tabular-nums">{fmt(g.stats.p90)}</Td>
                    <Td className="tabular-nums">{fmt(bestOf(g))}</Td>
                    <Td className="tabular-nums">{(g.stats.meanRoundMs / 1000).toFixed(1)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </details>
    </div>
  );
}

// --- Replay ------------------------------------------------------------------

function TrafficCharts({ days, gameLabel }: { days: number; gameLabel: (k: string) => string }) {
  const { data, error, loading } = useAsync(() => api.arcadeTraffic(days), [days]);
  if (loading && !data) return <Spinner label="Loading traffic…" />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;

  const { totals, byGame, buckets, unit } = data;
  if (totals.awards === 0) return <Empty label="No synthetic awards in this window." />;

  const clamped = totals.requested - totals.awarded;
  const rows = byGame.map((g) => ({
    key: g.game,
    label: gameLabel(g.game),
    awarded: g.awarded,
    requested: g.requested,
  }));

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-4">
        <StatTile label="Awards posted" value={fmt(totals.awards)} sub={`${totals.runs} run${totals.runs === 1 ? '' : 's'}`} />
        <StatTile
          label="Tickets paid"
          value={fmt(totals.awarded)}
          sub={
            `of ${fmt(totals.requested)} requested` +
            (totals.pending > 0 ? ` · ${fmt(totals.pending_tickets)} pending (unconfirmed)` : '')
          }
        />
        <StatTile
          label="Clamped by the server"
          value={pct(clamped, totals.requested)}
          sub={`${fmt(clamped)} tickets · ${fmt(totals.capped)} cap zeros`}
        />
        <StatTile label="Cards used" value={fmt(totals.cards)} sub="synthetic accounts" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <ChartHead
            title="Awards over time"
            aside={`per ${unit} · peak ${fmt(Math.max(...buckets.map((b) => b.awards), 0))}`}
          />
          <TimeBars
            buckets={buckets}
            value={(b) => b.awards}
            label="awards"
            fmtAt={(iso) => bucketLabel(iso, unit)}
          />
        </div>
        <div>
          <ChartHead title="Tickets paid vs clamped" aside="per game" />
          <PaidVsClamped rows={rows} />
          <Legend
            items={[
              { label: 'Paid', color: VIZ.accent },
              { label: 'Clamped away', color: VIZ.second },
            ]}
          />
        </div>
      </div>

      {/* The table view: every value the charts encode, reachable without
          reading a colour or hovering a mark. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
          Table view ({byGame.length} game{byGame.length === 1 ? '' : 's'})
        </summary>
        <div className="mt-2">
          <Table>
            <thead>
              <tr>
                <Th>Game</Th>
                <Th>Awards</Th>
                <Th>Requested</Th>
                <Th>Paid</Th>
                <Th>Clamped</Th>
                <Th>Cap zeros</Th>
              </tr>
            </thead>
            <tbody>
              {byGame.map((g) => (
                <tr key={g.game}>
                  <Td>{gameLabel(g.game)}</Td>
                  <Td className="tabular-nums">{fmt(g.awards)}</Td>
                  <Td className="tabular-nums">{fmt(g.requested)}</Td>
                  <Td className="tabular-nums">{fmt(g.awarded)}</Td>
                  <Td className="tabular-nums">{pct(g.requested - g.awarded, g.requested)}</Td>
                  <Td className="tabular-nums">{fmt(g.capped)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </details>
    </div>
  );
}

// --- The section --------------------------------------------------------------

export default function ArcadeBotCharts({
  profiles,
  games,
}: {
  profiles: ArcadeProfile[];
  games: { key: string; label: string; lowerIsBetter?: boolean }[];
}) {
  const [name, setName] = useState('');
  const [days, setDays] = useState(7);
  const chosen = profiles.find((p) => p.name === name) ?? profiles[0] ?? null;
  const gameLabel = (k: string) => games.find((g) => g.key === k)?.label ?? k;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <h2 className="font-medium">3 · What it produced</h2>
        <span className="text-xs text-slate-500">the capture’s shape, and what replay paid</span>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-slate-700">From the capture</h3>
      {profiles.length === 0 ? (
        <div className="mt-2">
          <Empty label="No captured profiles yet." />
        </div>
      ) : (
        <>
          <div className="mt-2 max-w-md">
            <Select value={chosen?.name ?? ''} onChange={(e) => setName(e.target.value)} className="w-full">
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.summary ? ` · ${p.summary.samples} rounds` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-3">
            {chosen && (
              <CaptureCharts
                profile={chosen}
                lowerIsBetter={(k) => games.find((g) => g.key === k)?.lowerIsBetter === true}
              />
            )}
          </div>
        </>
      )}

      <div className="mt-6 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700">From the replay</h3>
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="text-xs">
          <option value="1">last 24h</option>
          <option value="3">last 3 days</option>
          <option value="7">last 7 days</option>
          <option value="30">last 30 days</option>
        </Select>
      </div>
      <div className="mt-3">
        <TrafficCharts days={days} gameLabel={gameLabel} />
      </div>
    </Card>
  );
}
