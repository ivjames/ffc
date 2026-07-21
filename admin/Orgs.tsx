import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Org } from './api';
import { Button, Card, Field, Input, Banner, Spinner, Pill, useAsync } from './ui';

function OrgForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const autoSlug = (v: string) =>
    v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.saveOrg({ name: name.trim(), slug: slug || autoSlug(name) });
      setName('');
      setSlug('');
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">New org (owner / franchise)</h2>
      <form onSubmit={submit} className="space-y-3">
        {err && <Banner kind="error">{err}</Banner>}
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bullwinkle's" />
        </Field>
        <Field label="Slug" hint="Lowercase, hyphenated. Auto-filled from the name if left blank.">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={autoSlug(name) || 'bullwinkles'} />
        </Field>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Create org'}
        </Button>
      </form>
    </Card>
  );
}

export default function Orgs() {
  const { data, error, loading, reload } = useAsync(() => api.listOrgs(), []);
  return (
    <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Orgs</h1>
        {loading && <Spinner />}
        {error && <Banner kind="error">{error.message}</Banner>}
        {data && data.length === 0 && <Banner kind="info">No orgs yet — create one on the right.</Banner>}
        {data?.map((o: Org) => (
          <Card key={o.id} className="flex items-center gap-3">
            <div className="flex-1">
              <Link to={`/orgs/${o.id}`} className="font-medium text-slate-900 hover:underline">
                {o.name}
              </Link>
              <span className="ml-2 text-xs text-slate-400">/{o.slug}</span>
            </div>
            <Pill>{o.locationCount ?? 0} locations</Pill>
          </Card>
        ))}
      </div>
      <OrgForm onSaved={reload} />
    </div>
  );
}
