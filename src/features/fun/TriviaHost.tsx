import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { QuestionCredit } from '../shared/Credits';
import JoinQr from '../shared/JoinQr';
import { useCurrentLocationId } from '../../lib/location';
import { useSession } from '../../lib/session';
import { useDeadline, formatCountdown } from './useDeadline';
import { Setting, Chip } from './triviaSetupControls';
import { playClick } from '../../lib/sound';
import {
  estimateSeconds,
  finalScript,
  isSpeechEnabled,
  lobbyScript,
  primeSpeech,
  primeSpeechOnce,
  questionScript,
  revealScript,
  setSpeechEnabled,
  speak,
  speechSupported,
  standingsScript,
  stopSpeaking,
  subscribeSpeech,
} from '../../lib/speech';
import {
  createSession,
  fetchCategories,
  fetchSnapshot,
  advance,
  endSession,
  subscribeSession,
  mergeSnapshot,
  type TriviaSnapshot,
} from '../../lib/triviaLiveApi';

// /arcade/trivia/host — the staff-facing controller for a live trivia game.
//
// Designed to be read across a room and driven one-handed with a mic in the
// other: the join code is the biggest thing on the lobby screen, and there is
// exactly ONE primary button whose label says what the next tap will do.
//
// That button is OPTIONAL. The game runs on its own clock — the lobby starts
// once it has waited for stragglers, questions close when their time is up,
// reveals give way to the next question — so a host is a pacing convenience,
// not a dependency. A game whose host walks off still reaches a final board.
//
// The host sees the answer at the reveal, the same moment the room does. It
// used to be visible from the moment the question opened, on the reasoning
// that an MC reads it out; they don't need it then, and that one privilege was
// the only reason a room was worth stealing.
//
// The host token is minted at create and kept in sessionStorage. It paces the
// room and grants nothing else — worth keeping to this device, but no longer
// something a player could learn anything from.
//
// This is also the device that TALKS. Read-aloud belongs here and not on the
// players' phones: one voice on the host's speaker (or plugged into the PA) is
// an MC, and forty phones a half-second out of sync with each other is noise.
// Players can still switch it on individually, but they have to ask for it.

const HOST_KEY = 'ffc.trivia.host';

type StoredHost = { sessionId: string; hostToken: string };

function loadHost(): StoredHost | null {
  try {
    const raw = sessionStorage.getItem(HOST_KEY);
    return raw ? (JSON.parse(raw) as StoredHost) : null;
  } catch {
    return null;
  }
}

function saveHost(value: StoredHost | null) {
  try {
    if (value) sessionStorage.setItem(HOST_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(HOST_KEY);
  } catch {
    // Storage disabled — the game still runs while this tab stays open.
  }
}

/** What the one primary button does next, given where the game is. */
function nextAction(status: string, index: number, total: number): string {
  if (status === 'lobby') return 'Start the game';
  if (status === 'question') return 'Close answers & reveal';
  return index + 1 >= total ? 'Show final scores' : 'Next question';
}

export default function TriviaHost() {
  const locationId = useCurrentLocationId();
  const [host, setHost] = useState<StoredHost | null>(loadHost);
  const [snapshot, setSnapshot] = useState<TriviaSnapshot | null>(null);
  const [categories, setCategories] = useState<{ category: string; n: number }[]>([]);
  const [category, setCategory] = useState<string>('');
  const [questionCount, setQuestionCount] = useState(10);
  const [seconds, setSeconds] = useState(20);
  const [speedBonus, setSpeedBonus] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const signedIn = useSession().user != null;
  const [busy, setBusy] = useState(false);
  // Above every conditional return below, and nullable on purpose. This screen
  // returns early four times — no account, no game yet, snapshot still loading
  // — so a hook called down beside the render it belongs to would appear only
  // once the snapshot lands, changing the hook count between renders and
  // taking the controller down with "rendered more hooks than during the
  // previous render" at exactly the moment the host needs it.
  const startsIn = useDeadline(
    snapshot?.session.status === 'lobby' ? snapshot.session.autoAt : null,
  );
  // Read-aloud is a per-device setting (lib/speech), shared with the player
  // screen and persisted, so a tablet that hosts trivia every Thursday keeps
  // its voice without anyone re-arming it.
  const speechOn = useSyncExternalStore(subscribeSpeech, isSpeechEnabled, () => false);
  const canSpeak = speechSupported();
  // The phase this device has already read out, as "status:index". Every
  // answer that lands re-broadcasts the same phase with a new answered count,
  // and re-reading the question on each one would talk over the room.
  const spokenPhase = useRef<string | null>(null);

  const scriptFor = useCallback((snap: TriviaSnapshot | null): string[] => {
    if (!snap) return [];
    const { session: s, question: q, board: b } = snap;
    if (s.status === 'lobby') return lobbyScript(s.joinCode);
    if (s.status === 'question' && q) return questionScript(q);
    // The standings ride along with the answer because the reveal is the only
    // moment in the game with room for them — a question is about to open.
    if (s.status === 'reveal' && q) return [...revealScript(q), ...standingsScript(b)];
    if (s.status === 'final') return finalScript(b);
    return [];
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const phase = `${snapshot.session.status}:${snapshot.session.currentIndex}`;
    if (spokenPhase.current === phase) return;
    // Marked whether or not it actually speaks: switching the voice on
    // mid-question should not make it start reading a question the room has
    // been staring at for fifteen seconds. "Read it again" covers that case.
    spokenPhase.current = phase;
    if (!speechOn) return;
    speak(scriptFor(snapshot));
  }, [snapshot, speechOn, scriptFor]);

  // Walking off this screen must not leave a voice finishing a sentence into
  // an empty room.
  useEffect(() => stopSpeaking, []);

  const toggleSpeech = useCallback((next: boolean) => {
    // Priming has to happen inside the tap: iOS only starts speaking if the
    // first utterance came from a user gesture.
    if (next) primeSpeech();
    setSpeechEnabled(next);
  }, []);

  useEffect(() => {
    if (!locationId) return;
    void fetchCategories(locationId).then((r) => {
      if (r.ok) setCategories(r.categories);
    });
  }, [locationId]);

  useEffect(() => {
    if (!host) return;
    let live = true;
    void fetchSnapshot(host.sessionId, { host: host.hostToken }).then((r) => {
      if (!live) return;
      // Merged, not assigned: the lobby is where a host screen opens and also
      // where players are arriving, so the stream can land a joiner while this
      // request is still out. Assigning would drop them, and nothing
      // re-broadcasts until the next join — leaving the host reading a roster
      // that is quietly one table short.
      if (r.ok) setSnapshot((prev) => mergeSnapshot(prev, r as unknown as TriviaSnapshot));
      else if (r.status === 404) {
        saveHost(null);
        setHost(null);
      }
    });
    const stop = subscribeSession(host.sessionId, { host: host.hostToken }, (s) => {
      // A late answer-broadcast must not drag the host's screen back out of
      // the reveal it just advanced to (see mergeSnapshot).
      if (live) setSnapshot((prev) => mergeSnapshot(prev, s));
    });
    return () => {
      live = false;
      stop();
    };
  }, [host]);

  const start = useCallback(async () => {
    if (!locationId) return;
    // The tap that opens the room is also this page's chance to unlock the
    // voice. The switch above is persisted, so a host who turned it on weeks
    // ago never touches it — and priming only from the switch left the lobby
    // and the whole first question silent (see primeSpeechOnce).
    primeSpeechOnce();
    setError(null);
    setBusy(true);
    const res = await createSession({
      locationId,
      questionCount,
      category: category || null,
      config: { questionSeconds: seconds, speedBonus, teams: true },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // A short category deals what it has rather than refusing to start, so
    // say so here — otherwise the only clue is the counter reading "of 12"
    // when the host set up 20.
    setNotice(
      res.dealt < res.requested
        ? `Only ${res.dealt} questions available${category ? ` in ${category}` : ''} — dealing ${res.dealt}.`
        : null,
    );
    const next = { sessionId: res.session.id, hostToken: res.hostToken };
    saveHost(next);
    setHost(next);
  }, [locationId, questionCount, category, seconds, speedBonus]);

  const step = useCallback(async () => {
    if (!host) return;
    playClick();
    // Also here, for the host who reloaded mid-game: their session was
    // restored without a tap, so this is the first gesture the page has had.
    primeSpeechOnce();
    setBusy(true);
    const res = await advance(host.sessionId, host.hostToken);
    setBusy(false);
    if (!res.ok) setError(res.error);
    // Merged for the same reason as the initial fetch — the advance response
    // is the newest state of the GAME, but a join broadcast can still overtake
    // it on the wire.
    else setSnapshot((prev) => mergeSnapshot(prev, res as unknown as TriviaSnapshot));
  }, [host]);

  async function finish() {
    if (!host) return;
    const res = await endSession(host.sessionId, host.hostToken);
    // The host token is the ONLY capability that can drive this room, and it
    // exists on this device alone. Clearing it because the request failed —
    // venue wifi dropping mid-tap is the normal case, not the exotic one —
    // leaves a live session nobody can advance or end, with the room stuck
    // until lazy expiry. So it goes only on a definitive answer: success, or a
    // 404 meaning the session is already gone.
    if (!res.ok && res.status !== 404) {
      setError(
        res.error === 'offline'
          ? "Couldn't reach the game to close it — check your signal and try again."
          : res.error,
      );
      return;
    }
    stopSpeaking();
    spokenPhase.current = null;
    saveHost(null);
    setHost(null);
    setSnapshot(null);
  }

  if (!signedIn) {
    return (
      <Screen>
        <TopBar title="Host Trivia" back="/arcade" />
        <Content>
          <p className="text-sm text-fairway-100/80">
            Setting up a game needs an account — that's just so the room has an
            owner. Anyone can run one.
          </p>
          <QuestionCredit />
        </Content>
      </Screen>
    );
  }

  // --- Setup ----------------------------------------------------------------
  if (!host) {
    const bankTotal = categories.reduce((n, c) => n + c.n, 0);
    return (
      <Screen>
        <TopBar title="Host Trivia" back="/arcade" />
        <Content>
          <p className="mb-4 text-sm text-fairway-100/70">
            Set up a game, then read the code out to the room. Everyone plays from their own
            phone — solo or as a table.
          </p>

          {error && (
            <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          <Setting label="Questions">
            <div className="flex gap-1.5">
              {[5, 10, 15, 20].map((n) => (
                <Chip key={n} on={questionCount === n} onClick={() => setQuestionCount(n)}>
                  {n}
                </Chip>
              ))}
            </div>
          </Setting>

          <Setting label="Seconds per question">
            <div className="flex gap-1.5">
              {[10, 20, 30, 45].map((n) => (
                <Chip key={n} on={seconds === n} onClick={() => setSeconds(n)}>
                  {n}s
                </Chip>
              ))}
            </div>
          </Setting>

          <Setting label="Category">
            <div className="flex flex-wrap gap-1.5">
              <Chip on={category === ''} onClick={() => setCategory('')}>
                All ({bankTotal})
              </Chip>
              {categories.map((c) => (
                <Chip key={c.category} on={category === c.category} onClick={() => setCategory(c.category)}>
                  {c.category} ({c.n})
                </Chip>
              ))}
            </div>
          </Setting>

          <label
            className={`${canSpeak ? 'mb-2' : 'mb-5'} flex items-center gap-2 text-sm text-fairway-100/80`}
          >
            <input
              type="checkbox"
              checked={speedBonus}
              onChange={(e) => setSpeedBonus(e.target.checked)}
            />
            Speed bonus (faster correct answers score more)
          </label>

          {canSpeak && (
            <>
              <label className="mb-1 flex items-center gap-2 text-sm text-fairway-100/80">
                <input
                  type="checkbox"
                  checked={speechOn}
                  onChange={(e) => toggleSpeech(e.target.checked)}
                />
                Read the game aloud (this device is the voice)
              </label>
              <p className="mb-5 text-xs text-fairway-400">
                {speechOn
                  ? readAloudHint(seconds)
                  : 'Turn this on and the phone reads each question, its choices and the answer — hand it a speaker and it hosts itself.'}
              </p>
            </>
          )}
          <Button onClick={start} disabled={busy || !locationId}>
            {busy ? 'Setting up…' : 'Create the game'}
          </Button>
          <QuestionCredit />
        </Content>
      </Screen>
    );
  }

  if (!snapshot) {
    return (
      <Screen>
        <TopBar title="Host Trivia" back="/arcade" />
        <Content>
          <p className="text-sm text-fairway-100/70">Loading the game…</p>
          <QuestionCredit />
        </Content>
      </Screen>
    );
  }

  const { session, question, board, answeredCount, entrantCount } = snapshot;
  const done = session.status === 'final';
  // Prefilled join link: TriviaLive reads `?code=` straight into its code
  // field, so a scan lands on the join form with only a name left to type.
  const joinUrl = `${window.location.origin}/arcade/trivia/live?code=${session.joinCode}`;

  return (
    <Screen>
      <TopBar title="Host Trivia" back="/arcade" />
      <Content>
        {/* The join code is the single most-read thing in the room, so it gets
            the whole top of the screen until the game starts. */}
        {session.status === 'lobby' && (
          <div className="mb-5 rounded-3xl border border-fairway-700 bg-fairway-900/50 px-4 py-6 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-fairway-400">Join at the arcade</p>
            <p className="my-2 text-5xl font-black tracking-[0.2em] text-fairway-50">
              {session.joinCode}
            </p>
            {/* Typing six characters heard across a loud room is the step that
                actually loses players: the alphabet already drops the letters
                people misread (I, L, O, U) and the server maps the rest onto
                what they saw, but B/8, S/5 and Z/2 are all legal on both
                sides, so a mis-keyed one is a valid code for no game — "no
                live game with that code", which reads like the game is
                broken. Scanning skips the transcription entirely. The code
                stays the headline: it is what the host reads out, and it's
                the fallback for a phone whose camera won't play along.
                Same pattern as the mini-golf lobby (features/shared/Lobby). */}
            <div className="mt-4 flex justify-center">
              <JoinQr url={joinUrl} />
            </div>
            <p className="mt-3 text-xs text-fairway-100/70">
              Scan to join, or open{' '}
              <span className="font-semibold">{window.location.host}/arcade/trivia/live</span> and
              type the code.
            </p>
            <p className="mt-3 text-sm text-fairway-100/70">
              {entrantCount} {entrantCount === 1 ? 'player' : 'players'} in
            </p>
            {/* The lobby's clock starts when the first player joins, so this
                is blank until somebody is actually waiting. */}
            {startsIn != null && (
              <p className="mt-1 text-sm font-bold text-fairway-300">
                Starts on its own in {formatCountdown(startsIn)}
              </p>
            )}
          </div>
        )}

        {session.status !== 'lobby' && !done && (
          <div className="mb-2 flex items-center justify-between text-xs text-fairway-400">
            <span>
              Question {session.currentIndex + 1} of {session.total}
            </span>
            <span>
              {answeredCount}/{entrantCount} answered · code {session.joinCode}
            </span>
          </div>
        )}

        {question && (
          <div className="mb-4 rounded-2xl border border-fairway-800/60 bg-fairway-900/40 px-4 py-3">
            <p className="text-xs text-fairway-400">{question.category}</p>
            <h2 className="mt-1 text-lg font-bold leading-snug text-fairway-50">
              {question.prompt}
            </h2>
            <ul className="mt-3 flex flex-col gap-1">
              {question.choices.map((choice, i) => (
                <li
                  key={i}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${
                    question.answer === i
                      ? 'bg-fairway-400/20 font-bold text-fairway-50'
                      : 'text-fairway-100/70'
                  }`}
                >
                  <span className="w-4 text-fairway-400">{'ABCDEF'[i]}</span>
                  <span className="flex-1">{choice}</span>
                  {question.answer === i && <span aria-label="correct answer">✅</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {done && (
          <div className="mb-4 text-center">
            <div className="text-5xl">🏆</div>
            <h2 className="mt-2 text-xl font-black text-fairway-50">
              {board[0]?.name ?? 'Nobody'} wins
            </h2>
          </div>
        )}

        {board.length > 0 && (
          <ol className="mb-5 flex flex-col gap-0.5">
            {board.slice(0, 12).map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-lg px-2 py-1 text-sm text-fairway-100/80"
              >
                <span className="w-5 text-right tabular-nums text-fairway-400">{e.rank}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.name}
                  {e.isTeam && <span className="ml-1 text-xs text-fairway-400">· table</span>}
                </span>
                <span className="tabular-nums font-semibold text-fairway-50">
                  {e.score.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        )}

        {notice && (
          <p className="mb-3 rounded-xl border border-fairway-700 bg-fairway-900/50 px-3 py-2 text-sm text-fairway-100/80">
            {notice}
          </p>
        )}

        {error && (
          <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {canSpeak && (
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => {
                playClick();
                toggleSpeech(!speechOn);
              }}
              aria-pressed={speechOn}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                speechOn
                  ? 'bg-fairway-400 text-fairway-950'
                  : 'border border-fairway-800 text-fairway-100/70'
              }`}
            >
              {speechOn ? '🔊 Reading aloud' : '🔇 Voice off'}
            </button>
            {/* The one control a room actually asks for out loud. Deliberately
                available at every phase: "what was the answer?" is as common a
                shout as "read that again". */}
            {speechOn && (
              <button
                onClick={() => speak(scriptFor(snapshot))}
                className="rounded-full border border-fairway-800 px-3 py-1.5 text-xs font-semibold text-fairway-100/70"
              >
                Read it again
              </button>
            )}
          </div>
        )}

        {!done ? (
          <Button onClick={step} disabled={busy}>
            {nextAction(session.status, session.currentIndex, session.total)}
          </Button>
        ) : (
          <Button onClick={finish}>Close the game</Button>
        )}

        {!done && (
          // Disabled while an advance is in flight: the server refuses a stale
          // transition anyway, but letting the host tap both at once invites a
          // race they'd have to understand to recover from.
          <button
            onClick={finish}
            disabled={busy}
            className="mt-4 w-full text-center text-xs text-fairway-400 disabled:opacity-40"
          >
            End early
          </button>
        )}
        <QuestionCredit />
      </Content>
    </Screen>
  );
}

// A representative four-choice question, used only to tell a host how much of
// their timer the voice will spend before anyone can start thinking. The
// answer clock starts when the question opens, so this comes out of it.
const SAMPLE_QUESTION = {
  index: 0,
  category: 'General knowledge',
  prompt: 'Which planet in our solar system has the most moons orbiting it?',
  choices: ['Jupiter', 'Saturn', 'Neptune', 'Uranus'],
};

function readAloudHint(seconds: number): string {
  const read = Math.ceil(estimateSeconds(questionScript(SAMPLE_QUESTION)));
  return seconds - read < 10
    ? `Reading a question aloud takes about ${read}s and the clock is already running, so ${seconds}s leaves almost no thinking time — 30s or 45s plays better.`
    : `Reading a question aloud takes about ${read}s of the ${seconds}s on the clock.`;
}
