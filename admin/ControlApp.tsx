import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { setToken, clearToken, api, AuthError, ApiError, type CurrentUser } from './api';
import { Button, Card, Field, Input, Banner, ADMIN_TZ_LABEL } from './ui';
import Overview from './Overview';
import Orgs from './Orgs';
import OrgDetail from './OrgDetail';
import LocationWizard from './LocationWizard';
import LocationDetail from './LocationDetail';
import Archived from './Archived';
import Announcements from './Announcements';
import Rewards from './Rewards';
import Photos from './Photos';
import BoothPhotos from './BoothPhotos';
import BoothStickers from './BoothStickers';
import Feedback from './Feedback';
import Hunt from './Hunt';
import HuntItemDetail from './HuntItemDetail';
import SyntheticBot from './SyntheticBot';

// ---------------------------------------------------------------------------
// Nav model
// ---------------------------------------------------------------------------

const ICON_PATHS = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  orgs: (
    <>
      <path d="M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16" />
      <path d="M14 9h4a1 1 0 0 1 1 1v11" />
      <path d="M3 21h18" />
      <path d="M8.5 8h2M8.5 12h2M8.5 16h2M16.5 13h.01M16.5 17h.01" />
    </>
  ),
  newLocation: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z" />
      <path d="M12 7v6M9 10h6" />
    </>
  ),
  announcements: (
    <>
      <path d="m3 11 18-5v12L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
  rewards: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </>
  ),
  hunt: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  photos: (
    <>
      <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5L14.5 4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  booth: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="1.5" />
      <path d="M6 9h12M6 15h12" />
    </>
  ),
  stickers: (
    <>
      <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" />
      <path d="M15 3v6h6" />
      <path d="M9 13h.01M14 13h.01M9.5 16.5s1 1 2.5 1 2.5-1 2.5-1" />
    </>
  ),
  feedback: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </>
  ),
  archived: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </>
  ),
  synthetic: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V5" />
      <circle cx="12" cy="3.5" r="1.5" />
      <path d="M9 13v2M15 13v2" />
    </>
  ),
} as const;

type IconName = keyof typeof ICON_PATHS;

function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  /** Custom active predicate; default is exact match or prefix + '/'. */
  isActive?: (pathname: string) => boolean;
};

type NavSection = { label?: string; items: NavItem[] };

// The Hunt section also contains the vision bench (image vetting) link, so
// the bench has no nav entry of its own.
const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ to: '/', label: 'Overview', icon: 'overview', isActive: (p) => p === '/' }],
  },
  {
    label: 'Venues',
    items: [
      {
        to: '/orgs',
        label: 'Orgs',
        icon: 'orgs',
        // Location detail pages are reached through an org, so keep Orgs lit
        // there too (but not on the standalone new-location wizard).
        isActive: (p) =>
          p === '/orgs' ||
          p.startsWith('/orgs/') ||
          (p.startsWith('/locations/') && p !== '/locations/new'),
      },
      { to: '/locations/new', label: 'New location', icon: 'newLocation' },
      { to: '/archived', label: 'Archived', icon: 'archived' },
    ],
  },
  {
    label: 'Engagement',
    items: [
      { to: '/announcements', label: 'Announcements', icon: 'announcements' },
      { to: '/rewards', label: 'Rewards', icon: 'rewards' },
      { to: '/hunt', label: 'Hunt', icon: 'hunt' },
    ],
  },
  {
    label: 'Media',
    items: [
      { to: '/photos', label: 'Hunt photos', icon: 'photos' },
      { to: '/booth', label: 'Booth photos', icon: 'booth' },
      { to: '/booth-stickers', label: 'Stickers', icon: 'stickers' },
    ],
  },
  {
    label: 'Ops',
    items: [{ to: '/feedback', label: 'Feedback', icon: 'feedback' }],
  },
];

// Load/soak bot — a platform tool, so super_admin only.
const SYNTHETIC_ITEM: NavItem = { to: '/synthetic', label: 'Synthetic', icon: 'synthetic' };

function itemActive(item: NavItem, pathname: string): boolean {
  if (item.isActive) return item.isActive(pathname);
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-lg bg-slate-900 text-white ${className}`}
    >
      {/* Mini-golf flag */}
      <svg
        viewBox="0 0 24 24"
        className="h-4.5 w-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 21V4" />
        <path d="M9 4l8 3-8 3" fill="currentColor" />
        <path d="M4 21h13" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sign-in gate
// ---------------------------------------------------------------------------

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
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex items-center justify-center gap-2.5">
          <BrandMark className="h-9 w-9" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Master Control</h1>
            <div className="text-xs text-slate-500">FFC back office</div>
          </div>
        </div>
        <Card className="p-5">
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
                className="mt-3 text-xs text-slate-500 underline hover:text-slate-700"
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
                className="mt-3 text-xs text-slate-500 underline hover:text-slate-700"
                onClick={() => setMode('token')}
              >
                Use an admin token instead
              </button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function Shell({ user, onLock }: { user: CurrentUser | null; onLock: () => void }) {
  // While `user` is momentarily unresolved (see the token-path note in
  // ControlApp below), default to false — briefly hiding a super_admin's
  // controls for one round trip reads better than briefly showing an
  // org_admin controls that then vanish.
  const isSuperAdmin = user?.role === 'super_admin';
  const ownOrgId = user?.orgId ?? null;

  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  // Navigating (from the drawer) closes it.
  useEffect(() => setNavOpen(false), [pathname]);

  const sections = isSuperAdmin
    ? NAV_SECTIONS.map((s) =>
        s.label === 'Ops' ? { ...s, items: [...s.items, SYNTHETIC_ITEM] } : s
      )
    : NAV_SECTIONS;

  return (
    <div className="min-h-screen lg:flex">
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-200 bg-white transition-transform duration-150 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3.5">
          <BrandMark />
          <span className="text-sm font-semibold leading-tight">FFC · Master Control</span>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {sections.map((section, i) => (
            <div key={section.label ?? i}>
              {section.label && (
                <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.label}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = itemActive(item, pathname);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                        active
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <NavIcon name={item.icon} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-100 px-4 py-3">
          {user && (
            <div className="mb-2 truncate text-xs text-slate-500" title={user.viaToken ? undefined : user.email ?? undefined}>
              {user.viaToken ? 'Admin token' : user.email}
              {!user.viaToken && user.role === 'org_admin' && ' · org admin'}
            </div>
          )}
          <Button variant="ghost" onClick={onLock} className="w-full">
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Lock
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold">Master Control</span>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6 lg:px-8">
          <div className="mb-4 text-right text-xs text-slate-400">
            Times shown in {ADMIN_TZ_LABEL}
          </div>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/orgs" element={<Orgs isSuperAdmin={isSuperAdmin} />} />
            <Route path="/orgs/:id" element={<OrgDetail isSuperAdmin={isSuperAdmin} />} />
            <Route
              path="/locations/new"
              element={<LocationWizard isSuperAdmin={isSuperAdmin} ownOrgId={ownOrgId} />}
            />
            <Route path="/locations/:id" element={<LocationDetail />} />
            <Route path="/announcements" element={<Announcements isSuperAdmin={isSuperAdmin} />} />
            <Route path="/rewards" element={<Rewards />} />
            <Route path="/hunt" element={<Hunt isSuperAdmin={isSuperAdmin} />} />
            <Route path="/hunt/items/:id" element={<HuntItemDetail />} />
            <Route path="/photos" element={<Photos />} />
            <Route path="/booth" element={<BoothPhotos />} />
            <Route path="/booth-stickers" element={<BoothStickers />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/archived" element={<Archived isSuperAdmin={isSuperAdmin} />} />
            {isSuperAdmin && <Route path="/synthetic" element={<SyntheticBot />} />}
            <Route path="*" element={<Overview />} />
          </Routes>
        </main>
      </div>
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
