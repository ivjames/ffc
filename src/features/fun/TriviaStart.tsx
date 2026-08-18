import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { QuestionCredit } from '../shared/Credits';
import { useCurrentLocationId } from '../../lib/location';
import { useSession } from '../../lib/session';
import { Setting, Chip } from './triviaSetupControls';
import {
  createSession,
  fetchCategories,
  joinSession,
} from '../../lib/triviaLiveApi';
import { savePlayer, saveOwner } from './triviaLiveStorage';

// /arcade/trivia/start — a PLAYER starts a game and plays in it.
//
// The host screen (/arcade/trivia/host) is a control panel: whoever creates a
// game there paces the room and never answers a question. This screen is the
// other way to make a game exist — you set it up, you're dealt in as the first
// player, and the game runs itself on the autopilot the room already has
// (server/routes/triviaLive.js). Nobody hosts because nothing needs hosting.
//
// One creator choice matters beyond gameplay: who can find the room.
//
//   FRIENDS (default) — a private room. The join code you share is the only
//   way in; nothing lists it. A game at a table, or split across the venue.
//   EVERYONE — the room goes on the venue's open-games board (the join screen
//   lists it, code included) and anyone in the bar can walk in.
//
// The creator keeps the session's host token as an OWNER capability — start
// the game before the lobby clock runs out, end it early — but it grants no
// information (answers release by phase, to everyone at once), so the owner
// plays on exactly the same footing as everyone they invited.

export default function TriviaStart() {
  const navigate = useNavigate();
  const locationId = useCurrentLocationId();
  const signedIn = useSession().user != null;
  const [name, setName] = useState('');
  const [isTeam, setIsTeam] = useState(false);
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<{ category: string; n: number }[]>([]);
  const [category, setCategory] = useState('');
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

  const start = useCallback(async () => {
    if (!locationId) return;
    setError(null);
    setBusy(true);
    const created = await createSession({
      locationId,
      questionCount,
      category: category || null,
      config: { questionSeconds: seconds, speedBonus, teams: true, open },
    });
    if (!created.ok) {
      setBusy(false);
      setError(created.error === 'offline' ? "Can't reach the server — check your signal." : created.error);
      return;
    }
    // Dealt in through the same door as everyone else: the creator is just the
    // first player to use the code.
    const joined = await joinSession({ joinCode: created.session.joinCode, name, isTeam });
    setBusy(false);
    if (!joined.ok) {
      setError(joined.error);
      return;
    }
    savePlayer({
      sessionId: created.session.id,
      participantToken: joined.participantToken,
      entrantId: joined.entrant.id,
      name: joined.entrant.name,
    });
    saveOwner({ sessionId: created.session.id, hostToken: created.hostToken });
    navigate('/arcade/trivia/live');
  }, [locationId, questionCount, category, seconds, speedBonus, open, name, isTeam, navigate]);

  if (!signedIn) {
    return (
      <Screen>
        <TopBar title="Start Trivia" back="/arcade/trivia/live" />
        <Content>
          <p className="text-sm text-fairway-100/80">
            Starting a game needs an account — that's just so the room has an owner. Once it's
            going, anyone can join with the code, account or not.
          </p>
          <QuestionCredit />
        </Content>
      </Screen>
    );
  }

  const bankTotal = categories.reduce((n, c) => n + c.n, 0);
  return (
    <Screen>
      <TopBar title="Start Trivia" back="/arcade/trivia/live" />
      <Content>
        <p className="mb-4 text-sm text-fairway-100/70">
          No host, no waiting on staff — the game runs itself. Set it up, share the code, play.
        </p>

        {error && (
          <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

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

        <Setting label="Who can join">
          <div className="flex gap-1.5">
            <Chip on={!open} onClick={() => setOpen(false)}>
              Friends — share the code
            </Chip>
            <Chip on={open} onClick={() => setOpen(true)}>
              Anyone here
            </Chip>
          </div>
          <p className="mt-1.5 text-xs text-fairway-400">
            {open
              ? 'Your game is listed for everyone at the venue — anyone can jump in.'
              : 'Invite-only: the code you share is the only way in.'}
          </p>
        </Setting>

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

        <Button onClick={start} disabled={busy || !locationId || name.trim() === ''}>
          {busy ? 'Setting up…' : 'Start the game'}
        </Button>
        <QuestionCredit />
      </Content>
    </Screen>
  );
}
