import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { formatCents } from '../../lib/pos/pricing';
import type { Player, PlayerTransaction } from '../../lib/pos/types';
import { usePos } from '../../lib/pos';
import { useLinkedPlayerId, setLinkedPlayerId } from '../../lib/rewardsCard';
import { DEV_MODE } from '../../lib/flags';

// /rewards — link the venue's player card to this device, then show live
// balances (cash / game-play credits / tickets) and history. A POS add-on:
// only venues with the `loyalty` capability get this screen. Mini-games and
// promos credit tickets through loyalty.rewardTickets() (gated separately by
// the venue's `gameRewards` flag); food checkout attaches the linked card to
// orders. Linking is a lookup by card number (printed on the physical card)
// or account id — the CenterEdge mock seeds PL-1001/2/3.

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
  const playerId = useLinkedPlayerId();
  const [player, setPlayer] = useState<Player | null>(null);
  const [transactions, setTransactions] = useState<PlayerTransaction[]>([]);
  const [cardInput, setCardInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)load the linked player whenever the link changes.
  useEffect(() => {
    setPlayer(null);
    setTransactions([]);
    setError(null);
    if (!playerId || !loyalty) return;
    let cancelled = false;
    void (async () => {
      const res = await loyalty.fetchPlayer(playerId);
      if (cancelled) return;
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setPlayer(res.player);
      const txs = await loyalty.fetchPlayerTransactions(playerId);
      if (!cancelled && !('error' in txs)) setTransactions(txs.transactions);
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, loyalty]);

  if (!loyalty) return <Navigate to="/" replace />;

  async function link() {
    const query = cardInput.trim();
    if (query === '' || busy || !loyalty) return;
    setBusy(true);
    setError(null);
    const res = await loyalty.fetchPlayer(query);
    setBusy(false);
    if ('error' in res) {
      setError(res.status === 404 ? 'No card found with that number.' : res.error);
      return;
    }
    setCardInput('');
    setLinkedPlayerId(res.player.id); // triggers the load effect above
  }

  // DEV-only: exercise the secure ticket-injection path end to end. Real
  // awards come from mini-games calling loyalty.rewardTickets with the game
  // session id as the idempotency key (venues gated by pos.gameRewards).
  async function awardTestTickets() {
    if (!player || busy || !loyalty) return;
    setBusy(true);
    const res = await loyalty.rewardTickets({
      playerId: player.id,
      tickets: 50,
      source: 'dev:test-award',
      idempotencyKey: crypto.randomUUID(),
    });
    setBusy(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setPlayer({ ...player, balances: { ...player.balances, tickets: res.newTicketBalance } });
    const txs = await loyalty.fetchPlayerTransactions(player.id);
    if (!('error' in txs)) setTransactions(txs.transactions);
  }

  return (
    <Screen>
      <TopBar title="Rewards card" back="/" />
      <Content>
        {!playerId && (
          <>
            <p className="mb-4 text-sm text-fairway-100/70">
              Link your player card to see your balances, earn on food orders, and collect
              tickets from the games in While You Wait. The number is printed on the back of
              your card — or ask at the counter.
            </p>
            <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">
              Card number
            </label>
            <input
              value={cardInput}
              onChange={(e) => {
                setCardInput(e.target.value);
                setError(null);
              }}
              inputMode="numeric"
              maxLength={20}
              placeholder={DEV_MODE ? '770001112223 (mock card)' : 'Card number'}
              className={inputClass}
            />
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            <div className="mt-3">
              <Button onClick={() => void link()} disabled={busy || cardInput.trim() === ''}>
                {busy ? 'Looking up…' : 'Link card'}
              </Button>
            </div>
          </>
        )}

        {playerId && !player && !error && <p className="text-fairway-100/70">Loading…</p>}
        {playerId && error && !player && (
          <>
            <p className="mb-3 text-sm text-red-400">{error}</p>
            <Button variant="ghost" onClick={() => setLinkedPlayerId(null)}>
              Unlink and try another card
            </Button>
          </>
        )}

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
                  onClick={() => setLinkedPlayerId(null)}
                  className="shrink-0 text-sm font-semibold text-fairway-400"
                >
                  Unlink
                </button>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2">
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
              <BalanceTile
                emoji="💵"
                value={formatCents(player.balances.cashCents)}
                label="Cash"
              />
            </div>

            {DEV_MODE && (
              <div className="mb-4">
                <Button variant="ghost" onClick={() => void awardTestTickets()} disabled={busy}>
                  🧪 Award 50 test tickets (dev)
                </Button>
              </div>
            )}

            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

            <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-fairway-400">
              Activity
            </h2>
            {transactions.length === 0 ? (
              <p className="text-sm text-fairway-100/70">
                Nothing yet — food orders and game tickets will show up here.
              </p>
            ) : (
              <div className="space-y-1.5">
                {transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="surface-sunk flex items-center justify-between rounded-xl border border-fairway-800/60 px-3.5 py-2.5 text-sm"
                  >
                    <span className="text-fairway-100/80">
                      {tx.type === 'ticket_reward'
                        ? `🎟️ Tickets · ${tx.source ?? ''}`
                        : '🌭 Food order'}
                    </span>
                    <span className="font-bold text-fairway-50">
                      {tx.type === 'ticket_reward'
                        ? `+${tx.tickets}`
                        : formatCents(tx.amountCents ?? 0)}
                    </span>
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
