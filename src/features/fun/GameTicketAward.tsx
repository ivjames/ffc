import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { awardGameTickets, type GameAwardOutcome } from '../../lib/pos/gameRewards';
import { usePos } from '../../lib/pos';
import { useLinkedPlayerId } from '../../lib/rewardsCard';

// Drop-in ticket-award banner for a mini-game's end screen. Self-gating:
// renders nothing unless this venue sells the gameRewards add-on. With a
// linked card it credits `tickets` once per `sessionId` (generate a fresh id
// per round; it's the idempotency key, so re-mounts can't double-credit);
// without one it nudges toward /rewards instead. Usage:
//
//   <GameTicketAward game="trivia" tickets={score * 5} sessionId={sessionId} />

export default function GameTicketAward({
  game,
  tickets,
  sessionId,
}: {
  game: string;
  tickets: number;
  sessionId: string;
}) {
  const navigate = useNavigate();
  const { gameRewards } = usePos();
  const playerId = useLinkedPlayerId();
  const [outcome, setOutcome] = useState<GameAwardOutcome | null>(null);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!gameRewards || !playerId || tickets < 1) return;
    if (attempted.current === sessionId) return; // one attempt per round
    attempted.current = sessionId;
    void awardGameTickets({ game, tickets, sessionId }).then(setOutcome);
  }, [gameRewards, playerId, game, tickets, sessionId]);

  if (!gameRewards || tickets < 1) return null;

  if (!playerId) {
    return (
      <button
        onClick={() => navigate('/rewards')}
        className="surface-1 mt-4 flex w-full items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-3 text-left transition-transform active:translate-y-px"
      >
        <span className="text-sm text-fairway-100/80">
          🎟️ Link your rewards card to earn <b>{tickets} tickets</b> from games like this
        </span>
        <span className="shrink-0 text-sm font-semibold text-fairway-400">Link</span>
      </button>
    );
  }

  // Post-call gating surprises (venue config changed mid-session, card
  // unlinked between render and call) — just disappear quietly.
  if (outcome?.status === 'unavailable' || outcome?.status === 'no-card') return null;

  return (
    <div className="surface-1 mt-4 rounded-2xl border border-fairway-800/60 px-4 py-3 text-center text-sm">
      {outcome === null && <span className="text-fairway-100/70">Adding tickets to your card…</span>}
      {outcome?.status === 'awarded' && (
        <span className="font-bold text-fairway-50">
          🎟️ +{outcome.tickets} tickets · card balance{' '}
          {outcome.newTicketBalance.toLocaleString()}
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
