import { useState } from 'react';
import { api, type GameRewardsMeta } from './api';
import { Card, Banner, EmptyState, PageHeader, Select, Spinner, Table, Th, Td, useAsync } from './ui';

// Rewards & usage reporting. Two independent things live here, and only one of
// them is money-shaped: golf ACHIEVEMENTS (reward_grant) are badges that pay
// nothing, reported purely as issuance — what players are earning — while
// app/arcade rounds (game_ticket_award) are the actual ticket economy, subject
// to the per-card daily cap. Achievements stopped paying because golf scores
// are self-reported, so there was nothing verifying what a payout rewarded.

// Names come from the server's catalog, served with the rollup. A local map
// here went stale the moment the server learned to grant a new achievement —
// the table would render `first_find` at a venue manager.
const achLabel = (row: { achievement: string; label?: string }) =>
  row.label ?? row.achievement;

// Golf achievement issuance — what players are earning. No ticket columns:
// achievements pay nothing, so there is no claimed/unclaimed state to report.
function AchievementRewards({ days }: { days: number }) {
  const summary = useAsync(() => api.rewardsSummary(days), [days]);

  const totals = summary.data?.byAchievement.reduce(
    (acc, a) => ({ granted: acc.granted + a.granted }),
    { granted: 0 }
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
                </tr>
              </thead>
              <tbody>
                {summary.data.byAchievement.map((a) => (
                  <tr key={a.achievement}>
                    <Td>{achLabel(a)}</Td>
                    <Td align="right" className="font-semibold">
                      {a.granted.toLocaleString()}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-slate-600">
                  <Td>Total</Td>
                  <Td align="right">{totals.granted.toLocaleString()}</Td>
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
                  </tr>
                </thead>
                <tbody>
                  {summary.data.rows.map((r, i) => (
                    <tr key={i}>
                      <Td className="whitespace-nowrap">{r.day.slice(0, 10)}</Td>
                      <Td>{r.locationName ?? '—'}</Td>
                      <Td>{achLabel(r)}</Td>
                      <Td align="right" className="font-semibold">
                        {r.granted.toLocaleString()}
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
        description="Golf achievements are badges and pay nothing — this reports what players are earning. Tickets come from the app's mini-games, below."
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
