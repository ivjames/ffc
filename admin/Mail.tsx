import { useState } from 'react';
import { api, ApiError, AuthError, type MailStatus, type MailWarning } from './api';
import { Banner, Button, Card, Field, Input, PageHeader, Pill, Spinner, useAsync } from './ui';

// Mail — outbound email diagnostics (super_admin only; the server 403s the
// rest).
//
// This screen exists because Resend fails silently. An unverified sending
// domain, a key pasted with a newline, a MAIL_FROM on a domain nobody
// verified: none of them throw, none of them 500, and the app's only symptom
// is a player saying "I never got the code" — days later, to someone else.
// The person doing the DNS work needs a yes/no answer in the same sitting, so
// this page is the two halves of that answer: what the server thinks it is
// configured to do, and what happened when it actually tried.
//
// Nothing here can read a credential back out. The status endpoint returns
// whether one is SET and never its value; an endpoint that echoed the key
// would be a worse problem than the one this solves.

/** One config line. `tone` marks the values that decide whether mail works —
 *  a green/amber pill reads at a glance where a monospace string doesn't. */
function Row({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-slate-100 px-3 py-2 first:border-t-0">
      <div className="w-44 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="min-w-0 flex-1 break-all font-mono text-sm text-slate-800">
        {tone ? <Pill tone={tone === 'ok' ? 'green' : 'amber'}>{value}</Pill> : value}
      </div>
      {hint && <div className="w-full pl-0 text-xs text-slate-500 sm:pl-44">{hint}</div>}
    </div>
  );
}

function Warnings({ warnings }: { warnings: MailWarning[] }) {
  if (warnings.length === 0) {
    return (
      <Banner kind="success">
        No configuration problems found. That is not proof of delivery — send a test below.
      </Banner>
    );
  }
  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <div key={w.code} className="rounded-md bg-amber-50 px-3 py-2 text-sm ring-1 ring-amber-200">
          <p className="text-amber-900">{w.message}</p>
          <p className="mt-1 text-amber-800">
            <span className="font-semibold">Fix:</span> {w.fix}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function Mail() {
  const { data, error, loading, reload } = useAsync(() => api.mailStatus(), []);
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  // The last test's outcome, kept as a value rather than a toast: a provider
  // error is the thing the operator came here to READ, and a toast that fades
  // after four seconds is the wrong container for a 200-character 403 body.
  const [result, setResult] = useState<
    { kind: 'ok'; note: string; delivered: boolean } | { kind: 'fail'; error: string } | null
  >(null);

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setSending(true);
    try {
      const res = await api.mailTest(to.trim());
      // A failed SEND arrives as HTTP 200 with ok:false — the request worked,
      // the delivery didn't. Branching, not catching.
      setResult(
        res.ok
          ? { kind: 'ok', note: res.note, delivered: res.delivered }
          : { kind: 'fail', error: res.error }
      );
    } catch (err) {
      setResult({
        kind: 'fail',
        error:
          err instanceof ApiError || err instanceof AuthError
            ? err.message
            : 'The request itself failed — the server may be down.',
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mail"
        description="What this server is configured to send with, and whether it actually can. Transactional email fails silently when a sending domain isn't verified — this is how you find out before a player does."
        actions={
          <Button variant="ghost" onClick={reload} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {loading && <Spinner />}
      {error && <Banner kind="error">{error.message}</Banner>}

      {data && <StatusView status={data} />}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Send a test message</h2>
        <Card>
          <form onSubmit={sendTest} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Field
                label="To"
                hint="Any address you can check. Look in the spam folder too — an unauthenticated domain lands there before it stops delivering entirely."
              >
                <Input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
            </div>
            <Button type="submit" disabled={sending || !to.trim()}>
              {sending ? 'Sending…' : 'Send test'}
            </Button>
          </form>

          {result && (
            <div className="mt-3">
              {result.kind === 'fail' ? (
                <Banner kind="error">
                  <p className="font-semibold">The send failed. The provider said:</p>
                  <p className="mt-1 break-all font-mono text-xs">{result.error}</p>
                </Banner>
              ) : (
                <Banner kind={result.delivered ? 'success' : 'info'}>{result.note}</Banner>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatusView({ status }: { status: MailStatus }) {
  return (
    <>
      <Warnings warnings={status.warnings} />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Provider</h2>
        <Card className="p-0">
          <Row
            label="MAIL_PROVIDER"
            value={status.provider}
            tone={status.delivers ? 'ok' : 'warn'}
            hint={status.note}
          />
          <Row
            label="Credential"
            value={status.credentialSet ? 'set' : 'NOT SET'}
            tone={status.credentialSet ? 'ok' : 'warn'}
            hint="Whether the provider's key is present. Its value is never returned by this API."
          />
          <Row label="MAIL_FROM" value={status.from} />
          <Row
            label="Sending domains"
            value={status.sendingDomains.length ? status.sendingDomains.join(', ') : '—'}
            hint="What MAIL_FROM is checked against: MAIL_SENDING_DOMAINS if set, otherwise inferred from this platform's own hosts. These are the domains that must be verified with the provider (SPF + DKIM)."
          />
          <Row
            label="Daily cap"
            value={`${status.dailyCap} per org · ${status.globalDailyCap} platform-wide`}
            hint={
              status.dailyCap === 0
                ? 'A cap of 0 is the kill switch — every send is dropped.'
                : 'Rolling 24h, counted per org so one venue cannot exhaust another venue’s sign-in emails.'
            }
          />
        </Card>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Link origin</h2>
        <Card className="p-0">
          <Row
            label="This request"
            value={status.linkOrigin}
            hint="The origin a magic link built right now would point at. Emailed links are built from the host the player's request arrived on — the session cookie is host-only, so a link to the wrong venue signs them in there and leaves them signed out at their own."
          />
          <Row
            label="PLATFORM_FQDN"
            value={status.platformFqdn ?? 'not set'}
            tone={status.platformFqdn ? 'ok' : undefined}
            hint="What makes a venue subdomain a recognised link host. Unset, every tenant's links fall back to PUBLIC_APP_URL."
          />
          <Row label="PUBLIC_APP_URL" value={status.publicAppUrl ?? 'not set'} hint="The fallback origin for a host that isn't recognised." />
          <Row
            label="Live orgs"
            value={status.liveOrgCount ?? 'unknown'}
            hint={
              status.liveOrgCount == null
                ? 'The org count could not be read from the database, so the multi-tenant check above was skipped.'
                : undefined
            }
          />
        </Card>
      </div>
    </>
  );
}
