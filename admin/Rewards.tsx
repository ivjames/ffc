import { useState } from 'react';
import { api, type GameRewardsMeta } from './api';
import { Card, Banner, EmptyState, PageHeader, Select, Spinner, Table, Th, Td, useAsync } from './ui';

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
      pending: acc.pending + a.pending,
      unclaimed: acc.unclaimed + a.unclaimed,
      tickets: acc.tickets + a.tickets,
    }),
    { granted: 0, cardClaims: 0, pending: 0, unclaimed: 0, tickets: 0 }
  );

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700">Achievement rewards (golf)</h2>

      {summary.loading && <Spinner />}
      {summary.error && <Banner kind="error">{summary.error.message}</Banner>}
      {summary.data && summary.data.byAchievement.length === 0 && (
        <EmptyState>No golf achievements earned in this window.</EmptyState>
      )}
      {summary.data && totals && summary.data.byAchievement.length > 0 && (
        <>
          <Card className="p-0">
            <Table size="xs">
              <thead>
                <tr>
                  <Th>Achievement</Th>
                  <Th align="right">Earned</Th>
                  <Th align="right">Banked to card</Th>
                  <Th align="right">Pending</Th>
                  <Th align="right">Unclaimed</Th>
                  <Th align="right">Tickets paid</Th>
                </tr>
              </thead>
              <tbody>
                {summary.data.byAchievement.map((a) => (
                  <tr key={a.achievement}>
                    <Td>{achLabel(a.achievement)}</Td>
                    <Td align="right">{a.granted.toLocaleString()}</Td>
                    <Td align="right">{a.cardClaims.toLocaleString()}</Td>
                    <Td align="right">{a.pending > 0 ? a.pending.toLocaleString() : ''}</Td>
                    <Td align="right">{a.unclaimed > 0 ? a.unclaimed.toLocaleString() : ''}</Td>
                    <Td align="right" className="font-semibold">
                      {a.tickets.toLocaleString()}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-slate-600">
                  <Td>Total</Td>
                  <Td align="right">{totals.granted.toLocaleString()}</Td>
                  <Td align="right">{totals.cardClaims.toLocaleString()}</Td>
                  <Td align="right">{totals.pending > 0 ? totals.pending.toLocaleString() : ''}</Td>
                  <Td align="right">{totals.unclaimed > 0 ? totals.unclaimed.toLocaleString() : ''}</Td>
                  <Td align="right">{totals.tickets.toLocaleString()}</Td>
                </tr>
              </tfoot>
            </Table>
          </Card>

          {summary.data.rows.length > 0 && (
            <Card className="p-0">
              <Table size="xs">
                <thead>
                  <tr>
                    <Th>Day</Th>
                    <Th>Venue</Th>
                    <Th>Achievement</Th>
                    <Th align="right">Earned</Th>
                    <Th align="right">Banked</Th>
                    <Th align="right">Pending</Th>
                    <Th align="right">Tickets</Th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.rows.map((r, i) => (
                    <tr key={i}>
                      <Td className="whitespace-nowrap">{r.day.slice(0, 10)}</Td>
                      <Td>{r.locationName ?? '—'}</Td>
                      <Td>{achLabel(r.achievement)}</Td>
                      <Td align="right">{r.granted.toLocaleString()}</Td>
                      <Td align="right">{r.cardClaims.toLocaleString()}</Td>
                      <Td align="right">{r.pending > 0 ? r.pending.toLocaleString() : ''}</Td>
                      <Td align="right" className="font-semibold">
                        {r.tickets.toLocaleString()}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
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
        <EmptyState>No app tickets issued in this window.</EmptyState>
      )}
      {usage.data && usage.data.rows.length > 0 && (
        <>
          <Card className="p-0">
            <Table size="xs">
              <thead>
                <tr>
                  <Th>Day</Th>
                  <Th>Venue</Th>
                  <Th>Game</Th>
                  <Th align="right">Rounds</Th>
                  <Th align="right">Cards</Th>
                  <Th align="right">Capped</Th>
                  <Th align="right">Pending</Th>
                  <Th align="right">Tickets</Th>
                </tr>
              </thead>
              <tbody>
                {usage.data.rows.map((r, i) => (
                  <tr key={i}>
                    <Td className="whitespace-nowrap">{r.day.slice(0, 10)}</Td>
                    <Td>{r.locationName}</Td>
                    <Td>{gameLabel(r.game)}</Td>
                    <Td align="right">{r.rounds}</Td>
                    <Td align="right">{r.cards}</Td>
                    <Td align="right">{r.cappedRounds > 0 ? r.cappedRounds : ''}</Td>
                    <Td align="right">{r.pendingRounds > 0 ? r.pendingRounds : ''}</Td>
                    <Td align="right" className="font-semibold">
                      {r.tickets.toLocaleString()}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
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
      <PageHeader
        title="Rewards & usage"
        description="Tickets are the only player-facing reward — golf achievements pay straight to a loyalty card, so there are no counter codes to redeem."
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />

      <AchievementRewards days={days} />
      <GameTicketIssuance days={days} />
    </div>
  );
}
