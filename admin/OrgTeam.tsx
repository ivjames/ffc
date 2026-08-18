// The org's Master Control accounts — step 5 of MULTI-VENUE.md §8's onboarding
// checklist ("create their org_admin account"), which until now had no UI at
// all: /api/admin/users has been full CRUD since the accounts build, reachable
// only from the provisioning wizard at creation time or by hand with curl. An
// org whose admin left, or that was created before invites existed, was
// unfixable from Master Control.
//
// super_admin only, and not by choice: every /users route is gated server-side
// (an org_admin cannot manage accounts, including their own colleagues'), so
// the parent renders an explanation instead of a panel that could only 403.
import { useState } from 'react';
import { api, type AdminUser, type Org } from './api';
import { Banner, Button, Card, EmptyState, Field, Input, Pill, Spinner, fmtDateTime, useToast } from './ui';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Invite form: email only. Role and org are fixed — this panel exists to add
 *  an admin *to this org*, and a super_admin is a platform account that has no
 *  business being created from inside one tenant's page. */
function InviteForm({ org, onInvited }: { org: Org; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Only set when no mail provider is configured — the server hands the link
  // back so the operator can relay it. Never shown otherwise.
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInviteLink(null);
    setBusy(true);
    try {
      const res = await api.inviteUser({ email: email.trim(), role: 'org_admin', orgId: org.id });
      setEmail('');
      setInviteLink(res.inviteLink ?? null);
      // A failed send is NOT a failed create: the account exists either way,
      // so say which happened rather than toasting a flat "invited".
      toast(
        res.inviteSent === false
          ? 'Account created, but the invite email could not be sent.'
          : 'Invite sent.'
      );
      onInvited();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Invite an org admin</h2>
      <p className="mb-3 text-xs text-slate-500">
        They get an emailed link and choose their own password — no password is ever typed here or
        sent to you. Their Master Control login sees only {org.name}.
      </p>
      <form onSubmit={submit} className="space-y-3">
        {err && <Banner kind="error">{err}</Banner>}
        {inviteLink && (
          <Banner kind="info">
            No mail provider is configured, so the set-password link is returned here for you to
            relay: <span className="break-all font-mono text-xs">{inviteLink}</span>
          </Banner>
        )}
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="manager@example.com"
          />
        </Field>
        <Button type="submit" disabled={busy || !EMAIL_RE.test(email.trim())}>
          {busy ? 'Sending…' : 'Send invite'}
        </Button>
      </form>
    </Card>
  );
}

export default function OrgTeam({
  org,
  users,
  loading,
  error,
  reload,
}: {
  org: Org;
  /** Every admin account (the endpoint has no per-org filter); this panel
   *  narrows to the org's own. Fetched by the parent so the Overview tab's
   *  setup checklist reads the same list without a second request. */
  users: AdminUser[] | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}) {
  const toast = useToast();
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const members = (users ?? []).filter((u) => u.orgId === org.id);

  async function remove(user: AdminUser) {
    if (
      !window.confirm(
        `Remove ${user.email}? They lose Master Control access to ${org.name} immediately. Nothing else about the org changes.`
      )
    ) {
      return;
    }
    setActionErr(null);
    setBusyId(user.id);
    try {
      await api.deleteUser(user.id);
      toast('Account removed.');
      reload();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  // Re-mail a set-password link. There is no dedicated resend endpoint —
  // "forgot password" IS the resend path (it works for an invited account that
  // never set one), so this reuses it rather than adding a parallel route.
  // Always reports success: the endpoint deliberately gives no account-exists
  // oracle, so there is nothing truthful to distinguish.
  async function resend(user: AdminUser) {
    setActionErr(null);
    setBusyId(user.id);
    try {
      await api.forgotPassword(user.email);
      toast('Set-password link sent.');
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Admin accounts</h2>
        <p className="mb-3 text-xs text-slate-500">
          People who can sign in to Master Control for this org. Platform super admins are not
          listed — they are not members of any one org.
        </p>
        {actionErr && <Banner kind="error">{actionErr}</Banner>}
        {loading && <Spinner />}
        {error && <Banner kind="error">{error.message}</Banner>}
        {!loading && !error && members.length === 0 && (
          <EmptyState>
            No admin account yet — nobody at this org can sign in. Invite one below.
          </EmptyState>
        )}
        <div className="space-y-2">
          {members.map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-3 border-t border-slate-100 py-2 first:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{u.email}</span>
                <span className="text-xs text-slate-400">added {fmtDateTime(u.createdAt)}</span>
              </span>
              {u.role === 'super_admin' && <Pill tone="amber">Super admin</Pill>}
              <Button variant="ghost" disabled={busyId === u.id} onClick={() => resend(u)}>
                Resend link
              </Button>
              <Button variant="danger" disabled={busyId === u.id} onClick={() => remove(u)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <InviteForm org={org} onInvited={reload} />
    </div>
  );
}
