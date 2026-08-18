import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { QuestionCredit } from '../shared/Credits';
import QrScanner from '../shared/QrScanner';
import JoinQr from '../shared/JoinQr';
import { joinCodeFromScan } from '../../lib/scanJoinCode';
import { useCurrentLocationId } from '../../lib/location';
import { useDeadline, formatCountdown } from './useDeadline';
import { playClick, playDing, playBuzz, playFanfare } from '../../lib/sound';
import {
  isSpeechEnabled,
  myResultScript,
  primeSpeech,
  questionScript,
  revealScript,
  setSpeechEnabled,
  speak,
  speechSupported,
  stopSpeaking,
  subscribeSpeech,
} from '../../lib/speech';
import {
  joinSession,
  fetchSnapshot,
  submitAnswer,
  subscribeSession,
  mergeSnapshot,
  listOpenSessions,
  advance,
  endSession,
  type TriviaSnapshot,
  type OpenTriviaGame,
} from '../../lib/triviaLiveApi';
import {
  loadPlayer,
  savePlayer,
  loadOwner,
  saveOwner,
  type StoredPlayer,
  type StoredOwner,
} from './triviaLiveStorage';

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
//
// Read-aloud exists here but is OFF unless this phone asked for it: the room's
// voice is the host's device, and a table where three phones read the same
// question a half-second apart can't hear either. It's for the player who
// wants their own phone to read to them — the back of the room, or a screen
// that's hard to see — so it's a quiet per-device switch, not a game setting.

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
  const locationId = useCurrentLocationId();
  // The venue's chalkboard: live games whose creators marked them open. Only
  // polled while this phone is on the join form — a seated player has a game.
  const [openGames, setOpenGames] = useState<OpenTriviaGame[]>([]);
  // TriviaStart hands its freshly minted capabilities through router state as
  // well as sessionStorage: with storage disabled (private mode), the writes
  // silently do nothing, and arriving here without the tokens would orphan a
  // game that was created a moment ago. Storage wins when it worked — the
  // start screen just overwrote it, so the two agree anyway.
  const routeState = useLocation().state as
    | { player?: StoredPlayer; owner?: StoredOwner }
    | null;
  const [stored, setStored] = useState<StoredPlayer | null>(
    () => loadPlayer() ?? routeState?.player ?? null,
  );
  // The owner capability, present only on the device that started the game
  // from /arcade/trivia/start. Pacing only — "start now", "end the game" —
  // never information; the owner answers questions like anyone else.
  const [owner, setOwner] = useState<StoredOwner | null>(
    () => loadOwner() ?? routeState?.owner ?? null,
  );
  const [snapshot, setSnapshot] = useState<TriviaSnapshot | null>(null);
  const [joinCode, setJoinCode] = useState(params.get('code') ?? '');
  const [name, setName] = useState('');
  const [isTeam, setIsTeam] = useState(false);
  // The camera is opt-in: it's a permission prompt and a hot phone, so it
  // stays shut until someone actually asks to scan.
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // In-flight guard for the owner's "start now" — see startNow below.
  const [startBusy, setStartBusy] = useState(false);
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
  // Read-aloud on THIS phone, persisted per device (lib/speech).
  const speechOn = useSyncExternalStore(subscribeSpeech, isSpeechEnabled, () => false);
  const canSpeak = speechSupported();
  // Same "status:index" guard the host uses: every answer in the room
  // re-broadcasts the current phase, and a phone that re-read the question on
  // each one would never finish a sentence.
  const spokenPhase = useRef<string | null>(null);
  const spokenResult = useRef<number | null>(null);

  const sessionId = stored?.sessionId ?? routeSession ?? null;

  useEffect(() => {
    if (stored || !locationId) return;
    let live = true;
    const load = () =>
      void listOpenSessions(locationId).then((r) => {
        if (live && r.ok) setOpenGames(r.sessions);
      });
    load();
    // Gentle poll: the board changes on the pace people start games, not the
    // pace they answer questions.
    const timer = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [stored, locationId]);

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
        savePlayer(null);
        setStored(null);
        // A dead game's owner capability points at nothing — drop it with
        // the seat.
        setOwner((prev) => {
          if (prev?.sessionId !== sessionId) return prev;
          saveOwner(null);
          return null;
        });
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

  // The question and the answer, read on this phone. The player payload holds
  // no `answer` until the question closes, so the reveal read can only ever
  // say something the server has already released (revealScript checks).
  useEffect(() => {
    if (!snapshot) return;
    const { session, question } = snapshot;
    const phase = `${session.status}:${session.currentIndex}`;
    if (spokenPhase.current === phase) return;
    spokenPhase.current = phase;
    if (!speechOn || !question) return;
    if (session.status === 'question') speak(questionScript(question));
    else if (session.status === 'reveal') speak(revealScript(question));
  }, [snapshot, speechOn]);

  // "Correct, plus 130" waits for the personalized result the same way the
  // fanfare does — at the instant of the reveal this phone genuinely doesn't
  // know yet. Queued rather than interrupting, so it lands after the answer.
  useEffect(() => {
    const index = snapshot?.session.currentIndex ?? null;
    const mine = snapshot?.myAnswer;
    if (snapshot?.session.status !== 'reveal' || index === null) return;
    if (mine?.correct === undefined) return;
    if (spokenResult.current === index) return;
    spokenResult.current = index;
    if (speechOn) speak(myResultScript(mine), { interrupt: false });
  }, [snapshot?.session.status, snapshot?.session.currentIndex, snapshot?.myAnswer, speechOn]);

  // Leaving the game shouldn't leave a voice talking to a pocket.
  useEffect(() => stopSpeaking, []);

  const toggleSpeech = useCallback((next: boolean) => {
    // iOS only unlocks speech from inside a gesture — this tap is it.
    if (next) primeSpeech();
    setSpeechEnabled(next);
  }, []);

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
    const next: StoredPlayer = {
      sessionId: res.snapshot.session.id,
      participantToken: res.participantToken,
      entrantId: res.entrant.id,
      name: res.entrant.name,
    };
    savePlayer(next);
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
    stopSpeaking();
    savePlayer(null);
    setStored(null);
    // Walking away from a game you started doesn't end it for the others —
    // but the capability to end it leaves with this seat, so drop it too.
    if (owner?.sessionId === sessionId) {
      saveOwner(null);
      setOwner(null);
    }
    setSnapshot(null);
    navigate('/arcade');
  }

  // The owner's two pacing moves, both shortcuts the clock would make anyway.
  const iOwnThis = owner != null && owner.sessionId === sessionId;
  const startNow = useCallback(async () => {
    if (!owner || !sessionId || startBusy) return;
    playClick();
    // Held busy through success, not just the round trip: /advance moves
    // whatever phase it finds, so a second tap landing after the first
    // response but before the SSE frame would push question 1 straight to its
    // reveal. The transition unmounts this button; only a failed tap, which
    // moved nothing, hands it back.
    setStartBusy(true);
    const res = await advance(sessionId, owner.hostToken);
    if (!res.ok) setStartBusy(false);
    // No local state to set on success: the transition comes back over SSE
    // for everyone, this phone included.
  }, [owner, sessionId, startBusy]);

  const endForEveryone = useCallback(async () => {
    if (!owner || !sessionId) return;
    const res = await endSession(sessionId, owner.hostToken);
    if (!res.ok && res.status !== 404) {
      setError(
        res.error === 'offline'
          ? "Couldn't reach the game to end it — check your signal and try again."
          : res.error,
      );
    }
    // The final board arrives over SSE; this seat stays to see it.
  }, [owner, sessionId]);

  // --- Join form ------------------------------------------------------------
  if (!stored) {
    return (
      <Screen>
        <TopBar title="Live Trivia" back="/arcade" />
        <Content>
          <p className="mb-4 text-center text-sm text-fairway-100/70">
            Join with a code — or start a game of your own.
          </p>
          {error && (
            <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          {/* The venue's chalkboard: games whose creators opened them to the
              whole room. Tapping one just fills the code in — the join stays
              one path, and the player still picks their name below. */}
          {openGames.length > 0 && (
            <div className="mb-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fairway-400">
                Open games here now
              </p>
              <div className="flex flex-col gap-1.5">
                {openGames.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      playClick();
                      setError(null);
                      setJoinCode(g.joinCode);
                    }}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${
                      joinCode === g.joinCode
                        ? 'border-fairway-400/70 bg-fairway-400/10'
                        : 'border-fairway-800/60 bg-fairway-900/40'
                    }`}
                  >
                    <span className="text-xl">🎲</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fairway-50">
                        {g.status === 'lobby'
                          ? 'Starting soon'
                          : `On question ${g.currentIndex + 1} of ${g.totalQuestions}`}
                      </span>
                      <span className="block text-xs text-fairway-400">
                        {g.entrantCount} {g.entrantCount === 1 ? 'player' : 'players'} · code{' '}
                        {g.joinCode}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-fairway-300">
                      {joinCode === g.joinCode ? 'Selected' : 'Join →'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Scanning first, typing second. Six characters heard across a
              loud room is where players are actually lost: the codes B/8,
              S/5 and Z/2 are all legal, so a mis-keyed one is a valid code
              for no game and the room is told "no live game with that code".
              The field stays right below for anyone whose camera won't play
              along, and the QR to scan is on the host's lobby screen. */}
          {scanning ? (
            <QrScanner
              accept={(text) => joinCodeFromScan(text) !== null}
              onResult={(text) => {
                const code = joinCodeFromScan(text);
                if (code) setJoinCode(code);
                setScanning(false);
              }}
              onCancel={() => setScanning(false)}
            />
          ) : (
            <button
              onClick={() => {
                playClick();
                setError(null);
                setScanning(true);
              }}
              className="mb-4 w-full rounded-xl border border-fairway-700 bg-fairway-900/60 px-4 py-3 text-sm font-semibold text-fairway-100/90 active:bg-fairway-800"
            >
              📷 Scan the code
            </button>
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
          {canSpeak && (
            <label className="mb-4 flex items-center gap-2 text-sm text-fairway-100/80">
              <input
                type="checkbox"
                checked={speechOn}
                onChange={(e) => toggleSpeech(e.target.checked)}
              />
              Read the questions aloud on this phone
            </label>
          )}
          <Button onClick={doJoin} disabled={busy || joinCode.length < 4 || name.trim() === ''}>
            {busy ? 'Joining…' : 'Join the game'}
          </Button>
          {/* No game to join? Any player can make one — private for their
              table, or open to the whole room. No host involved: the game
              runs itself. */}
          <button
            onClick={() => {
              playClick();
              navigate('/arcade/trivia/start');
            }}
            className="mt-5 w-full rounded-xl border border-fairway-700 bg-fairway-900/60 px-4 py-3 text-sm font-semibold text-fairway-100/90 active:bg-fairway-800"
          >
            🎉 Start your own game
          </button>
          {/* Staff entry point. Deliberately understated and at the bottom:
              players outnumber hosts by the size of the room, and a guest who
              taps it lands on a screen that just tells them to sign in. */}
          <button
            onClick={() => navigate('/arcade/trivia/host')}
            className="mt-4 w-full text-center text-xs text-fairway-400"
          >
            Hosting with a mic? Use the host screen →
          </button>
          <QuestionCredit />
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
          <QuestionCredit />
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
          onStartNow={iOwnThis && session.status === 'lobby' ? startNow : null}
          startNowBusy={startBusy}
        />
        {error && (
          <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        {canSpeak && (
          <button
            onClick={() => {
              playClick();
              toggleSpeech(!speechOn);
            }}
            aria-pressed={speechOn}
            className="mt-5 w-full text-center text-xs text-fairway-400"
          >
            {speechOn ? '🔊 Reading aloud on this phone — turn off' : '🔇 Read the questions aloud'}
          </button>
        )}
        <button onClick={leave} className="mt-3 w-full text-center text-xs text-fairway-400">
          Leave the game
        </button>
        {iOwnThis && session.status !== 'final' && session.status !== 'abandoned' && (
          // You started it, you can call it — the one owner move that isn't
          // just the clock arriving early. Explicit about its blast radius.
          <button
            onClick={endForEveryone}
            className="mt-3 w-full text-center text-xs text-fairway-400"
          >
            End the game for everyone
          </button>
        )}
        <QuestionCredit />
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
  onStartNow,
  startNowBusy,
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
  /** Present only on the phone that started this game, and only in the lobby:
   *  the owner's shortcut past the lobby clock once everyone's in. */
  onStartNow?: (() => void) | null;
  /** True from the start-now tap until it definitively failed — the game
   *  moving on is what removes the button, so success never re-enables it. */
  startNowBusy?: boolean;
}) {
  const left = useCountdown(
    session.askedAt,
    session.config.questionSeconds,
    session.status === 'question',
  );
  // The room starts itself, so the lobby counts down rather than waiting on a
  // host who may not exist — "waiting for the host" was a lie the moment the
  // game learned to run unattended.
  const startsIn = useDeadline(session.status === 'lobby' ? session.autoAt : null);

  if (session.status === 'lobby') {
    // TriviaLive reads `?code=` straight into its code field, so this link
    // lands a friend on the join form with only a name left to type — the
    // same prefill the host screen's QR uses.
    const joinUrl = `${window.location.origin}/arcade/trivia/live?code=${session.joinCode}`;
    return (
      <div className="text-center">
        <div className="text-5xl">🎤</div>
        <h2 className="mt-3 text-xl font-black text-fairway-50">You're in!</h2>
        <p className="mt-1 text-sm text-fairway-100/70">
          {startsIn != null
            ? `Starting in ${formatCountdown(startsIn)}`
            : 'Waiting for more players'}{' '}
          · {entrantCount} {entrantCount === 1 ? 'player' : 'players'} so far
        </p>
        {/* Every seat can recruit: in a game among friends there is no host
            screen for the code to live on, so the lobby itself is the invite.
            Nothing secret is shown — everyone here typed this code to get
            in. */}
        <div className="mx-auto mt-4 max-w-xs rounded-2xl border border-fairway-800/60 bg-fairway-900/40 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.2em] text-fairway-400">
            {session.config.open ? 'Open game — anyone can join' : 'Invite your friends'}
          </p>
          <p className="my-1.5 text-3xl font-black tracking-[0.2em] text-fairway-50">
            {session.joinCode}
          </p>
          <div className="mt-2 flex justify-center">
            <JoinQr url={joinUrl} />
          </div>
          <p className="mt-2 text-xs text-fairway-100/70">
            Scan to join, or type the code at{' '}
            <span className="font-semibold">{window.location.host}/arcade/trivia/live</span>
          </p>
        </div>
        {onStartNow && (
          <div className="mt-4">
            <Button onClick={onStartNow} disabled={startNowBusy}>
              {startNowBusy ? 'Starting…' : "Everyone's in — start now"}
            </Button>
          </div>
        )}
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
