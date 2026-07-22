import { api } from './api';
import { Button, Card, Banner, Spinner, useAsync, fmtDateTime, ADMIN_TZ_LABEL } from './ui';

export default function Archived({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const orgs = useAsync(() => api.listOrgs(true), []);
  const locations = useAsync(() => api.listLocations({ archived: true }), []);

  const archivedOrgs = orgs.data?.filter((o) => o.archivedAt) ?? [];
  const archivedLocations = locations.data?.filter((l) => l.archivedAt) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Archived</h1>
      <p className="text-sm text-slate-500">
        Archived items are hidden from players and the main lists, but nothing is deleted — history stays intact.
        Unarchive to restore. Times shown in {ADMIN_TZ_LABEL}.
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Orgs</h2>
        {orgs.loading && <Spinner />}
        {orgs.error && <Banner kind="error">{orgs.error.message}</Banner>}
        {!orgs.loading && archivedOrgs.length === 0 && <p className="text-sm text-slate-400">None.</p>}
        {archivedOrgs.map((o) => (
          <Card key={o.id} className="flex items-center gap-3">
            <span className="flex-1 font-medium">
              {o.name} <span className="text-xs text-slate-400">/{o.slug}</span>
              {o.archivedAt && (
                <span className="ml-2 text-xs font-normal text-slate-400">archived {fmtDateTime(o.archivedAt)}</span>
              )}
            </span>
            {isSuperAdmin && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await api.archiveOrg(o.id, false);
                  orgs.reload();
                }}
              >
                Unarchive
              </Button>
            )}
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Locations</h2>
        {locations.loading && <Spinner />}
        {locations.error && <Banner kind="error">{locations.error.message}</Banner>}
        {!locations.loading && archivedLocations.length === 0 && <p className="text-sm text-slate-400">None.</p>}
        {archivedLocations.map((l) => (
          <Card key={l.id} className="flex items-center gap-3">
            <span className="flex-1 font-medium">
              {l.name} <span className="text-xs text-slate-400">/{l.slug}</span>
              {l.archivedAt && (
                <span className="ml-2 text-xs font-normal text-slate-400">archived {fmtDateTime(l.archivedAt)}</span>
              )}
            </span>
            <Button
              variant="ghost"
              onClick={async () => {
                await api.archiveLocation(l.id, false);
                locations.reload();
              }}
            >
              Unarchive
            </Button>
          </Card>
        ))}
      </section>
    </div>
  );
}
