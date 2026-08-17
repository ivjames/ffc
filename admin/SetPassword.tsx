// Pre-auth /set-password screen — the target of the emailed set-password link
// (provision invites and "Forgot password?"). Verifies the URL token, lets the
// account holder pick a password, and hands the auto-logged-in user back to
// ControlApp so the shell unlocks without a second sign-in.
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, AuthError, type CurrentUser } from './api';
import { BrandMark, Button, Card, Field, Input, Banner, Spinner } from './ui';

/** Same centered single-card layout as the SignInGate. */
function GateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex items-center justify-center gap-2.5">
          <BrandMark className="h-9 w-9" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Master Control</h1>
            <div className="text-xs text-slate-500">FFC back office</div>
          </div>
        </div>
        <Card className="p-5">{children}</Card>
      </div>
    </div>
  );
}

type Phase = 'checking' | 'form' | 'invalid';

export default function SetPassword({
  onDone,
}: {
  onDone: (user: Omit<CurrentUser, 'viaToken'>) => void;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setPhase('invalid');
      return;
    }
    api.checkPasswordToken(token).then(
      ({ email }) => {
        setEmail(email);
        setPhase('form');
      },
      // Invalid (400) and expired/used (410) both land here — the invalid
      // view's copy covers the actionable case (request a new link).
      () => setPhase('invalid')
    );
  }, [token]);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = !busy && password.length >= 8 && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setBusy(true);
    try {
      const { user } = await api.setPassword(token, password);
      onDone(user);
      // replace: the one-time token must not linger in the history stack.
      navigate('/', { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof AuthError ? err.message : 'Something went wrong';
      // The token died between the check and the submit (410 body mentions
      // expired/used) — the invalid view says what to do about it.
      if (/expired|already used/i.test(message)) {
        setPhase('invalid');
      } else {
        setError(message);
      }
      setBusy(false);
    }
  }

  if (phase === 'checking') {
    return (
      <GateFrame>
        <Spinner label="Checking your link…" />
      </GateFrame>
    );
  }

  if (phase === 'invalid') {
    return (
      <GateFrame>
        <p className="mb-4 text-sm text-slate-500">
          This link has expired or was already used. Request a new one from the sign-in page.
        </p>
        <Button className="w-full" onClick={() => navigate('/', { replace: true })}>
          Go to sign-in
        </Button>
      </GateFrame>
    );
  }

  return (
    <GateFrame>
      <p className="mb-4 text-sm text-slate-500">
        Set a password for <strong className="text-slate-700">{email}</strong>.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <Field label="New password" hint="At least 8 characters.">
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
          />
        </Field>
        <Field label="Confirm password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
          />
        </Field>
        {tooShort && <Banner kind="error">Password must be at least 8 characters.</Banner>}
        {!tooShort && mismatch && <Banner kind="error">Passwords don't match.</Banner>}
        {error && <Banner kind="error">{error}</Banner>}
        <Button type="submit" disabled={!canSubmit} className="w-full">
          {busy ? 'Setting password…' : 'Set password'}
        </Button>
      </form>
    </GateFrame>
  );
}
