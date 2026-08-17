import { useCallback, useEffect, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useCurrentLocationId } from '../../lib/location';
import { useSession } from '../../lib/session';
import { playClick } from '../../lib/sound';
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
// other: the join code is the biggest thing on the lobby screen, the answer is
// always visible to the host (they read it out), and there is exactly ONE
// primary button whose label says what the next tap will do.
//
// The host token is minted at create and kept in sessionStorage. It is the
// capability that advances the game, so it lives on this device only — a
// player who got hold of it could drive the room.

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
  const signedIn = useSession().user != null;
  const [host, setHost] = useState<StoredHost | null>(loadHost);
  const [snapshot, setSnapshot] = useState<TriviaSnapshot | null>(null);
  const [categories, setCategories] = useState<{ category: string; n: number }[]>([]);
  const [category, setCategory] = useState<string>('');
  const [questionCount, setQuestionCount] = useState(10);
  const [seconds, setSeconds] = useState(20);
  const [speedBonus, setSpeedBonus] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (r.ok) setSnapshot(r as unknown as TriviaSnapshot);
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
    const next = { sessionId: res.session.id, hostToken: res.hostToken };
    saveHost(next);
    setHost(next);
  }, [locationId, questionCount, category, seconds, speedBonus]);

  const step = useCallback(async () => {
    if (!host) return;
    playClick();
    setBusy(true);
    const res = await advance(host.sessionId, host.hostToken);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setSnapshot(res as unknown as TriviaSnapshot);
  }, [host]);

  async function finish() {
    if (!host) return;
    await endSession(host.sessionId, host.hostToken);
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
            Hosting a game needs a staff account — sign in first.
          </p>
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

          <label className="mb-5 flex items-center gap-2 text-sm text-fairway-100/80">
            <input
              type="checkbox"
              checked={speedBonus}
              onChange={(e) => setSpeedBonus(e.target.checked)}
            />
            Speed bonus (faster correct answers score more)
          </label>

          <Button onClick={start} disabled={busy || !locationId}>
            {busy ? 'Setting up…' : 'Create the game'}
          </Button>
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
        </Content>
      </Screen>
    );
  }

  const { session, question, board, answeredCount, entrantCount } = snapshot;
  const done = session.status === 'final';

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
            <p className="text-sm text-fairway-100/70">
              {entrantCount} {entrantCount === 1 ? 'player' : 'players'} in
            </p>
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

        {error && (
          <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {!done ? (
          <Button onClick={step} disabled={busy}>
            {nextAction(session.status, session.currentIndex, session.total)}
          </Button>
        ) : (
          <Button onClick={finish}>Close the game</Button>
        )}

        {!done && (
          <button onClick={finish} className="mt-4 w-full text-center text-xs text-fairway-400">
            End early
          </button>
        )}
      </Content>
    </Screen>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fairway-400">
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        playClick();
        onClick();
      }}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        on ? 'bg-fairway-400 text-fairway-950' : 'border border-fairway-800 text-fairway-100/70'
      }`}
    >
      {children}
    </button>
  );
}
