import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInstallPrompt } from '../lib/pwaInstall';
import { useLinkedPlayerId } from '../lib/rewardsCard';
import {
  claimAdoptionBonus,
  isBonusHandled,
  markBonusHandled,
  type BonusOutcome,
} from '../lib/pos/adoptionBonus';

// Collects the one-time INSTALL bonus on Home: once the app is installed and a
// card is linked, it claims the reward and shows what landed. If the player has
// installed but not linked a card yet, it invites them to link one to collect —
// turning the bonus into a reason to link. Self-gates to nothing otherwise.
// (The sign-in bonus is claimed inline on the Account screen, at that moment.)

export default function AdoptionBonusToast() {
  const navigate = useNavigate();
  const { installed } = useInstallPrompt();
  const linkedCard = useLinkedPlayerId(); // reactive: re-runs the claim on link
  const [result, setResult] = useState<BonusOutcome | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!installed || isBonusHandled('install')) return;
    let cancelled = false;
    void claimAdoptionBonus('install').then((out) => {
      if (cancelled) return;
      // Terminal outcomes are settled for good; 'no-card' is left open so
      // linking a card later re-runs this and collects it.
      if (out.status === 'awarded' || out.status === 'disabled' || out.status === 'unavailable') {
        markBonusHandled('install');
      }
      if (out.status === 'awarded' || out.status === 'no-card') setResult(out);
    });
    return () => {
      cancelled = true;
    };
  }, [installed, linkedCard]);

  if (dismissed || !result) return null;

  if (result.status === 'awarded') {
    return (
      <div
        className="surface-1 mb-3 flex items-center gap-3 rounded-2xl border border-fairway-500/40 px-4 py-3"
        role="status"
      >
        <span className="text-xl" aria-hidden="true">
          🎟️
        </span>
        <div className="min-w-0 flex-1 text-sm font-bold text-fairway-50">
          +{result.tickets} bonus tickets for installing the app!
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

  // no-card: invite the player to link a card so the bonus has somewhere to land.
  return (
    <div className="surface-1 mb-3 rounded-2xl border border-fairway-500/30 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden="true">
          🎟️
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-fairway-50">Collect your install bonus</div>
          <div className="mt-0.5 text-xs text-fairway-100/70">
            Link your arcade card and we'll drop your bonus tickets straight onto it.
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => navigate('/rewards')}
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
