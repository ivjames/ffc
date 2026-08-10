import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { emailError, normalizeEmail } from '../../lib/validateUser';
import { sanitizeTagInput, tagError, TAG_LENGTH } from '../../lib/sanitize';
import {
  requestCode,
  verifyCode,
  fetchMe,
  updateProfile,
  logout,
  type AppUser,
} from '../../lib/authApi';
import { track } from '../../lib/analytics';
import { claimAdoptionBonus } from '../../lib/pos/adoptionBonus';

// Account — passwordless email sign-in (registration IS sign-in: verifying the
// first code creates the account) plus profile editing once signed in. Email is
// the only contact detail collected, and it's verified by the code flow itself.

const inputClass =
  'surface-sunk w-full rounded-xl border border-fairway-800/60 px-4 py-2.5 text-base text-fairway-50 placeholder:text-fairway-100/40 focus:border-fairway-500 focus:outline-none';
const labelClass = 'mb-1.5 block text-sm font-semibold text-fairway-100/80';

type Stage = 'loading' | 'email' | 'code' | 'signedIn';

export default function Account() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [stage, setStage] = useState<Stage>('loading');
  const [user, setUser] = useState<AppUser | null>(null);

  // Sign-in form state.
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [defaultTag, setDefaultTag] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    params.get('link') === 'expired' ? 'That sign-in link expired — request a fresh code below.' : null,
  );
  const [saved, setSaved] = useState(false);
  const [bonusNotice, setBonusNotice] = useState<string | null>(null);

  // On a fresh sign-in, collect the one-time sign-in bonus onto the linked
  // card. If no card is linked, point the player at the Rewards screen to link
  // one and collect. Only fired from the explicit verify-success paths (never
  // the initial session check), so it runs once per real sign-in.
  async function claimSigninBonus() {
    const out = await claimAdoptionBonus('signin');
    // Only announce a FRESH award — a duplicate replay credits nothing, so
    // don't claim tickets landed that didn't.
    if (out.status === 'awarded' && !out.duplicate) {
      setBonusNotice(`🎟️ +${out.tickets} bonus tickets added to your card!`);
    } else if (out.status === 'no-card') {
      setBonusNotice('Link your arcade card on the Rewards screen to collect a sign-in bonus.');
    }
  }

  useEffect(() => {
    void fetchMe().then((u) => {
      if (u) {
        applyUser(u);
      } else {
        setStage('email');
      }
    });
  }, []);

  function applyUser(u: AppUser) {
    setUser(u);
    setDisplayName(u.displayName ?? '');
    setDefaultTag(u.defaultTag ?? '');
    setStage('signedIn');
  }

  async function sendCode() {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // Top of the sign-in funnel — the player committed an email.
    track('signin_started', { newProfile: !user });
    const profile = {
      ...(displayName.trim() !== '' ? { displayName } : {}),
      ...(defaultTag !== '' ? { defaultTag } : {}),
    };
    const res = await requestCode(normalized, profile);
    if (!res.ok) {
      setBusy(false);
      setError(res.error ?? 'Could not send the code — try again.');
      return;
    }
    // Email delivery not wired up yet on the server: it hands the code back
    // directly, so skip the inbox round-trip and sign straight in.
    if (res.bypassCode) {
      const verified = await verifyCode(normalized, res.bypassCode);
      setBusy(false);
      if (verified.user) {
        track('signin_completed', { method: 'bypass' });
        applyUser(verified.user);
        void claimSigninBonus();
        return;
      }
      track('signin_failed', { method: 'bypass' });
      setError(verified.error ?? 'Sign-in failed — try again.');
      return;
    }
    setBusy(false);
    setCode('');
    setStage('code');
  }

  async function submitCode() {
    const normalized = normalizeEmail(email);
    if (!normalized || code.length !== 6) return;
    setBusy(true);
    setError(null);
    const res = await verifyCode(normalized, code);
    setBusy(false);
    if (!res.user) {
      track('signin_failed', { method: 'code' });
      setError(res.error ?? 'That code didn’t work — check it and try again.');
      return;
    }
    track('signin_completed', { method: 'code' });
    applyUser(res.user);
    void claimSigninBonus();
  }

  async function saveProfile() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await updateProfile({
      displayName: displayName.trim() === '' ? null : displayName,
      defaultTag: defaultTag === '' ? null : defaultTag,
    });
    setBusy(false);
    if (!res.user) {
      setError(res.error ?? 'Could not save — try again.');
      return;
    }
    setUser(res.user);
    setSaved(true);
  }

  async function signOut() {
    setBusy(true);
    await logout();
    setBusy(false);
    setUser(null);
    setEmail('');
    setDisplayName('');
    setDefaultTag('');
    setCode('');
    setSaved(false);
    setStage('email');
  }

  const emailErr = emailError(email);
  const tagErr = defaultTag.length === TAG_LENGTH ? tagError(defaultTag) : null;
  const profileValid = !tagErr && (defaultTag === '' || defaultTag.length === TAG_LENGTH);

  return (
    <Screen>
      <TopBar title="Account" back="/" />
      <Content>
        {bonusNotice && (
          <div
            className="surface-1 mb-4 rounded-2xl border border-fairway-500/40 px-4 py-3 text-sm font-bold text-fairway-50"
            role="status"
          >
            {bonusNotice}
          </div>
        )}
        {stage === 'loading' && <p className="text-fairway-100/70">Loading…</p>}

        {stage === 'email' && (
          <>
            <p className="mb-4 text-sm text-fairway-100/70">
              Save your info and play with friends across phones. We’ll email you a 6-digit
              code — no password to remember.
            </p>
            {notice && <p className="mb-4 text-sm text-amber-400">{notice}</p>}
            <label className={labelClass}>Email</label>
            <input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              className={inputClass}
            />
            {emailErr && <p className="mt-1.5 text-sm text-red-400">{emailErr}</p>}

            <div className="mt-5 space-y-4">
              <div>
                <label className={labelClass}>
                  Name <span className="font-normal text-fairway-100/60">(optional)</span>
                </label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  maxLength={40}
                  placeholder="Sam"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  Arcade tag <span className="font-normal text-fairway-100/60">(optional — prefills rosters)</span>
                </label>
                <input
                  value={defaultTag}
                  onChange={(e) => setDefaultTag(sanitizeTagInput(e.target.value))}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={TAG_LENGTH}
                  placeholder="ABC"
                  className={`${inputClass} font-arcade w-32 text-center text-2xl font-bold uppercase tracking-widest`}
                />
                {tagErr && <p className="mt-1.5 text-sm text-red-400">{tagErr}</p>}
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
            <div className="mt-6">
              <Button
                onClick={() => void sendCode()}
                disabled={busy || email.trim() === '' || !!emailErr || !!tagErr}
              >
                {busy ? 'Sending…' : 'Email me a code'}
              </Button>
            </div>
            <p className="mt-4 text-xs text-fairway-100/50">
              <Link to="/privacy" className="underline">
                How we handle your info
              </Link>
            </p>
          </>
        )}

        {stage === 'code' && (
          <>
            <p className="mb-4 text-sm text-fairway-100/70">
              We sent a 6-digit code to <span className="font-semibold text-fairway-50">{email.trim()}</span>.
              Enter it here — it expires in 10 minutes.
            </p>
            <label className={labelClass}>Code</label>
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError(null);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className={`${inputClass} font-arcade w-48 text-center text-3xl font-bold tracking-[0.4em]`}
            />
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
            <div className="mt-6 space-y-2">
              <Button onClick={() => void submitCode()} disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Sign in'}
              </Button>
              <Button variant="ghost" onClick={() => setStage('email')} disabled={busy}>
                Use a different email
              </Button>
              <Button variant="ghost" onClick={() => void sendCode()} disabled={busy}>
                Resend the code
              </Button>
            </div>
          </>
        )}

        {stage === 'signedIn' && user && (
          <>
            <div className="surface-1 mb-5 rounded-2xl border border-fairway-800/60 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
                Signed in as
              </div>
              <div className="truncate font-bold text-fairway-50">{user.email}</div>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={40}
                  placeholder="Sam"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Arcade tag</label>
                <input
                  value={defaultTag}
                  onChange={(e) => {
                    setDefaultTag(sanitizeTagInput(e.target.value));
                    setSaved(false);
                  }}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={TAG_LENGTH}
                  placeholder="ABC"
                  className={`${inputClass} font-arcade w-32 text-center text-2xl font-bold uppercase tracking-widest`}
                />
                {tagErr && <p className="mt-1.5 text-sm text-red-400">{tagErr}</p>}
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
            {saved && <p className="mt-4 text-sm text-fairway-400">Saved.</p>}
            <div className="mt-6 space-y-2">
              <Button onClick={() => void saveProfile()} disabled={busy || !profileValid}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={() => navigate('/teams')}>
                👥 My teams
              </Button>
              <Button variant="ghost" onClick={() => void signOut()} disabled={busy}>
                Sign out
              </Button>
            </div>
            <p className="mt-4 text-xs text-fairway-100/50">
              <Link to="/privacy" className="underline">
                How we handle your info
              </Link>
            </p>
          </>
        )}
      </Content>
    </Screen>
  );
}
