import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { playClick, playDing, playBuzz, playFanfare } from '../../lib/sound';
import {
  joinSession,
  fetchSnapshot,
  submitAnswer,
  subscribeSession,
  mergeSnapshot,
  type TriviaSnapshot,
} from '../../lib/triviaLiveApi';

// /arcade/trivia/live — the player's seat at a live trivia game.
//
// Everything the room does at once (a question opening, the reveal landing,
// the board reshuffling) arrives over SSE, so forty phones change together
// rather than each on its own poll. The screen is a pure function of the
// snapshot the server sends: there is no local guess at what state the game is
// in, because the host owns that and a phone that guessed would flicker.
//
// The participant token is kept in sessionStorage, not localStorage: it's a
// capability for THIS game on THIS device, and a stale one from last Tuesday
// resolving to a dead session is worse than asking for the code again. Session
// storage also means a passed-around phone doesn't carry a table's identity
// into someone else's tab.

const TOKEN_KEY = 'ffc.trivia.live';

type Stored = { sessionId: string; participantToken: string; entrantId: string; name: string };

function loadStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function saveStored(value: Stored | null) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode with storage disabled — the game still plays for as long as
    // this component stays mounted, which is the whole session in practice.
  }
}

/** Countdown for the open question, from the server's asked_at. Local clock
 *  drift only affects the bar's smoothness, never the score — the server
 *  measures elapsed time itself. */
function useCountdown(askedAt: string | null, seconds: number, active: boolean): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!active || !askedAt) {
      setLeft(seconds);
      return;
    }
    const started = new Date(askedAt).getTime();
    const tick = () => {
      const elapsed = (Date.now() - started) / 1000;
      setLeft(Math.max(0, seconds - elapsed));
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [askedAt, seconds, active]);
  return left;
}

const CHOICE_STYLES = [
  { bg: '#ef4444', label: 'A' },
  { bg: '#3b82f6', label: 'B' },
  { bg: '#eab308', label: 'C' },
  { bg: '#16a34a', label: 'D' },
  { bg: '#a855f7', label: 'E' },
  { bg: '#f97316', label: 'F' },
];

export default function TriviaLive() {
  const navigate = useNavigate();
  const { sessionId: routeSession } = useParams();
  const [params] = useSearchParams();
  const [stored, setStored] = useState<Stored | null>(loadStored);
  const [snapshot, setSnapshot] = useState<TriviaSnapshot | null>(null);
  const [joinCode, setJoinCode] = useState(params.get('code') ?? '');
  const [name, setName] = useState('');
  const [isTeam, setIsTeam] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Optimistic lock so the tapped button reads as chosen before the round trip
  // lands — at a table, the wait between tap and confirmation is where people
  // tap a second choice.
  const [pending, setPending] = useState<number | null>(null);
  // Question index whose personalized reveal result has landed. Until it
  // matches, the reveal cannot yet say whether THIS phone was right.
  const [personalizedIndex, setPersonalizedIndex] = useState<number | null>(null);
  const lastStatus = useRef<string | null>(null);
  // Which question index has already played its reveal sound.
  const soundedIndex = useRef<number | null>(null);

  const sessionId = stored?.sessionId ?? routeSession ?? null;

  // Live stream + an initial snapshot, so a phone that joins mid-question
  // isn't blank until the host advances.
  useEffect(() => {
    if (!sessionId || !stored?.participantToken) return;
    let live = true;
    void fetchSnapshot(sessionId, { participant: stored.participantToken }).then((r) => {
      if (!live) return;
      // Freshness applies to this one-time GET as much as to the stream: if the
      // host advances while it's in flight, a newer SSE frame can render first
      // and this slower response would otherwise restore the old question.
      if (r.ok) {
        const next = r as unknown as TriviaSnapshot;
        setSnapshot((prev) => mergeSnapshot(prev, next));
      }
      // A token for a game that has ended or been cleaned up: drop it rather
      // than leaving the player staring at a spinner forever.
      else if (r.status === 404) {
        saveStored(null);
        setStored(null);
      }
    });
    const stop = subscribeSession(sessionId, { participant: stored.participantToken }, (s) => {
      // Drop stale frames, and never let a viewer-neutral one wipe this
      // phone's own reveal result (see mergeSnapshot).
      if (live) setSnapshot((prev) => mergeSnapshot(prev, s));
    });
    return () => {
      live = false;
      stop();
    };
  }, [sessionId, stored?.participantToken]);

  // A new question opening is a status transition, so it can be keyed on one.
  useEffect(() => {
    const status = snapshot?.session.status ?? null;
    if (status !== lastStatus.current && lastStatus.current !== null && status === 'question') {
      playDing();
    }
    lastStatus.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.session.status]);

  // The reveal verdict is NOT a status transition: at the instant the status
  // flips, this phone still holds the viewer-neutral broadcast and doesn't yet
  // know whether it was right. Firing the fanfare there played it before the
  // answer was known (and, for a player whose result never arrived, played
  // nothing at all). So the sound waits for the personalized result and fires
  // once per question, tracked by index.
  useEffect(() => {
    const index = snapshot?.session.currentIndex ?? null;
    const mine = snapshot?.myAnswer;
    if (snapshot?.session.status !== 'reveal' || index === null) return;
    if (mine?.correct === undefined) return;
    if (soundedIndex.current === index) return;
    soundedIndex.current = index;
    if (mine.correct) playFanfare();
    else playBuzz();
  }, [snapshot?.session.status, snapshot?.session.currentIndex, snapshot?.myAnswer]);

  // Clear the optimistic lock on every new QUESTION — and only that.
  //
  // The underlying constraint: broadcast frames are viewer-neutral (built
  // without an entrantId), so `myAnswer` is always null on the stream. Two
  // things follow, and getting either wrong breaks the round:
  //
  //   Keying the clear on `myAnswer` never fires, so `pending` sticks and
  //   every button stays disabled for the rest of the game.
  //   Keying it on `status` fires at the reveal, wiping the only record this
  //   phone has of what it picked — so a player who answered is told "didn't
  //   answer in time" and loses their highlight.
  //
  // The question INDEX is the only thing that actually means "this is a fresh
  // question", so that alone drives the reset. Correctness at the reveal comes
  // from the personalized refetch below, not from the stream.
  useEffect(() => {
    setPending(null);
  }, [snapshot?.session.currentIndex]);

  // At the reveal, pull this phone's OWN result. The stream can't carry it
  // (one frame serves the whole room), but the snapshot endpoint is
  // participant-scoped and already returns choice, correctness, and points —
  // so one small request per question turns "somebody got it right" into
  // "you got it right".
  //
  // Unconditional at the reveal, deliberately. Gating it on local state
  // ("did I see a pending choice?") looks like a cheap optimization and
  // silently breaks the two cases where the phone has no local record but an
  // answer exists on the server: a player who reloaded after answering, and
  // the other devices at a table whose teammate answered for them. Both would
  // be told "didn't answer in time". The request is small; being right about
  // whose answer it was matters more than skipping it.
  useEffect(() => {
    if (!sessionId || !stored?.participantToken) return;
    if (snapshot?.session.status !== 'reveal') return;
    if (snapshot?.myAnswer?.correct !== undefined) return; // already personalized
    let live = true;
    const index = snapshot.session.currentIndex;
    void fetchSnapshot(sessionId, { participant: stored.participantToken }).then((r) => {
      if (!live || !r.ok) return;
      const next = r as unknown as TriviaSnapshot;
      // Same merge as every other path: if the host moved on while this was in
      // flight, restoring the old reveal would leave this phone a question
      // behind until somebody else answered. And personalization only counts
      // as done if the state we actually kept is still that question.
      setSnapshot((prev) => mergeSnapshot(prev, next));
      // Marked outside the updater — an updater must stay pure, and React may
      // call it twice. Guarded on the response still being ABOUT the question
      // we asked for: if the host moved on, `resultKnown` compares against the
      // new index and won't match anyway, so this can't mislabel anything.
      if (next.session.currentIndex === index) setPersonalizedIndex(index);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, stored?.participantToken, snapshot?.session.status, snapshot?.session.currentIndex]);

  const doJoin = useCallback(async () => {
    setError(null);
    setBusy(true);
    const res = await joinSession({ joinCode, name, isTeam });
    setBusy(false);
    if (!res.ok) {
      setError(res.error === 'offline' ? "Can't reach the game — check your signal." : res.error);
      return;
    }
    const next: Stored = {
      sessionId: res.snapshot.session.id,
      participantToken: res.participantToken,
      entrantId: res.entrant.id,
      name: res.entrant.name,
    };
    saveStored(next);
    setStored(next);
    setSnapshot(res.snapshot);
  }, [joinCode, name, isTeam]);

  const answer = useCallback(
    async (choice: number) => {
      if (!sessionId || !stored) return;
      playClick();
      setPending(choice);
      const res = await submitAnswer(sessionId, stored.participantToken, choice);
      if (!res.ok) {
        setPending(null);
        // 409 = someone else at the table already answered. That's the rule
        // working, not an error worth alarming anyone about.
        if (res.status !== 409) setError(res.error);
      }
    },
    [sessionId, stored],
  );

  function leave() {
    saveStored(null);
    setStored(null);
    setSnapshot(null);
    navigate('/arcade');
  }

  // --- Join form ------------------------------------------------------------
  if (!stored) {
    return (
      <Screen>
        <TopBar title="Live Trivia" back="/arcade" />
        <Content>
          <p className="mb-4 text-center text-sm text-fairway-100/70">
            Enter the code on the screen to join the game.
          </p>
          {error && (
            <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fairway-400">
            Game code
          </label>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8}
            className="mb-4 w-full rounded-xl border border-fairway-700 bg-fairway-900/60 px-4 py-3 text-center text-2xl font-black tracking-[0.3em] text-fairway-50"
          />
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fairway-400">
            {isTeam ? 'Team name' : 'Your name'}
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isTeam ? 'Table 4' : 'Alex'}
            maxLength={32}
            className="mb-3 w-full rounded-xl border border-fairway-700 bg-fairway-900/60 px-4 py-3 text-fairway-50"
          />
          <label className="mb-4 flex items-center gap-2 text-sm text-fairway-100/80">
            <input type="checkbox" checked={isTeam} onChange={(e) => setIsTeam(e.target.checked)} />
            We're playing as a table
          </label>
          <p className="mb-4 text-xs text-fairway-400">
            Playing as a table? Everyone enters the same team name — one answer counts for the
            table, so decide together before you tap.
          </p>
          <Button onClick={doJoin} disabled={busy || joinCode.length < 4 || name.trim() === ''}>
            {busy ? 'Joining…' : 'Join the game'}
          </Button>
          {/* Staff entry point. Deliberately understated and at the bottom:
              players outnumber hosts by the size of the room, and a guest who
              taps it lands on a screen that just tells them to sign in. */}
          <button
            onClick={() => navigate('/arcade/trivia/host')}
            className="mt-6 w-full text-center text-xs text-fairway-400"
          >
            Running the game? Set one up →
          </button>
        </Content>
      </Screen>
    );
  }

  if (!snapshot) {
    return (
      <Screen>
        <TopBar title="Live Trivia" back="/arcade" />
        <Content>
          <p className="text-center text-sm text-fairway-100/70">Connecting to the game…</p>
        </Content>
      </Screen>
    );
  }

  const { session, question, board, answeredCount, entrantCount, myAnswer } = snapshot;
  const me = board.find((e) => e.id === stored.entrantId);
  const locked = myAnswer?.choice ?? pending;

  return (
    <Screen>
      <TopBar title={stored.name} back="/arcade" />
      <Content>
        <LiveBody
          session={session}
          question={question}
          board={board}
          answeredCount={answeredCount}
          entrantCount={entrantCount}
          myAnswer={myAnswer}
          locked={locked}
          resultKnown={personalizedIndex === session.currentIndex}
          myEntrantId={stored.entrantId}
          myScore={me?.score ?? 0}
          myRank={me?.rank ?? null}
          onAnswer={answer}
        />
        {error && (
          <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <button onClick={leave} className="mt-6 w-full text-center text-xs text-fairway-400">
          Leave the game
        </button>
      </Content>
    </Screen>
  );
}

function LiveBody({
  session,
  question,
  board,
  answeredCount,
  entrantCount,
  myAnswer,
  locked,
  resultKnown,
  myEntrantId,
  myScore,
  myRank,
  onAnswer,
}: {
  session: TriviaSnapshot['session'];
  question: TriviaSnapshot['question'];
  board: TriviaSnapshot['board'];
  answeredCount: number;
  entrantCount: number;
  myAnswer: TriviaSnapshot['myAnswer'];
  locked: number | null;
  /** The personalized reveal result for THIS question has landed. Until it
   *  has, the phone genuinely doesn't know whether it was right. */
  resultKnown: boolean;
  myEntrantId: string;
  myScore: number;
  myRank: number | null;
  onAnswer: (choice: number) => void;
}) {
  const left = useCountdown(
    session.askedAt,
    session.config.questionSeconds,
    session.status === 'question',
  );

  if (session.status === 'lobby') {
    return (
      <div className="text-center">
        <div className="text-5xl">🎤</div>
        <h2 className="mt-3 text-xl font-black text-fairway-50">You're in!</h2>
        <p className="mt-1 text-sm text-fairway-100/70">
          Waiting for the host to start · {entrantCount}{' '}
          {entrantCount === 1 ? 'player' : 'players'} so far
        </p>
        <Board board={board} myEntrantId={myEntrantId} showScores={false} />
      </div>
    );
  }

  if (session.status === 'final') {
    const winner = board[0];
    return (
      <div className="text-center">
        <div className="text-6xl">🏆</div>
        <h2 className="mt-3 text-2xl font-black text-fairway-50">
          {winner?.id === myEntrantId ? 'You won!' : (winner?.name ?? 'Game over')}
        </h2>
        <p className="mt-1 text-sm text-fairway-100/70">
          You finished #{myRank ?? '—'} with {myScore.toLocaleString()} points
        </p>
        <Board board={board} myEntrantId={myEntrantId} showScores />
      </div>
    );
  }

  if (!question) {
    return <p className="text-center text-sm text-fairway-100/70">Waiting for the next question…</p>;
  }

  // Answers close when the countdown does, not when the host gets round to
  // hitting reveal — the server enforces the same deadline, so leaving the
  // buttons live at 0:00 would only produce taps it then refuses.
  const expired = left <= 0;
  const open = session.status === 'question' && !expired;
  const revealed = session.status === 'reveal';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-fairway-400">
        <span>
          Question {question.index + 1} of {question.total} · {question.category}
        </span>
        <span>
          {answeredCount}/{entrantCount} in
        </span>
      </div>

      {session.status === 'question' && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-fairway-800">
          <div
            className="h-full rounded-full bg-fairway-400 transition-[width] duration-100 ease-linear"
            style={{ width: `${(left / session.config.questionSeconds) * 100}%` }}
          />
        </div>
      )}

      <h2 className="mb-4 text-lg font-bold leading-snug text-fairway-50">{question.prompt}</h2>

      <div className="flex flex-col gap-2">
        {question.choices.map((choice, i) => {
          const style = CHOICE_STYLES[i % CHOICE_STYLES.length];
          const isLocked = locked === i;
          const isAnswer = revealed && question.answer === i;
          const isWrongPick = revealed && isLocked && question.answer !== i;
          return (
            <button
              key={i}
              disabled={!open || locked !== null}
              onClick={() => onAnswer(i)}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-transform active:translate-y-px ${
                isAnswer
                  ? 'border-fairway-400 bg-fairway-400/20'
                  : isWrongPick
                    ? 'border-red-500/60 bg-red-500/10'
                    : isLocked
                      ? 'border-fairway-400/70 bg-fairway-400/10'
                      : 'border-fairway-800/60 bg-fairway-900/40'
              } ${!open || (locked !== null && !isLocked) ? 'opacity-60' : ''}`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white"
                style={{ background: style.bg }}
              >
                {style.label}
              </span>
              <span className="flex-1 text-sm font-semibold text-fairway-50">{choice}</span>
              {isAnswer && <span aria-label="correct">✅</span>}
              {isWrongPick && <span aria-label="wrong">❌</span>}
            </button>
          );
        })}
      </div>

      {open && locked !== null && (
        <p className="mt-3 text-center text-sm text-fairway-100/70">
          Locked in — waiting for the room…
        </p>
      )}
      {session.status === 'question' && expired && locked === null && (
        <p className="mt-3 text-center text-sm text-fairway-100/70">
          Time's up — no answer in.
        </p>
      )}
      {revealed && (
        <p className="mt-3 text-center text-sm font-bold text-fairway-50">
          {myAnswer?.correct
            ? `Correct! +${myAnswer.points ?? 0}`
            : myAnswer?.correct === false
              ? 'Not this time.'
              : resultKnown
                ? "Didn't answer in time."
                : 'Checking your answer…'}
        </p>
      )}

      <Board board={board} myEntrantId={myEntrantId} showScores />
    </div>
  );
}

function Board({
  board,
  myEntrantId,
  showScores,
}: {
  board: TriviaSnapshot['board'];
  myEntrantId: string;
  showScores: boolean;
}) {
  if (board.length === 0) return null;
  return (
    <ol className="mt-5 flex flex-col gap-0.5">
      {board.slice(0, 10).map((e) => (
        <li
          key={e.id}
          className={`flex items-center gap-3 rounded-lg px-2 py-1 text-sm ${
            e.id === myEntrantId
              ? 'bg-fairway-400/15 font-bold text-fairway-50'
              : 'text-fairway-100/80'
          }`}
        >
          <span className="w-5 text-right tabular-nums text-fairway-400">{e.rank}</span>
          <span className="min-w-0 flex-1 truncate">
            {e.name}
            {e.isTeam && <span className="ml-1 text-xs text-fairway-400">· table</span>}
          </span>
          {showScores && <span className="tabular-nums">{e.score.toLocaleString()}</span>}
        </li>
      ))}
    </ol>
  );
}
