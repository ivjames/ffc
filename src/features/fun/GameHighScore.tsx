import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentLocationId } from '../../lib/location';
import { useSession } from '../../lib/session';
import {
  recordScore,
  formatScore,
  rowLabel,
  type RecordResult,
  type BoardRow,
} from '../../lib/gameScores';
import { activeChallengeFor, clearActiveChallenge } from '../../lib/activeChallenge';
import { playChallenge, sideLabel, type ChallengeView } from '../../lib/challengesApi';

// Drop-in high-score board for a mini-game's end screen. Same shape and same
// self-gating contract as <GameTicketAward>: mount it with the round's score
// and a per-round session id, and it handles the rest.
//
//   <GameHighScore game="skeeball" score={total} sessionId={sessionId} />
//
// The session id is the idempotency key, so a re-mounted end screen (or a
// retried request) can't stack duplicate rows — generate a fresh one per round,
// exactly as the ticket award requires. Games already do: both components can
// share the one `sessionId` the screen already holds.
//
// Signed-out players see a sign-in nudge instead of a board. That isn't a
// gate for its own sake: a board keyed on 3-char tags would be unownable —
// anyone could claim anyone's record — so a score belongs to an account or it
// isn't recorded (the account-required model, PR #200).
//
// Failure is silent by design. A board that can't be reached must never break
// the end screen the player is looking at, so a network error just renders
// nothing and the round's score still shows above.

/** Rows to show. Ten is the ask, and it's also about what fits a phone without
 *  the board pushing the "play again" button off screen. */
const BOARD_ROWS = 10;

function Medal({ rank }: { rank: number }) {
  if (rank > 3) return <span className="w-6 text-right tabular-nums text-fairway-400">{rank}</span>;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  return (
    <span className="w-6 text-right" aria-label={`rank ${rank}`}>
      {medal}
    </span>
  );
}

function Row({
  row,
  unit,
  isMe,
}: {
  row: BoardRow;
  unit: RecordResult['meta']['unit'];
  isMe: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm ${
        isMe ? 'bg-fairway-400/15 font-bold text-fairway-50' : 'text-fairway-100/80'
      }`}
    >
      <Medal rank={row.rank} />
      <span className="tag-chip shrink-0">{rowLabel(row)}</span>
      <span className="ml-auto tabular-nums">{formatScore(row.score, unit)}</span>
    </li>
  );
}

export default function GameHighScore({
  game,
  variant,
  score,
  detail,
  sessionId,
}: {
  game: string;
  /** Which sub-board this run belongs on. Required for the games that aren't
   *  comparable to themselves — the go-kart track, Arcade Putt's mode — and
   *  omitted for every other game, which has a single board. */
  variant?: string;
  score: number;
  detail?: Record<string, unknown>;
  sessionId: string;
}) {
  const navigate = useNavigate();
  const locationId = useCurrentLocationId();
  const me = useSession().user;
  const signedIn = me != null;
  const [result, setResult] = useState<RecordResult | null>(null);
  const [failed, setFailed] = useState(false);
  const attempted = useRef<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeView | null>(null);
  const challengeAttempted = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn || !locationId) return;
    if (attempted.current === sessionId) return; // one submission per round
    attempted.current = sessionId;
    void recordScore({ locationId, game, variant, score, detail, sessionId }).then((r) => {
      if (r) setResult(r);
      else setFailed(true);
    });
    // `detail` is display-only extra data captured at mount; excluded from the
    // deps so a fresh object literal each render can't re-fire the submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, locationId, game, variant, score, sessionId]);

  // If this round was played FOR a challenge, submit it there too. The marker
  // is matched against this exact board (game + variant), so a Boomerang
  // challenge can't swallow a Speedway lap.
  //
  // Cleared on the first attempt whatever the outcome: a challenge allows one
  // round each, so a retry that re-sent the marker could only ever produce a
  // "you've already played" — while leaving the marker armed to eat the
  // player's NEXT casual round.
  useEffect(() => {
    if (!signedIn) return;
    const active = activeChallengeFor(game, variant ?? '');
    if (!active) return;
    if (challengeAttempted.current === sessionId) return;
    challengeAttempted.current = sessionId;
    clearActiveChallenge();
    void playChallenge(active.challengeId, { score, detail, sessionId }).then((r) => {
      if (r.ok) setChallenge(r as unknown as ChallengeView);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, game, variant, score, sessionId]);

  // No venue resolved yet (first launch, before the catalog hydrates) — there
  // is no board to be on, so say nothing.
  if (!locationId) return null;

  if (!signedIn) {
    return (
      <button
        onClick={() => navigate('/me/account?next=/arcade/scores')}
        className="surface-1 mt-4 flex w-full items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-3 text-left transition-transform active:translate-y-px"
      >
        <span className="text-sm text-fairway-100/80">
          🏆 Sign in to put this score on the <b>high score board</b>
        </span>
        <span className="shrink-0 text-sm font-semibold text-fairway-400">Sign in</span>
      </button>
    );
  }

  // The challenge result is its own card, above the board: it's the reason
  // this round was played, so it outranks "where you sit at the venue".
  const challengeCard = challenge ? (
    <ChallengeCard view={challenge} />
  ) : null;

  if (failed) return challengeCard;

  if (!result) {
    return (
      <>
        {challengeCard}
        <div className="surface-1 mt-4 rounded-2xl border border-fairway-800/60 px-4 py-3 text-center text-sm text-fairway-100/70">
          Checking the high score board…
        </div>
      </>
    );
  }

  const { meta, board, standing, isPersonalBest, previousBest } = result;
  const topRank = board[0]?.rank ?? null;
  const tookTheCrown = standing?.rank === 1 && isPersonalBest && topRank === 1;

  return (
    <>
      {challengeCard}
      <div className="surface-1 mt-4 rounded-2xl border border-fairway-800/60 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-fairway-50">High scores</h3>
        <span className="text-xs text-fairway-400">
          {/* Name the sub-board, not the game: on a variant game the player
              needs to know this is the Boomerang board, not every track's. */}
          {meta.variants?.find((v) => v.key === variant)?.label ?? meta.label} · best {meta.noun}
        </span>
      </div>

      {/* The celebration line, strongest claim first: a new venue record beats
          a personal best, which beats a plain standing. */}
      {tookTheCrown ? (
        <p className="mt-1 text-sm font-black text-fairway-50">
          👑 New venue record — you're #1!
        </p>
      ) : isPersonalBest ? (
        <p className="mt-1 text-sm font-bold text-fairway-100">
          ⭐️ New personal best
          {previousBest !== null && (
            <span className="font-normal text-fairway-400">
              {' '}
              (was {formatScore(previousBest, meta.unit)})
            </span>
          )}
          {standing && <span className="font-normal text-fairway-400"> · #{standing.rank}</span>}
        </p>
      ) : (
        standing && (
          <p className="mt-1 text-sm text-fairway-100/80">
            Your best is <b>{formatScore(standing.score, meta.unit)}</b> — #{standing.rank} of{' '}
            {standing.outOf}
          </p>
        )
      )}

      {board.length === 0 ? (
        <p className="mt-2 text-sm text-fairway-100/70">
          No scores here yet — yours will be the first.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-0.5">
          {board.slice(0, BOARD_ROWS).map((row) => (
            <Row
              key={row.userId}
              row={row}
              unit={meta.unit}
              isMe={row.userId === me?.id}
            />
          ))}
        </ol>
      )}

      <button
        onClick={() => navigate('/arcade/scores')}
        className="mt-2 w-full text-center text-xs font-semibold text-fairway-400"
      >
        All arcade boards →
      </button>
      </div>
    </>
  );
}

/** The head-to-head outcome for a round played as a challenge. Three states:
 *  waiting on the other side, a result, or a tie. */
function ChallengeCard({ view }: { view: ChallengeView }) {
  const { challenger, opponent, challenge, winnerId, tied, youWon } = view;
  const me = challenger.isYou ? challenger : opponent;
  const them = challenger.isYou ? opponent : challenger;
  const unit = challenge.meta.unit;
  const pending = challenge.status !== 'complete';

  return (
    <div className="mt-4 rounded-2xl border border-fairway-400/40 bg-fairway-400/10 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-fairway-50">Head to head</h3>
        <span className="text-xs text-fairway-400">{challenge.meta.label}</span>
      </div>

      <p className="mt-1 text-sm font-black text-fairway-50">
        {pending
          ? 'Round in — waiting for them to answer.'
          : tied
            ? "🤝 Dead heat — you're both that good."
            : youWon
              ? '🏆 You win!'
              : `${sideLabel(them)} takes it.`}
      </p>

      <div className="mt-2 flex items-stretch gap-2">
        <ScoreCell label={sideLabel(me)} score={me?.score ?? null} unit={unit} won={winnerId != null && me?.userId === winnerId} />
        <div className="self-center text-xs font-bold text-fairway-400">vs</div>
        <ScoreCell label={sideLabel(them)} score={them?.score ?? null} unit={unit} won={winnerId != null && them?.userId === winnerId} />
      </div>
    </div>
  );
}

function ScoreCell({
  label,
  score,
  unit,
  won,
}: {
  label: string;
  score: number | null;
  unit: RecordResult['meta']['unit'];
  won: boolean;
}) {
  return (
    <div
      className={`flex-1 rounded-xl px-3 py-2 text-center ${
        won ? 'bg-fairway-400/20' : 'bg-fairway-900/40'
      }`}
    >
      <div className="text-xs text-fairway-400">{label}</div>
      <div className="text-lg font-black tabular-nums text-fairway-50">
        {score === null ? '—' : formatScore(score, unit)}
      </div>
    </div>
  );
}
