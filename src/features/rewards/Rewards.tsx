import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { usePos } from '../../lib/pos';
import { useCard, linkCard, unlinkCard } from '../../lib/rewardsCard';
import { DEV_MODE } from '../../lib/flags';

// /me/rewards — the signed-in player's venue rewards card: link it once, then
// see live balances (tickets / game-play credits) and ticket history. A POS
// add-on: only venues with the `loyalty` capability get this screen, and it
// sits behind AccountGate, so everything below assumes a session.
//
// Linking is a lookup by the number printed on the physical card. That lookup
// now happens SERVER-side (/api/loyalty), which binds the card to the account
// and is the only way to read it afterwards — a card number by itself no
// longer reveals anything about its holder. Mini-games credit tickets through
// /api/game-rewards, which derives the card from the same binding.

const inputClass =
  'surface-sunk w-full rounded-xl border border-fairway-800/60 px-4 py-2.5 text-base text-fairway-50 placeholder:text-fairway-100/40 focus:border-fairway-500 focus:outline-none';

function BalanceTile({ label, value, emoji }: { label: string; value: string; emoji: string }) {
  return (
    <div className="surface-1 flex flex-col items-center gap-1 rounded-2xl border border-fairway-800/60 px-2 py-3 text-center">
      <span className="text-xl" aria-hidden="true">
        {emoji}
      </span>
      <span className="font-arcade text-lg font-black leading-none text-fairway-50">{value}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-fairway-400">
        {label}
      </span>
    </div>
  );
}

export default function Rewards() {
  const { loyalty } = usePos();
  const card = useCard();
  const [cardInput, setCardInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  if (!loyalty) return <Navigate to="/" replace />;

  async function link() {
    const query = cardInput.trim();
    if (query === '' || busy) return;
    setBusy(true);
    setLinkError(null);
    const res = await linkCard(query);
    setBusy(false);
    if (!res.ok) {
      setLinkError(res.error ?? 'Could not link that card.');
      return;
    }
    setCardInput('');
  }

  const { player, transactions } = card;

  // The card shows loyalty activity only — ticket rewards. Food orders are a
  // separate lane (not paid from the card, not attached to it); a linked-card
  // order from before that split may still sit in the vendor's history, so
  // filter rather than assume it's gone.
  const ticketActivity = transactions.filter((tx) => tx.type === 'ticket_reward');

  return (
    <Screen>
      <TopBar title="Rewards card" back="/me" />
      <Content>
        {!card.known && card.loading && <p className="text-fairway-100/70">Loading…</p>}

        {card.known && !player && (
          <>
            <p className="mb-4 text-sm text-fairway-100/70">
              Link your player card to see your balances, keep your food orders on your account,
              and collect tickets from the games in While You Wait. The number is printed on the
              back of your card — or ask at the counter.
            </p>
            <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">
              Card number
            </label>
            <input
              value={cardInput}
              onChange={(e) => {
                setCardInput(e.target.value);
                setLinkError(null);
              }}
              inputMode="numeric"
              maxLength={20}
              placeholder={DEV_MODE ? '770001112223 (mock card)' : 'Card number'}
              className={inputClass}
            />
            {linkError && <p className="mt-2 text-sm text-danger">{linkError}</p>}
            <div className="mt-3">
              <Button onClick={() => void link()} disabled={busy || cardInput.trim() === ''}>
                {busy ? 'Looking up…' : 'Link card'}
              </Button>
            </div>
          </>
        )}

        {card.error && !player && <p className="mt-3 text-sm text-danger">{card.error}</p>}

        {player && (
          <>
            <div className="surface-1 mb-4 rounded-2xl border border-fairway-800/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-black text-fairway-50">
                    {player.displayName}
                  </span>
                  <span className="block text-sm text-fairway-100/70">
                    Card •••{player.cardNumber.slice(-4)}
                    {player.tier !== 'standard' ? ` · ${player.tier}` : ''}
                  </span>
                </span>
                <button
                  onClick={() => void unlinkCard()}
                  className="shrink-0 text-sm font-semibold text-fairway-400"
                >
                  Unlink
                </button>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              <BalanceTile
                emoji="🎟️"
                value={player.balances.tickets.toLocaleString()}
                label="Tickets"
              />
              <BalanceTile
                emoji="🕹️"
                value={player.balances.gamePlayCredits.toLocaleString()}
                label="Credits"
              />
            </div>

            {card.error && <p className="mb-3 text-sm text-danger">{card.error}</p>}

            <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-fairway-400">
              Activity
            </h2>
            {ticketActivity.length === 0 ? (
              <p className="text-sm text-fairway-100/70">
                Nothing yet — game tickets will show up here.
              </p>
            ) : (
              <div className="space-y-1.5">
                {ticketActivity.map((tx) => (
                  <div
                    key={tx.id}
                    className="surface-sunk flex items-center justify-between rounded-xl border border-fairway-800/60 px-3.5 py-2.5 text-sm"
                  >
                    <span className="text-fairway-100/80">🎟️ Tickets · {tx.source ?? ''}</span>
                    <span className="font-bold text-fairway-50">+{tx.tickets}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Content>
    </Screen>
  );
}
