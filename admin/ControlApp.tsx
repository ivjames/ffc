import { useState, useEffect } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { setToken, clearToken, api, AuthError, ApiError, type CurrentUser } from './api';
import { Button, Card, Field, Input, Banner, ADMIN_TZ_LABEL } from './ui';
import Overview from './Overview';
import Orgs from './Orgs';
import OrgDetail from './OrgDetail';
import LocationWizard from './LocationWizard';
import LocationDetail from './LocationDetail';
import Archived from './Archived';

export function SignInGate({ onUnlock }: { onUnlock: (user: CurrentUser | null) => void }) {
  const [mode, setMode] = useState<'token' | 'login'>('token');
  const [value, setValue] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = await api.login(email.trim(), password);
      onUnlock({ ...user, viaToken: false });
    } catch (err) {
      setError(err instanceof ApiError || err instanceof AuthError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <Card>
        <h1 className="mb-1 text-lg font-semibold">Master Control</h1>
        {mode === 'token' ? (
          <>
            <p className="mb-4 text-sm text-slate-500">Enter the admin token to continue.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setToken(value.trim());
                onUnlock(null);
              }}
              className="space-y-3"
            >
              <Field label="Admin token">
                <Input
                  type="password"
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="APP_TOKEN"
                />
              </Field>
              <Button type="submit" disabled={!value.trim()} className="w-full">
                Unlock
              </Button>
            </form>
            <button
              type="button"
              className="mt-3 text-xs text-slate-500 underline"
              onClick={() => setMode('login')}
            >
              Log in with email and password instead
            </button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">Log in to your Master Control account.</p>
            <form onSubmit={handleLogin} className="space-y-3">
              <Field label="Email">
                <Input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                />
              </Field>
              {error && <Banner kind="error">{error}</Banner>}
              <Button type="submit" disabled={busy || !email.trim() || !password} className="w-full">
                {busy ? 'Logging in…' : 'Log in'}
              </Button>
            </form>
            <button
              type="button"
              className="mt-3 text-xs text-slate-500 underline"
              onClick={() => setMode('token')}
            >
              Use an admin token instead
            </button>
          </>
        )}
      </Card>
    </div>
  );
}

function Shell({ user, onLock }: { user: CurrentUser | null; onLock: () => void }) {
  // While `user` is momentarily unresolved (see the token-path note in
  // ControlApp below), default to false — briefly hiding a super_admin's
  // controls for one round trip reads better than briefly showing an
  // org_admin controls that then vanish.
  const isSuperAdmin = user?.role === 'super_admin';
  const ownOrgId = user?.orgId ?? null;

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200'
    }`;
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
          <span className="mr-2 font-semibold">FFC · Master Control</span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={linkCls}>
              Overview
            </NavLink>
            <NavLink to="/orgs" className={linkCls}>
              Orgs
            </NavLink>
            <NavLink to="/locations/new" className={linkCls}>
              + Location
            </NavLink>
            <NavLink to="/archived" className={linkCls}>
              Archived
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <span className="text-xs text-slate-500">
                {user.viaToken ? 'Admin token' : user.email}
                {!user.viaToken && user.role === 'org_admin' && ' · org admin'}
              </span>
            )}
            <Button variant="ghost" onClick={onLock}>
              Lock
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 text-right text-xs text-slate-400">Times shown in {ADMIN_TZ_LABEL}</div>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/orgs" element={<Orgs isSuperAdmin={isSuperAdmin} />} />
          <Route path="/orgs/:id" element={<OrgDetail isSuperAdmin={isSuperAdmin} />} />
          <Route
            path="/locations/new"
            element={<LocationWizard isSuperAdmin={isSuperAdmin} ownOrgId={ownOrgId} />}
          />
          <Route path="/locations/:id" element={<LocationDetail />} />
          <Route path="/archived" element={<Archived isSuperAdmin={isSuperAdmin} />} />
          <Route path="*" element={<Overview />} />
        </Routes>
      </main>
    </div>
  );
}

type AuthState = 'checking' | 'locked' | 'unlocked';

export default function ControlApp() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [user, setUser] = useState<CurrentUser | null>(null);

  // Any API call that hits 401 dispatches this event -> drop to the gate.
  useEffect(() => {
    const onUnauthorized = () => {
      clearToken();
      setUser(null);
      setAuthState('locked');
    };
    window.addEventListener('ffc-admin-unauthorized', onUnauthorized);
    return () => window.removeEventListener('ffc-admin-unauthorized', onUnauthorized);
  }, []);

  // On load: GET /me works via EITHER auth path (the x-app-token header is
  // sent on every request; a session cookie rides along automatically), so
  // this both restores an already-valid admin_user session (e.g. a page
  // reload after logging in) AND resolves *who* a stored APP_TOKEN belongs to
  // — needed for role-based UI (an org_admin's restricted actions must stay
  // hidden even on the token path, not just for real logins).
  useEffect(() => {
    api.me().then(
      ({ user }) => {
        setUser(user);
        setAuthState('unlocked');
      },
      () => setAuthState('locked')
    );
  }, []);

  if (authState === 'checking') return null;
  if (authState === 'locked') {
    return (
      <SignInGate
        onUnlock={(loggedInUser) => {
          setUser(loggedInUser);
          setAuthState('unlocked');
          if (!loggedInUser) {
            // Token path: onUnlock(null) is optimistic (the client can't tell
            // a real role from the token string), so resolve it for real —
            // this also self-corrects back to the gate if the token is bad,
            // rather than waiting for some other call to fail later.
            api.me().then(
              ({ user }) => setUser(user),
              () => {
                clearToken();
                setUser(null);
                setAuthState('locked');
              }
            );
          }
        }}
      />
    );
  }
  return (
    <Shell
      user={user}
      onLock={() => {
        clearToken();
        setUser(null);
        setAuthState('locked');
        // Harmless no-op if there was no session (APP_TOKEN-only path) — but
        // ends the server-side session if there was one, rather than leaving
        // a still-valid cookie behind after "locking".
        api.logout().catch(() => {});
      }}
    />
  );
}
