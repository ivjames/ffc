import { useState } from 'react';
import { api, type GameRewardsMeta } from './api';
import { Card, Banner, Spinner, useAsync } from './ui';

// Rewards & usage reporting. Since #157 tickets are the only player-facing
// reward — golf achievements pay straight to a loyalty card and no counter
// codes are surfaced anywhere — so Master Control reports on what's being
// minted (this page) rather than redeeming codes at a counter. Two ledgers:
// golf achievements (reward_grant) and app/arcade rounds (game_ticket_award),
// which share one per-card daily cap.

const ACHIEVEMENT_LABELS: Record<string, string> = {
  hole_in_one: 'Hole-in-One',
  under_par: 'Under Par',
  hunt_master: 'Hunt Master',
};
const achLabel = (key: string) => ACHIEVEMENT_LABELS[key] ?? key;

// Golf achievement issuance — earned vs. banked to a card, and tickets paid.
function AchievementRewards({ days }: { days: number }) {
  const summary = useAsync(() => api.rewardsSummary(days), [days]);

  const totals = summary.data?.byAchievement.reduce(
    (acc, a) => ({
      granted: acc.granted + a.granted,
      cardClaims: acc.cardClaims + a.cardClaims,
      unclaimed: acc.unclaimed + a.unclaimed,
      counter: acc.counter + a.counterRedemptions,
      tickets: acc.tickets + a.tickets,
    }),
    { granted: 0, cardClaims: 0, unclaimed: 0, counter: 0, tickets: 0 }
  );

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700">Achievement rewards (golf)</h2>

      {summary.loading && <Spinner />}
      {summary.error && <Banner kind="error">{summary.error.message}</Banner>}
      {summary.data && summary.data.byAchievement.length === 0 && (
        <p className="py-3 text-center text-sm text-slate-400">
          No golf achievements earned in this window.
        </p>
      )}
      {summary.data && totals && summary.data.byAchievement.length > 0 && (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2">Achievement</th>
                  <th className="px-3 py-2 text-right">Earned</th>
                  <th className="px-3 py-2 text-right">Banked to card</th>
                  <th className="px-3 py-2 text-right">Unclaimed</th>
                  <th className="px-3 py-2 text-right">Tickets paid</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.byAchievement.map((a) => (
                  <tr key={a.achievement} className="border-b border-slate-100">
                    <td className="px-3 py-1.5">
                      {achLabel(a.achievement)}
                      {a.counterRedemptions > 0 && (
                        <span className="ml-2 text-slate-400">
                          +{a.counterRedemptions} counter
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">{a.granted.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right">{a.cardClaims.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right">
                      {a.unclaimed > 0 ? a.unclaimed.toLocaleString() : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold">
                      {a.tickets.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-slate-600">
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{totals.granted.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{totals.cardClaims.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    {totals.unclaimed > 0 ? totals.unclaimed.toLocaleString() : ''}
                  </td>
                  <td className="px-3 py-2 text-right">{totals.tickets.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </Card>

          {summary.data.rows.length > 0 && (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2">Day</th>
                    <th className="px-3 py-2">Venue</th>
                    <th className="px-3 py-2">Achievement</th>
                    <th className="px-3 py-2 text-right">Earned</th>
                    <th className="px-3 py-2 text-right">Banked</th>
                    <th className="px-3 py-2 text-right">Tickets</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.rows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.day.slice(0, 10)}</td>
                      <td className="px-3 py-1.5">{r.locationName ?? '—'}</td>
                      <td className="px-3 py-1.5">{achLabel(r.achievement)}</td>
                      <td className="px-3 py-1.5 text-right">{r.granted.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right">{r.cardClaims.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">
                        {r.tickets.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// App-issued ticket rollup — what the free mini-games are minting into each
// venue's ticket economy (game_ticket_award via the award proxy). The watch
// metric is `tickets` vs the floor's paid economy; capped rounds show the
// daily cap actually biting. Caps are tuned per venue in Location →
// Ticket economy caps.
function GameTicketIssuance({ days }: { days: number }) {
  const usage = useAsync(
    async () => {
      const [meta, data] = await Promise.all([
        api.gameRewardsMeta().catch(() => null as GameRewardsMeta | null),
        api.gameRewardsUsage(days),
      ]);
      return { meta, ...data };
    },
    [days]
  );

  const gameLabel = (key: string) =>
    usage.data?.meta?.games.find((g) => g.key === key)?.label ?? key;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700">App ticket issuance (arcade)</h2>

      {usage.loading && <Spinner />}
      {usage.error && <Banner kind="error">{usage.error.message}</Banner>}
      {usage.data && usage.data.rows.length === 0 && (
        <p className="py-3 text-center text-sm text-slate-400">
          No app tickets issued in this window.
        </p>
      )}
      {usage.data && usage.data.rows.length > 0 && (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Venue</th>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2 text-right">Rounds</th>
                  <th className="px-3 py-2 text-right">Cards</th>
                  <th className="px-3 py-2 text-right">Capped</th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="px-3 py-2 text-right">Tickets</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.day.slice(0, 10)}</td>
                    <td className="px-3 py-1.5">{r.locationName}</td>
                    <td className="px-3 py-1.5">{gameLabel(r.game)}</td>
                    <td className="px-3 py-1.5 text-right">{r.rounds}</td>
                    <td className="px-3 py-1.5 text-right">{r.cards}</td>
                    <td className="px-3 py-1.5 text-right">{r.cappedRounds > 0 ? r.cappedRounds : ''}</td>
                    <td className="px-3 py-1.5 text-right">{r.pendingRounds > 0 ? r.pendingRounds : ''}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{r.tickets.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {usage.data.topCards.length > 0 && (
            <Card>
              <h3 className="mb-1 text-xs font-semibold text-slate-600">Top-earning cards</h3>
              <div className="space-y-0.5 text-xs text-slate-600">
                {usage.data.topCards.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-mono">{c.playerId}</span>
                    <span className="text-slate-400">{c.locationName}</span>
                    <span className="ml-auto">
                      {c.rounds} rounds · <b>{c.tickets.toLocaleString()}</b> tickets
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default function Rewards() {
  const [days, setDays] = useState(30);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Rewards &amp; usage</h1>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="ml-auto rounded border border-slate-300 px-1.5 py-1 text-xs"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        Tickets are the only player-facing reward — golf achievements pay straight to a
        loyalty card, so there are no counter codes to redeem.
      </p>

      <AchievementRewards days={days} />
      <GameTicketIssuance days={days} />
    </div>
  );
}
