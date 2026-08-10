import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInstallPrompt } from '../lib/pwaInstall';
import { useLinkedPlayerId } from '../lib/rewardsCard';
import { getCurrentLocationId } from '../lib/location';
import {
  claimAdoptionBonus,
  wasAttempted,
  markAttempted,
  type BonusKind,
} from '../lib/pos/adoptionBonus';

// Collects the one-time adoption bonuses on Home. It claims each milestone the
// player has reached and can be credited for — install (once installed) and
// sign-in (once signed in) — as soon as a card is linked, and shows what
// landed. If they've reached a milestone but haven't linked a card, it invites
// linking one to collect; linking then re-runs this and collects it (so the
// "link to collect" promise actually pays out, including for the sign-in
// bonus). Self-gates to nothing otherwise.
//
// Claims are guarded per (kind, venue, card) for the session so this doesn't
// re-fire on every render, and the "+N tickets" banner shows ONLY for a fresh
// award — a replayed (duplicate) award credits nothing, so it says nothing.

export default function AdoptionBonusToast({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const { installed } = useInstallPrompt();
  const linkedCard = useLinkedPlayerId(); // reactive: re-runs the claim on link
  const [awarded, setAwarded] = useState<number | null>(null);
  const [needsCard, setNeedsCard] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const locationId = getCurrentLocationId();
    const kinds: BonusKind[] = [];
    if (installed) kinds.push('install');
    if (signedIn) kinds.push('signin');

    let cancelled = false;
    for (const kind of kinds) {
      if (wasAttempted(kind, locationId, linkedCard)) continue;
      void claimAdoptionBonus(kind).then((out) => {
        if (cancelled) return;
        // Terminal for this (kind, venue, card): don't retry it this session.
        // 'no-card' is left open so linking a card re-attempts and collects.
        if (out.status === 'awarded' || out.status === 'disabled' || out.status === 'unavailable') {
          markAttempted(kind, locationId, linkedCard);
        }
        if (out.status === 'awarded' && !out.duplicate) {
          setNeedsCard(false);
          setAwarded((prev) => (prev ?? 0) + out.tickets);
        } else if (out.status === 'no-card') {
          setNeedsCard(true);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [installed, signedIn, linkedCard]);

  if (dismissed) return null;

  if (awarded != null) {
    return (
      <div
        className="surface-1 mb-3 flex items-center gap-3 rounded-2xl border border-fairway-500/40 px-4 py-3"
        role="status"
      >
        <span className="text-xl" aria-hidden="true">
          🎟️
        </span>
        <div className="min-w-0 flex-1 text-sm font-bold text-fairway-50">
          +{awarded} bonus tickets added to your card!
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-xs font-semibold text-fairway-100/50"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }

  if (needsCard) {
    return (
      <div className="surface-1 mb-3 rounded-2xl border border-fairway-500/30 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="text-xl" aria-hidden="true">
            🎟️
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-fairway-50">Collect your bonus tickets</div>
            <div className="mt-0.5 text-xs text-fairway-100/70">
              Link your arcade card and we'll drop your bonus tickets straight onto it.
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => navigate('/me/rewards')}
                className="btn-accent rounded-lg px-3 py-1.5 text-xs font-bold text-fairway-50"
              >
                Link my card
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="text-xs font-semibold text-fairway-100/50"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
