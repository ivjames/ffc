import { useState } from 'react';
import { api } from './api';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Table,
  Th,
  Td,
  fmtDateTime,
  useAsync,
} from './ui';

// Launch signups — the landing page's early-access list (super_admin only;
// the route and nav entry are gated in ControlApp). Read-only on purpose:
// the list IS the deliverable, so the only action is the CSV export.

function CsvButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function download() {
    setErr(null);
    setBusy(true);
    try {
      const blob = await api.exportLaunchSignupsCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'launch-signups.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs text-red-700">{err}</span>}
      <Button variant="ghost" onClick={download} disabled={busy}>
        {busy ? 'Exporting…' : 'Export CSV'}
      </Button>
    </div>
  );
}

export default function Signups() {
  const { data, error, loading } = useAsync(() => api.listLaunchSignups(), []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Launch signups"
        description="Landing-page early-access signups — venue folks who left their email and agreed to be contacted about the launch and new features."
        actions={<CsvButton />}
      />

      {loading && <Spinner />}
      {error && <Banner kind="error">{error.message}</Banner>}
      {data && data.length === 0 && <EmptyState>No signups yet.</EmptyState>}

      {data && data.length > 0 && (
        <Card className="p-0">
          <Table size="xs">
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Consent</Th>
                <Th>Signed up</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-slate-700">{s.email}</Td>
                  <Td>{s.consent ? 'yes' : ''}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(s.createdAt)}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(s.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
