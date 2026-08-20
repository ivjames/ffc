import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useCurrentLocationId } from '../../lib/location';
import { useSession } from '../../lib/session';
import { playClick } from '../../lib/sound';
import { formatScore, fetchBoards, type BoardEntry } from '../../lib/gameScores';
import { setActiveChallenge } from '../../lib/activeChallenge';
import {
  createChallenge,
  joinChallenge,
  fetchMyChallenges,
  sideLabel,
  type ChallengeView,
} from '../../lib/challengesApi';

// /arcade/challenges — issue a head-to-head, answer one, and see how the
// standing rivalries are going.
//
// Async and sync are the same object here, which is why there is no mode
// switch: you issue a challenge and hand over the code. If your friend is
// standing next to you they take it now and you both play — that's "sync". If
// they take it tomorrow, that's "async". Nothing in the UI has to ask.
//
// Which game a challenge is on comes from the same registry that ranks the
// boards, fetched rather than mirrored, so a challenge can never be issued on
// a board that doesn't exist.

/** Where each game's challenge round is actually played. The registry knows
 *  how a game SCORES; only the app knows where it lives. */
const GAME_ROUTES: Record<string, string> = {
  airhockey: '/arcade/airhockey',
  arcadeputt: '/arcade/putt',
  axethrow: '/arcade/axe',
  battingcages: '/arcade/batting',
  bowling: '/arcade/bowling',
  bumperboats: '/arcade/boats',
  bumpercars: '/arcade/bumper',
  clawmachine: '/arcade/claw',
  darts: '/arcade/darts',
  gokarts: '/arcade/karts',
  highstriker: '/arcade/striker',
  milkbottle: '/arcade/bottles',
  pinball: '/arcade/pinball',
  popashot: '/arcade/hoops',
  ringtoss: '/arcade/rings',
  sheepdrive: '/arcade/sheep',
  shootinggallery: '/arcade/gallery',
  skeeball: '/arcade/skeeball',
  trivia: '/arcade/trivia',
  watergunrace: '/arcade/watergun',
  whackamole: '/arcade/mole',
};

export default function Challenges() {
  const navigate = useNavigate();
  const locationId = useCurrentLocationId();
  const me = useSession().user;
  const [params] = useSearchParams();
  const [mine, setMine] = useState<ChallengeView[]>([]);
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [code, setCode] = useState(params.get('code') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const reload = useCallback(() => {
    void fetchMyChallenges().then((r) => {
      if (r.ok) setMine(r.challenges);
    });
  }, []);

  useEffect(() => {
    if (me) reload();
  }, [me, reload]);

  useEffect(() => {
    if (!locationId) return;
    // limit=1 because this call is only here for the game/variant LIST — the
    // rows are the boards' business, not this screen's.
    void fetchBoards({ locationId, limit: 1 }).then((r) => {
      if (r) setBoards(r.boards);
    });
  }, [locationId]);

  const issue = useCallback(
    async (board: BoardEntry) => {
      if (!locationId) return;
      setError(null);
      setBusy(true);
      const res = await createChallenge({
        locationId,
        game: board.game,
        variant: board.variant || undefined,
      });
      setBusy(false);
      setPicking(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      navigate(`/arcade/challenges/${res.challenge.id}`);
    },
    [locationId, navigate],
  );

  const accept = useCallback(async () => {
    setError(null);
    setBusy(true);
    const res = await joinChallenge(code);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate(`/arcade/challenges/${res.challenge.id}`);
  }, [code, navigate]);

  if (!me) {
    return (
      <Screen>
        <TopBar title="Challenges" back="/arcade" />
        <Content>
          <p className="mb-4 text-sm text-fairway-100/80">
            Challenging a friend needs an account — that's how we know whose score is whose.
          </p>
          <Button onClick={() => navigate('/me/account?next=/arcade/challenges')}>Sign in</Button>
        </Content>
      </Screen>
    );
  }

  const open = mine.filter((c) => c.challenge.status === 'open');
  const settled = mine.filter((c) => c.challenge.status !== 'open');

  return (
    <Screen>
      <TopBar title="Challenges" back="/arcade" />
      <Content>
        {error && (
          <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {picking ? (
          <div className="mb-5">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-bold text-fairway-50">Pick the game</h2>
              <button
                onClick={() => setPicking(false)}
                className="text-xs font-semibold text-fairway-400"
              >
                Cancel
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {boards.map((b) => (
                <button
                  key={`${b.game}:${b.variant}`}
                  disabled={busy}
                  onClick={() => {
                    playClick();
                    void issue(b);
                  }}
                  className="surface-1 rounded-xl border border-fairway-800/60 px-3 py-2.5 text-left"
                >
                  <span className="block text-sm font-bold leading-tight text-fairway-50">
                    {b.label}
                  </span>
                  {b.variantLabel && (
                    <span className="block text-xs text-fairway-300">{b.variantLabel}</span>
                  )}
                  <span className="block text-xs text-fairway-400">
                    {b.direction === 'low' ? 'lowest' : 'highest'} {b.noun} wins
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-5">
            <Button onClick={() => setPicking(true)} disabled={!locationId}>
              ⚔️ Challenge a friend
            </Button>
            <div className="mt-3 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Their code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={8}
                className="min-w-0 flex-1 rounded-xl border border-fairway-700 bg-fairway-900/60 px-3 py-2.5 text-center text-lg font-black tracking-[0.2em] text-fairway-50"
              />
              <button
                onClick={accept}
                disabled={busy || code.length < 4}
                className="shrink-0 rounded-xl border border-fairway-700 px-4 text-sm font-semibold text-fairway-100 disabled:opacity-40"
              >
                Accept
              </button>
            </div>
          </div>
        )}

        <Section title="Open" rows={open} onOpen={(id) => navigate(`/arcade/challenges/${id}`)} />
        <Section title="Settled" rows={settled} onOpen={(id) => navigate(`/arcade/challenges/${id}`)} />

        {mine.length === 0 && (
          <p className="mt-6 text-center text-sm text-fairway-100/60">
            No challenges yet. Pick a game, play your round, and send the code.
          </p>
        )}
      </Content>
    </Screen>
  );
}

function Section({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: ChallengeView[];
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fairway-400">
        {title}
      </h2>
      <div className="flex flex-col gap-2">
        {rows.map((view) => {
          const { challenge, challenger, opponent, youWon, tied, winnerId } = view;
          const me = challenger.isYou ? challenger : opponent;
          const them = challenger.isYou ? opponent : challenger;
          const unit = challenge.meta.unit;
          return (
            <button
              key={challenge.id}
              onClick={() => onOpen(challenge.id)}
              className="surface-1 flex items-center gap-3 rounded-xl border border-fairway-800/60 px-3 py-2.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-tight text-fairway-50">
                  {challenge.meta.label}
                  {challenge.variant && challenge.meta.variants && (
                    <span className="font-normal text-fairway-300">
                      {' · '}
                      {challenge.meta.variants.find((v) => v.key === challenge.variant)?.label}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-fairway-400">
                  vs {sideLabel(them)}
                  {me?.score != null && ` · you ${formatScore(me.score, unit)}`}
                  {them?.score != null && ` · them ${formatScore(them.score, unit)}`}
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold">
                {challenge.status === 'expired'
                  ? '⌛️'
                  : challenge.status === 'open'
                    ? me?.score == null
                      ? '▶️'
                      : '⏳'
                    : tied
                      ? '🤝'
                      : youWon
                        ? '🏆'
                        : winnerId
                          ? '💀'
                          : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Arm the challenge marker and send the player into the game. Exported so the
 *  detail screen uses exactly the same navigation. */
export function startChallengeRound(
  navigate: (to: string) => void,
  challenge: ChallengeView['challenge'],
): boolean {
  const route = GAME_ROUTES[challenge.game];
  if (!route) return false;
  setActiveChallenge({
    challengeId: challenge.id,
    game: challenge.game,
    variant: challenge.variant,
  });
  // The variant rides the route so the game can start the RIGHT one. Without
  // it a Boomerang challenge dropped the player on the track picker; pick any
  // other track and GameHighScore rejects the marker (the boards are per
  // variant, deliberately), so the round is never submitted and the challenge
  // sits waiting on someone who thinks they played it.
  const to = challenge.variant ? `${route}?variant=${encodeURIComponent(challenge.variant)}` : route;
  navigate(to);
  return true;
}
