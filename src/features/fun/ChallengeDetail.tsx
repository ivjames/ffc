import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useSession } from '../../lib/session';
import { formatScore } from '../../lib/gameScores';
import {
  fetchChallenge,
  subscribeChallenge,
  mergeChallenge,
  sideLabel,
  type ChallengeView,
} from '../../lib/challengesApi';
import { startChallengeRound } from './Challenges';

// /arcade/challenges/:id — one head-to-head.
//
// This screen is what makes the SYNCHRONOUS mode synchronous: both sides sit
// on it and the SSE stream lands the other player's round the moment they
// finish. Played asynchronously it's the same screen, just refreshed later —
// which is exactly why there's no mode switch anywhere in the feature.
//
// The invite code is the whole sharing mechanism. No friend graph, no address
// book, no "connect your contacts": you read six characters to the person
// across the table, or paste them into whatever app you already talk in.

export default function ChallengeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useSession().user;
  const [view, setView] = useState<ChallengeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void fetchChallenge(id).then((r) => {
      if (!live) return;
      // Merged, not assigned: the stream may already have delivered the
      // opponent joining or the result landing while this was in flight.
      if (r.ok) setView((prev) => mergeChallenge(prev, r as unknown as ChallengeView));
      else setError(r.status === 404 ? "That challenge isn't yours to see." : r.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  // Live updates for the sync case. Harmless when nobody else is looking —
  // it just never fires.
  useEffect(() => {
    if (!id || !me) return;
    return subscribeChallenge(id, me.id, (next) => setView((prev) => mergeChallenge(prev, next)));
  }, [id, me]);

  if (error) {
    return (
      <Screen>
        <TopBar title="Challenge" back="/arcade/challenges" />
        <Content>
          <p className="text-sm text-fairway-100/80">{error}</p>
        </Content>
      </Screen>
    );
  }

  if (!view) {
    return (
      <Screen>
        <TopBar title="Challenge" back="/arcade/challenges" />
        <Content>
          <p className="text-sm text-fairway-100/70">Loading…</p>
        </Content>
      </Screen>
    );
  }

  const { challenge, challenger, opponent, winnerId, tied, youWon } = view;
  const mySide = challenger.isYou ? challenger : opponent;
  const theirSide = challenger.isYou ? opponent : challenger;
  const unit = challenge.meta.unit;
  const iHavePlayed = mySide?.score != null;
  const variantLabel = challenge.meta.variants?.find((v) => v.key === challenge.variant)?.label;

  async function share() {
    if (!challenge.inviteCode) return;
    const text = `Beat this: ${challenge.meta.label} on FFC. Code ${challenge.inviteCode}`;
    // Native share where the phone has it (the common case, and it opens the
    // messaging app they'd have pasted into anyway); clipboard otherwise.
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // Cancelled or unsupported — fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy that code by hand — this browser blocked the clipboard.');
    }
  }

  return (
    <Screen>
      <TopBar title="Challenge" back="/arcade/challenges" />
      <Content>
        <div className="text-center">
          <h2 className="text-xl font-black text-fairway-50">{challenge.meta.label}</h2>
          <p className="text-sm text-fairway-400">
            {variantLabel && `${variantLabel} · `}
            {challenge.meta.direction === 'low' ? 'lowest' : 'highest'} {challenge.meta.noun} wins
          </p>
        </div>

        <div className="mt-5 flex items-stretch gap-2">
          <Side label={sideLabel(mySide)} score={mySide?.score ?? null} unit={unit} won={winnerId != null && mySide?.userId === winnerId} />
          <div className="self-center text-sm font-bold text-fairway-400">vs</div>
          <Side label={sideLabel(theirSide)} score={theirSide?.score ?? null} unit={unit} won={winnerId != null && theirSide?.userId === winnerId} />
        </div>

        <p className="mt-4 text-center text-lg font-black text-fairway-50">
          {challenge.status === 'expired'
            ? '⌛️ This challenge expired.'
            : challenge.status === 'complete'
              ? tied
                ? '🤝 Dead heat.'
                : youWon
                  ? '🏆 You win!'
                  : `${sideLabel(theirSide)} takes it.`
              : !iHavePlayed
                ? 'Your round is waiting.'
                : theirSide
                  ? `Waiting on ${sideLabel(theirSide)}…`
                  : 'Send the code to whoever you want to beat.'}
        </p>

        {challenge.status === 'open' && !iHavePlayed && (
          <div className="mt-5">
            <Button
              onClick={() => {
                if (!startChallengeRound(navigate, challenge)) {
                  setError("That game isn't available on this device.");
                }
              }}
            >
              Play your round
            </Button>
            <p className="mt-2 text-center text-xs text-fairway-400">
              One round each — your first score is the one that counts.
            </p>
          </div>
        )}

        {challenge.inviteCode && (
          <div className="mt-6 rounded-2xl border border-fairway-800/60 bg-fairway-900/40 px-4 py-4 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-fairway-400">Their code</p>
            <p className="my-2 text-4xl font-black tracking-[0.2em] text-fairway-50">
              {challenge.inviteCode}
            </p>
            <button onClick={share} className="text-sm font-semibold text-fairway-400">
              {copied ? 'Copied ✓' : 'Share the challenge →'}
            </button>
          </div>
        )}
      </Content>
    </Screen>
  );
}

function Side({
  label,
  score,
  unit,
  won,
}: {
  label: string;
  score: number | null;
  unit: ChallengeView['challenge']['meta']['unit'];
  won: boolean;
}) {
  return (
    <div
      className={`flex-1 rounded-2xl px-3 py-4 text-center ${
        won ? 'bg-fairway-400/20 ring-1 ring-fairway-400/50' : 'bg-fairway-900/40'
      }`}
    >
      <div className="text-xs text-fairway-400">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums text-fairway-50">
        {score === null ? '—' : formatScore(score, unit)}
      </div>
    </div>
  );
}
