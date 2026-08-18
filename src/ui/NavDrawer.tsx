import { useEffect, type CSSProperties } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { closeNav, useNavDrawer } from '../lib/navDrawer';
import { useCurrentLocationId } from '../lib/location';
import { locationById } from '../data/courses';
import { usePos } from '../lib/pos';
import { useModules } from '../lib/modules';
import { useSession } from '../lib/session';
import { isStandalone } from '../lib/pwaInstall';
import { playClick } from '../lib/sound';
import ThemeToggle from './ThemeToggle';
import SoundToggle from './SoundToggle';
import BrandLogo from './BrandLogo';
import Icon from './Icon';
import type { DrawnIcon } from './icons/registry';

// The global navigation drawer — the app's one persistent way to move between
// the top-level sections (Home / Golf / Arcade / Food / Me). Opened by the
// hamburger in HeaderControls (present on every screen), mounted once in App.
// Slides in from the right to sit under the top-right hamburger. Closes on
// backdrop tap, Escape, or picking a destination; also self-closes on any route
// change as a backstop. Food and Rewards entries are gated on the venue's POS
// capabilities so a site that doesn't sell them never advertises them.

type Item = {
  to: string;
  icon: DrawnIcon;
  label: string;
  /** Prefix used to mark the row active for the current route. */
  match?: string;
};

function useSectionRows(): { primary: Item[]; secondary: Item[] } {
  const pos = usePos();
  const modules = useModules();
  // The rewards card belongs to an account, so it only appears once there is
  // one — advertising it to a signed-out visitor sent them to a gate.
  const signedIn = useSession().user != null;
  // Only link to the native /food screen for POS-integrated venues — a
  // deep-link-only venue has no /food route (it'd redirect home), so its menu
  // lives on the Home card instead of the drawer.
  const hasFood = pos.ordering != null;

  const primary: Item[] = [
    { to: '/', icon: 'nav.home', label: 'Home', match: '/' },
    { to: '/golf', icon: 'nav.golf', label: 'Mini Golf', match: '/golf' },
    // The arcade is an à la carte module too — a venue that didn't buy it
    // shouldn't have it in the drawer (src/lib/modules.ts).
    ...(modules.arcade
      ? [{ to: '/arcade', icon: 'nav.arcade', label: 'Arcade', match: '/arcade' } as Item]
      : []),
    ...(hasFood ? [{ to: '/food', icon: 'nav.food', label: 'Food & Drink', match: '/food' } as Item] : []),
    { to: '/me', icon: 'nav.me', label: 'Me', match: '/me' },
  ];

  const secondary: Item[] = [
    { to: '/photos', icon: 'nav.photos', label: 'Photo Booth' },
    ...(pos.loyalty && signedIn
      ? [{ to: '/me/rewards', icon: 'nav.rewards', label: 'Rewards card' } as Item]
      : []),
    { to: '/locations', icon: 'nav.locations', label: 'Change location' },
    ...(!isStandalone() ? [{ to: '/install', icon: 'nav.install', label: 'Install app' } as Item] : []),
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
          <div className="flex min-w-0 items-center gap-2.5">
            {/* Tenant logo (badge cut suits the square slot) — explicit
                branding only, nothing when the org hasn't uploaded one. */}
            <BrandLogo prefer="badge" className="h-9 w-9 shrink-0 object-contain" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
                {location ? 'You’re at' : 'Menu'}
              </div>
              <div className="truncate text-lg font-black text-fairway-50">
                {location?.name ?? 'Family Fun Center'}
              </div>
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
                      <Icon name={it.icon} />
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
                    <Icon name={it.icon} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                </button>
              </li>
            ))}
          </ul>

          {/* Settings — the sound + light/dark switches used to ride in every
              screen's header; they live here now. Each row's control is the same
              toggle component, keeping one source of truth for the state. */}
          <div className="mx-1 my-3 h-px bg-fairway-800/60" />
          <div className="space-y-1">
            <div className="flex items-center justify-between rounded-xl px-3.5 py-2">
              <span className="flex items-center gap-3 text-sm font-semibold text-fairway-100/90">
                <Icon name="control.sound-on" className="text-base" />
                Sound
              </span>
              <SoundToggle />
            </div>
            <div className="flex items-center justify-between rounded-xl px-3.5 py-2">
              <span className="flex items-center gap-3 text-sm font-semibold text-fairway-100/90">
                <Icon name="control.theme-dark" className="text-base" />
                Dark mode
              </span>
              <ThemeToggle />
            </div>
          </div>
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
