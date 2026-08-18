import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SeriesBucket } from './api';
import { Button, Card, Input, PageHeader, Spinner, Banner, Table, Th, Td, useAsync } from './ui';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="text-center">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </Card>
  );
}

const monthDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// One small-multiple daily bar chart: single series, so its title carries the
// identity (no legend) and one hue does the work. Thin bars, 2px gaps, native
// per-bar tooltips; the only chrome is the baseline and a max label.
function DailyBars({
  title,
  series,
  value,
  color,
}: {
  title: string;
  series: SeriesBucket[];
  value: (b: SeriesBucket) => number;
  color: string;
}) {
  const W = 300;
  const H = 72;
  const gap = 2;
  const barW = W / series.length - gap;
  const max = Math.max(...series.map(value));
  const total = series.reduce((sum, b) => sum + value(b), 0);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        <span className="text-sm font-semibold tabular-nums text-slate-700">{total}</span>
      </div>
      {max === 0 ? (
        <div className="flex h-[72px] items-end">
          <div className="w-full border-b border-slate-200 pb-1 text-center text-xs text-slate-400">
            No activity in this window
          </div>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${title} per day`}>
          {series.map((b, i) => {
            const v = value(b);
            const h = v === 0 ? 0 : Math.max(2, (v / max) * (H - 14));
            return (
              <rect
                key={b.date}
                x={i * (barW + gap)}
                y={H - 1 - h}
                width={barW}
                height={h}
                rx={1.5}
                fill={color}
              >
                <title>{`${monthDay(b.date)} · ${v} ${title.toLowerCase()}`}</title>
              </rect>
            );
          })}
          <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="#e2e8f0" strokeWidth="1" />
          <text x={W} y={9} textAnchor="end" className="fill-slate-400" fontSize="9">
            peak {max}
          </text>
        </svg>
      )}
    </div>
  );
}

function TrendCharts() {
  const { data, error, loading } = useAsync(() => api.overviewSeries(30), []);
  if (loading) return <Spinner label="Loading trends…" />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data || data.series.length === 0) return null;
  const { series } = data;
  const from = monthDay(series[0].date);
  const to = monthDay(series[series.length - 1].date);
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        Daily trend <span className="font-normal text-slate-400">· {from} – {to}</span>
      </h2>
      <div className="grid gap-6 sm:grid-cols-3">
        <DailyBars title="Rounds" series={series} value={(b) => b.rounds} color="#0284c7" />
        <DailyBars title="Players" series={series} value={(b) => b.players} color="#059669" />
        <DailyBars title="Hunt finds" series={series} value={(b) => b.huntFinds} color="#d97706" />
      </div>
    </Card>
  );
}

function CsvExport() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function download() {
    setErr(null);
    setBusy(true);
    try {
      const blob = await api.exportRoundsCsv({ from: from || undefined, to: to || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rounds_${from || 'last-30d'}_${to || 'today'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Export rounds (CSV)</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">To</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </label>
        <Button onClick={download} disabled={busy}>
          {busy ? 'Preparing…' : 'Download CSV'}
        </Button>
        <span className="text-xs text-slate-400">Blank dates = the last 30 days. One row per player per round.</span>
      </div>
      {err && (
        <div className="mt-2">
          <Banner kind="error">{err}</Banner>
        </div>
      )}
    </Card>
  );
}

export default function Overview({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const { data, error, loading } = useAsync(() => api.overview(), []);
  if (loading) return <Spinner />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;
  const t = data.totals;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Platform totals and the last 30 days of activity."
        actions={
          isSuperAdmin && (
            // Server-rendered benches, not SPA routes (see
            // server/routes/admin/{visionBakeoff,ttsBakeoff}.js). Same-tab
            // navigation keeps the admin session, so they auth seamlessly.
            <span className="flex gap-4">
              <a
                href="/api/admin/tts-bakeoff/ui"
                className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
              >
                Voice bench (trivia read-aloud) →
              </a>
              <a
                href="/api/admin/vision-bakeoff/ui"
                className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
              >
                Vision bench →
              </a>
            </span>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Orgs" value={t.orgs} />
        <Stat label="Locations" value={t.locations} />
        <Stat label="Courses" value={t.courses} />
        <Stat label="Active rounds" value={t.roundsActive} />
        <Stat label="Rounds · 7d" value={t.rounds7d} />
        <Stat label="Rounds · 30d" value={t.rounds30d} />
        <Stat label="Hunt finds" value={t.huntFinds} />
      </div>

      <TrendCharts />

      <Card className="p-0">
        <h2 className="px-3 pt-3 text-sm font-semibold text-slate-700">Per location (last 30 days)</h2>
        <Table>
          <thead>
            <tr>
              <Th>Location</Th>
              <Th align="right">Courses</Th>
              <Th align="right">Rounds · 30d</Th>
            </tr>
          </thead>
          <tbody>
            {data.perLocation.map((l) => (
              <tr key={l.id}>
                <Td>
                  <Link to={`/locations/${l.id}`} className="font-medium text-slate-900 hover:underline">
                    {l.name}
                  </Link>
                  <span className="ml-2 text-xs text-slate-400">/{l.slug}</span>
                </Td>
                <Td align="right">{l.courses}</Td>
                <Td align="right">{l.rounds30d}</Td>
              </tr>
            ))}
            {data.perLocation.length === 0 && (
              <tr>
                <Td colSpan={3} className="py-4 text-center text-slate-400">
                  No locations yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <CsvExport />
    </div>
  );
}
