import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from './api';
import { Button, Card, Banner, Spinner, Pill, useAsync } from './ui';

export default function OrgDetail({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api.getOrg(id), [id]);

  if (loading) return <Spinner />;
  if (error) return <Banner kind="error">{error.message}</Banner>;
  if (!data) return null;
  const { org, locations } = data;

  async function toggleArchive() {
    await api.archiveOrg(id, !org.archivedAt);
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{org.name}</h1>
          <div className="text-xs text-slate-400">/{org.slug}</div>
        </div>
        {org.archivedAt && <Pill tone="amber">Archived</Pill>}
        <div className="ml-auto flex gap-2">
          <Link to={`/locations/new?orgId=${org.id}`}>
            <Button>+ Location</Button>
          </Link>
          {isSuperAdmin && (
            <Button variant={org.archivedAt ? 'ghost' : 'danger'} onClick={toggleArchive}>
              {org.archivedAt ? 'Unarchive' : 'Archive'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Locations</h2>
        {locations.length === 0 && <p className="text-sm text-slate-400">No locations under this org yet.</p>}
        <div className="space-y-2">
          {locations.map((l) => (
            <div key={l.id} className="flex items-center gap-3 border-t border-slate-100 py-2 first:border-0">
              <button
                className="flex-1 text-left font-medium text-slate-900 hover:underline"
                onClick={() => nav(`/locations/${l.id}`)}
              >
                {l.name}
                <span className="ml-2 text-xs text-slate-400">/{l.slug}</span>
              </button>
              {l.tzLabel && <span className="text-xs text-slate-500">{l.tzLabel}</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
