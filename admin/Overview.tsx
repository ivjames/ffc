import { Link } from 'react-router-dom';
import { api } from './api';
import { Card, Spinner, Banner, useAsync } from './ui';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="text-center">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </Card>
  );
}

export default function Overview() {
  const { data, error, loading } = useAsync(() => api.overview(), []);
  if (loading) return <Spinner />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;
  const t = data.totals;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Orgs" value={t.orgs} />
        <Stat label="Locations" value={t.locations} />
        <Stat label="Courses" value={t.courses} />
        <Stat label="Active rounds" value={t.roundsActive} />
        <Stat label="Rounds · 7d" value={t.rounds7d} />
        <Stat label="Rounds · 30d" value={t.rounds30d} />
        <Stat label="Hunt finds" value={t.huntFinds} />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Per location (last 30 days)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-2">Location</th>
              <th className="pb-2 text-right">Courses</th>
              <th className="pb-2 text-right">Rounds · 30d</th>
            </tr>
          </thead>
          <tbody>
            {data.perLocation.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-2">
                  <Link to={`/locations/${l.id}`} className="font-medium text-slate-900 hover:underline">
                    {l.name}
                  </Link>
                  <span className="ml-2 text-xs text-slate-400">/{l.slug}</span>
                </td>
                <td className="py-2 text-right tabular-nums">{l.courses}</td>
                <td className="py-2 text-right tabular-nums">{l.rounds30d}</td>
              </tr>
            ))}
            {data.perLocation.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-slate-400">
                  No locations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
