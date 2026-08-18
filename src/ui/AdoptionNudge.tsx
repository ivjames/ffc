import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInstallPrompt } from '../lib/pwaInstall';
import { nudgeVisible, dismissNudge } from '../lib/nudgeMemory';
import { usePos } from '../lib/pos';
import { track } from '../lib/analytics';
import type { DrawnIcon } from './icons/registry';
import Icon from './Icon';

// Proactive adoption nudge for the Home screen: a single dismissible banner
// that encourages installing the app or signing in — the two funnels we're
// growing. Deliberately gentle: it self-gates (nothing to nudge once you've
// installed / signed in), shows at most ONE nudge at a time, and remembers
// dismissals with an escalating back-off (lib/nudgeMemory) so it never nags.
//
// Tags-as-on-ramp, accounts-as-spine: nobody is blocked, this only invites.

type Kind = 'install' | 'signin';

const COPY: Record<Kind, { icon: DrawnIcon; title: string; cta: string; to: string }> = {
  install: {
    icon: 'action.play-together',
    title: 'Add the app to your phone',
    cta: 'Install',
    to: '/install',
  },
  signin: {
    icon: 'award.trophy',
    title: 'Save your scores & rewards',
    cta: 'Sign in',
    to: '/me/account',
  },
};

// The install pitch's food clause ("buzz you when your food is ready") is only
// true where the venue has in-app ordering — a paid per-venue capability
// (location.pos → usePos().ordering). Promising it at a venue that never
// buzzes anyone is a white-label copy leak, so the clause is gated.
function bodyFor(kind: Kind, hasOrdering: boolean): string {
  if (kind === 'signin') {
    return 'Sign in to keep your rounds and tickets with you across every visit.';
  }
  return hasOrdering
    ? 'One tap — full screen, works offline, and it can buzz you when your food is ready.'
    : 'One tap — full screen, works offline, no app store needed.';
}

export default function AdoptionNudge({
  signedIn,
  authChecked,
  className = '',
}: {
  /** Whether a player account session is active. */
  signedIn: boolean;
  /** True once the session check has resolved — gates the sign-in nudge so it
   *  doesn't flash before we know whether the player is already signed in. */
  authChecked: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const { installed } = useInstallPrompt();
  // usePos re-resolves on content hydration, so enabling ordering in Master
  // Control upgrades the pitch without a reload.
  const hasOrdering = usePos().ordering != null;

  // Pick the first applicable, not-snoozed nudge. Install leads (it's the
  // prerequisite for push and the standalone experience); sign-in falls in
  // behind it.
  const kind: Kind | null =
    !installed && nudgeVisible('install')
      ? 'install'
      : authChecked && !signedIn && nudgeVisible('signin')
        ? 'signin'
        : null;

  // Local hide so dismissing/acting removes it immediately this session.
  const [hidden, setHidden] = useState(false);

  // One impression per shown nudge (per mount). Keyed on kind so switching
  // which nudge is eligible records the new one.
  useEffect(() => {
    if (kind && !hidden) track('nudge_shown', { kind });
  }, [kind, hidden]);

  if (!kind || hidden) return null;
  const c = COPY[kind];
  const body = bodyFor(kind, hasOrdering);

  return (
    <div
      className={`surface-1 rounded-2xl border border-fairway-500/30 px-4 py-3 ${className}`}
      role="region"
      aria-label={c.title}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden="true">
          <Icon name={c.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-fairway-50">{c.title}</div>
          <div className="mt-0.5 text-xs text-fairway-100/70">{body}</div>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => {
                track('nudge_clicked', { kind });
                navigate(c.to);
              }}
              className="btn-accent rounded-lg px-3 py-1.5 text-xs font-bold text-fairway-50"
            >
              {c.cta}
            </button>
            {/* Dismiss takes a SOLID ramp step, not the muted `fairway-100/50`
                wash used elsewhere: at 50% alpha that composites to ~#969696 on
                a white card (2.96:1) — under AA for a control label in every
                skin and mode. `fairway-200` is the lightest step that clears
                4.5:1 against the lightest panel each mode can paint. */}
            <button
              onClick={() => {
                track('nudge_dismissed', { kind });
                dismissNudge(kind);
                setHidden(true);
              }}
              className="text-xs font-semibold text-fairway-200"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
