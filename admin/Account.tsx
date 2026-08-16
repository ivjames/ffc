import { useState } from 'react';
import { api, type CurrentUser } from './api';
import { Banner, Button, Card, Field, Input, PageHeader, useToast } from './ui';

// The signed-in admin's own account. Today that's one thing: the self-service
// password change (POST /api/admin/me/password). Reached from the identity
// line in the sidebar footer. APP_TOKEN pseudo-auth has no admin_user row —
// the server 400s a password change — so the form is replaced by a notice
// (the /me payload's viaToken flag is how we can tell).

function ChangePasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    // Client-side mirrors of the server rules (admin/auth.js) — fail fast,
    // the server re-checks either way.
    if (next.length < 8) {
      setErr('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setErr('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Password changed — your other sessions were signed out.');
    } catch (e) {
      // Includes the 401 for a wrong current password (quiet401 in api.ts
      // keeps that from bouncing the whole shell to the sign-in gate).
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Change password</h2>
      <p className="mb-3 text-xs text-slate-500">
        Changing your password signs you out everywhere else — only this session stays live.
      </p>
      <form onSubmit={submit} className="space-y-3">
        {err && <Banner kind="error">{err}</Banner>}
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={busy || !current || !next || !confirm}>
          {busy ? 'Changing…' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}

export default function Account({ user }: { user: CurrentUser | null }) {
  // No resolved user yet (the token path's brief /me round trip) reads the
  // same as token auth: no password form to show.
  const viaToken = user?.viaToken ?? true;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Account"
        description={
          viaToken
            ? 'Signed in with the shared admin token.'
            : `Signed in as ${user?.email}${user?.role === 'org_admin' ? ' (org admin)' : ''}.`
        }
      />
      {viaToken ? (
        <Banner kind="info">
          The shared admin token has no account password to change. Log in with your own admin
          account to manage a password.
        </Banner>
      ) : (
        <ChangePasswordCard />
      )}
    </div>
  );
}
