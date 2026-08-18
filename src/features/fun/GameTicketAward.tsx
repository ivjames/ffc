import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { awardGameTickets, type GameAwardOutcome } from '../../lib/pos/gameRewards';
import { usePos } from '../../lib/pos';
import { useLinkedPlayerId } from '../../lib/rewardsCard';
import { useSession } from '../../lib/session';
import Icon from '../../ui/Icon';

// Drop-in ticket-award banner for a mini-game's end screen. Self-gating:
// renders nothing unless this venue sells the gameRewards add-on. With a
// linked card it credits `tickets` once per `sessionId` (generate a fresh id
// per round; it's the idempotency key, so re-mounts can't double-credit);
// without one it nudges toward /rewards instead. Usage:
//
//   <GameTicketAward game="trivia" tickets={score * 5} sessionId={sessionId} />

// The server's hard per-round ceiling (lib/gameRewards.js HARD_MAX_PER_ROUND).
// Mirrored here so a monster round on an uncapped formula (e.g. batting
// cages' total*2) never PROMISES more than the award proxy will pay.
const MAX_PER_ROUND = 100;

export default function GameTicketAward({
  game,
  tickets: rawTickets,
  sessionId,
}: {
  game: string;
  tickets: number;
  sessionId: string;
}) {
  const tickets = Math.min(MAX_PER_ROUND, rawTickets);
  const navigate = useNavigate();
  const { gameRewards } = usePos();
  const playerId = useLinkedPlayerId();
  const signedIn = useSession().user != null;
  const [outcome, setOutcome] = useState<GameAwardOutcome | null>(null);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!gameRewards || !playerId || tickets < 1) return;
    if (attempted.current === sessionId) return; // one attempt per round
    attempted.current = sessionId;
    void awardGameTickets({ game, tickets, sessionId }).then(setOutcome);
  }, [gameRewards, playerId, game, tickets, sessionId]);

  if (!gameRewards || tickets < 1) return null;

  // Tickets land on a card, and a card belongs to an account — so the pitch
  // depends on which of the two is missing. Sending a signed-out player
  // straight at /me/rewards would just bounce them off the account gate.
  if (!playerId) {
    const signedOut = !signedIn;
    return (
      <button
        onClick={() => navigate(signedOut ? '/me/account?next=/me/rewards' : '/me/rewards')}
        className="surface-1 mt-4 flex w-full items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-3 text-left transition-transform active:translate-y-px"
      >
        <span className="text-sm text-fairway-100/80">
          <Icon name="award.ticket" />{' '}
          {signedOut ? (
            <>
              Sign in and link your rewards card to earn <b>{tickets} tickets</b> from games like
              this
            </>
          ) : (
            <>
              Link your rewards card to earn <b>{tickets} tickets</b> from games like this
            </>
          )}
        </span>
        <span className="shrink-0 text-sm font-semibold text-fairway-400">
          {signedOut ? 'Sign in' : 'Link'}
        </span>
      </button>
    );
  }

  // Post-call gating surprises (venue config changed mid-session, card
  // unlinked between render and call) — just disappear quietly. Hitting the
  // card's daily ticket cap is the same: not a failure worth nagging about, so
  // the banner simply doesn't show.
  if (
    outcome?.status === 'unavailable' ||
    outcome?.status === 'no-card' ||
    outcome?.status === 'daily-cap'
  )
    return null;

  return (
    <div className="surface-1 mt-4 rounded-2xl border border-fairway-800/60 px-4 py-3 text-center text-sm">
      {outcome === null && <span className="text-fairway-100/70">Adding tickets to your card…</span>}
      {/* Render the SERVER's number — the award may have been clamped by the
          venue's per-game ceiling or the card's remaining daily allowance. */}
      {outcome?.status === 'awarded' && (
        <span className="font-bold text-fairway-50">
          <Icon name="award.ticket" /> +{outcome.tickets} tickets
          {outcome.newTicketBalance !== null && (
            <> · card balance {outcome.newTicketBalance.toLocaleString()}</>
          )}
        </span>
      )}
      {outcome?.status === 'error' && (
        <span className="text-fairway-100/70">
          Couldn't reach the ticket system — your tickets are safe, show this screen at the
          counter. ({outcome.error})
        </span>
      )}
    </div>
  );
}
