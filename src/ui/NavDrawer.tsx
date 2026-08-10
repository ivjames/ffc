import { useEffect, type CSSProperties } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { closeNav, useNavDrawer } from '../lib/navDrawer';
import { useCurrentLocationId } from '../lib/location';
import { locationById } from '../data/courses';
import { usePos } from '../lib/pos';
import { isStandalone } from '../lib/pwaInstall';
import { playClick } from '../lib/sound';

// The global navigation drawer — the app's one persistent way to move between
// the top-level sections (Home / Golf / Arcade / Food / Me). Opened by the
// hamburger in HeaderControls (present on every screen), mounted once in App.
// Slides in from the right to sit under the top-right hamburger. Closes on
// backdrop tap, Escape, or picking a destination; also self-closes on any route
// change as a backstop. Food and Rewards entries are gated on the venue's POS
// capabilities so a site that doesn't sell them never advertises them.

type Item = {
  to: string;
  emoji: string;
  label: string;
  /** Prefix used to mark the row active for the current route. */
  match?: string;
};

function useSectionRows(): { primary: Item[]; secondary: Item[] } {
  const pos = usePos();
  // Only link to the native /food screen for POS-integrated venues — a
  // deep-link-only venue has no /food route (it'd redirect home), so its menu
  // lives on the Home card instead of the drawer.
  const hasFood = pos.ordering != null;

  const primary: Item[] = [
    { to: '/', emoji: '🏠', label: 'Home', match: '/' },
    { to: '/golf', emoji: '⛳️', label: 'Mini Golf', match: '/golf' },
    { to: '/arcade', emoji: '🎮', label: 'Arcade', match: '/arcade' },
    ...(hasFood ? [{ to: '/food', emoji: '🌭', label: 'Food & Drink', match: '/food' }] : []),
    { to: '/me', emoji: '👤', label: 'Me', match: '/me' },
  ];

  const secondary: Item[] = [
    { to: '/arcade/photos', emoji: '📸', label: 'Photo Booth' },
    ...(pos.loyalty ? [{ to: '/me/rewards', emoji: '🎟️', label: 'Rewards card' }] : []),
    { to: '/join', emoji: '📲', label: "Join a friend's game" },
    { to: '/locations', emoji: '📍', label: 'Change location' },
    ...(!isStandalone() ? [{ to: '/install', emoji: '⬇️', label: 'Install app' }] : []),
  ];

  return { primary, secondary };
}

export default function NavDrawer() {
  const open = useNavDrawer();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { primary, secondary } = useSectionRows();
  const location = locationById(useCurrentLocationId());

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNav();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Backstop: any route change closes the drawer, even one not initiated from a
  // row here (e.g. a redirect).
  useEffect(() => {
    closeNav();
  }, [pathname]);

  const go = (to: string) => {
    playClick();
    closeNav();
    navigate(to);
  };

  // A section is active when the current path is the section root or nested
  // under it. Home only matches exactly (every path is "under" '/').
  const isActive = (match?: string) => {
    if (!match) return false;
    if (match === '/') return pathname === '/';
    return pathname === match || pathname.startsWith(`${match}/`);
  };

  return (
    <>
      {/* Backdrop — fades in; taps close. Kept mounted (pointer-events toggled)
          so the panel can transition rather than pop. */}
      <div
        aria-hidden={!open}
        onClick={() => closeNav()}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        className={`surface-1 fixed inset-y-0 right-0 z-50 flex w-[82%] max-w-xs flex-col border-l border-fairway-800/60 shadow-2xl transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
              {location ? 'You’re at' : 'Menu'}
            </div>
            <div className="truncate text-lg font-black text-fairway-50">
              {location?.name ?? 'Family Fun Center'}
            </div>
          </div>
          <button
            onClick={() => closeNav()}
            className="key flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-fairway-100"
            aria-label="Close menu"
          >
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <ul className="space-y-1.5">
            {primary.map((it, i) => {
              const active = isActive(it.match);
              return (
                <li key={it.to}>
                  <button
                    onClick={() => go(it.to)}
                    style={{ '--i': i } as CSSProperties}
                    className={`animate-rise-in flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left text-base font-bold transition-transform active:translate-y-px ${
                      active
                        ? 'btn-accent border-transparent text-fairway-50'
                        : 'surface border-fairway-800/60 text-fairway-50'
                    }`}
                  >
                    <span className="text-xl" aria-hidden="true">
                      {it.emoji}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {active && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-fairway-50/80">
                        Here
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mx-1 my-3 h-px bg-fairway-800/60" />

          <ul className="space-y-1">
            {secondary.map((it) => (
              <li key={it.to}>
                <button
                  onClick={() => go(it.to)}
                  className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold text-fairway-100/90 transition-transform active:translate-y-px active:bg-fairway-800/40"
                >
                  <span className="text-base" aria-hidden="true">
                    {it.emoji}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="px-4 pb-3 pt-1 text-center">
          <button
            onClick={() => go('/me/privacy')}
            className="text-[11px] font-medium text-fairway-400 underline underline-offset-2"
          >
            Privacy
          </button>
        </div>
      </aside>
    </>
  );
}
