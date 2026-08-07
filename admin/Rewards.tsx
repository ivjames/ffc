import { useState } from 'react';
import { api, type Reward } from './api';
import { Button, Card, Input, Banner, Spinner, Pill, useAsync, fmtDateTime } from './ui';

// Reward redemption (punchlist #8 tier 1) — the counter flow. A player shows
// the code from their final scorecard; staff type it here, check who/what,
// and mark it redeemed so it only pays out once.

const ACHIEVEMENT_LABELS: Record<string, string> = {
  hole_in_one: 'Hole-in-One',
  under_par: 'Under Par',
  hunt_master: 'Hunt Master',
};

function RewardRow({ reward, onChanged }: { reward: Reward; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card className="flex items-center gap-3">
      <span className="font-mono text-lg font-semibold tracking-widest">{reward.code}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{ACHIEVEMENT_LABELS[reward.achievement] ?? reward.achievement}</span>
          <Pill>{reward.playerTag}</Pill>
        </div>
        <div className="text-xs text-slate-400">
          {reward.courseName}
          {reward.locationName ? ` · ${reward.locationName}` : ''} · earned {fmtDateTime(reward.createdAt)}
          {reward.redeemedAt &&
            ` · redeemed ${fmtDateTime(reward.redeemedAt)}${reward.redeemedBy ? ` by ${reward.redeemedBy}` : ''}`}
        </div>
      </div>
      <Button
        variant={reward.redeemedAt ? 'ghost' : 'primary'}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.redeemReward(reward.id, !reward.redeemedAt);
            onChanged();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : reward.redeemedAt ? 'Undo redeem' : 'Mark redeemed'}
      </Button>
    </Card>
  );
}

export default function Rewards() {
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<Reward[] | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRedeemed, setShowRedeemed] = useState(false);
  const recent = useAsync(() => api.listRewards(showRedeemed), [showRedeemed]);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setLookupErr(null);
    setBusy(true);
    try {
      const rows = await api.lookupReward(code.trim());
      setLookup(rows);
      if (rows.length === 0) setLookupErr(`No reward found for code "${code.trim().toUpperCase()}".`);
    } catch (err) {
      setLookup(null);
      setLookupErr((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const refreshAll = () => {
    recent.reload();
    if (code.trim()) {
      api.lookupReward(code.trim()).then(setLookup, () => {});
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Rewards</h1>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Look up a code</h2>
        <form onSubmit={find} className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="K7M2PX"
            className="font-mono uppercase tracking-widest"
            maxLength={6}
          />
          <Button type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Looking…' : 'Look up'}
          </Button>
        </form>
        {lookupErr && (
          <div className="mt-2">
            <Banner kind="error">{lookupErr}</Banner>
          </div>
        )}
        {lookup && lookup.length > 0 && (
          <div className="mt-3 space-y-2">
            {lookup.map((r) => (
              <RewardRow key={r.id} reward={r} onChanged={refreshAll} />
            ))}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-700">
          {showRedeemed ? 'Recently redeemed' : 'Outstanding (unredeemed)'}
        </h2>
        <button
          type="button"
          className="ml-auto text-xs text-slate-500 underline"
          onClick={() => setShowRedeemed((v) => !v)}
        >
          {showRedeemed ? 'Show outstanding' : 'Show redeemed'}
        </button>
      </div>

      {recent.loading && <Spinner />}
      {recent.error && <Banner kind="error">{recent.error.message}</Banner>}
      {recent.data && (
        <div className="space-y-2">
          {recent.data.map((r) => (
            <RewardRow key={r.id} reward={r} onChanged={refreshAll} />
          ))}
          {recent.data.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">
              {showRedeemed ? 'Nothing redeemed yet.' : 'No outstanding rewards.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
