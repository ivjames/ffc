import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import CourseTheme from '../../ui/CourseTheme';
import { courseById } from '../../data/courses';
import {
  sanitizeTagInput,
  tagError,
  validateRoster,
  isValidTag,
  TAG_LENGTH,
} from '../../lib/sanitize';
import { createLocalRound, getAllRounds, putRound } from '../../db';
import { fetchMe, type AppUser } from '../../lib/authApi';
import { getMyTag, ownerSeatFor, rememberMyTag } from '../../lib/myTag';
import { lastRoster, recentTags, recentTeamTags } from '../../lib/recentPlayers';
import type { LocalRound } from '../../types';
import { createGame, fetchSnapshot } from '../../lib/gamesApi';
import { createSharedLocalRound } from '../../lib/sharedMerge';
import { DEV_MODE } from '../../lib/flags';
import Icon from '../../ui/Icon';

// Testing aid — a random valid arcade tag (three A–Z/0–9 chars), retrying the
// rare blocklisted combo. Feeds the auto-play button so a whole round can be
// spun up and walked without hand-entering a roster.
const TAG_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function randomTag(): string {
  for (;;) {
    let t = '';
    for (let i = 0; i < TAG_LENGTH; i++) {
      t += TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)];
    }
    if (isValidTag(t)) return t;
  }
}

// §5.1 step 2 — player count (1..4) + three-initial arcade tags (§6 validation).
export default function PlayerSetup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const courseId = params.get('courseId') ?? '';
  const course = courseById(courseId);

  const [count, setCount] = useState(2);
  const [tags, setTags] = useState<string[]>(['', '', '', '']);
  const [teamTag, setTeamTag] = useState('');
  // Which seat is the phone holder's — the seat the achievements wall credits
  // (LocalRound.ownerSlot). 'auto' until the holder taps a choice themselves.
  const [ownerChoice, setOwnerChoice] = useState<number | 'none' | 'auto'>('auto');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Shared-game hosting needs an account (the joiners don't).
  const [me, setMe] = useState<AppUser | null | 'loading'>('loading');
  // The device's round history feeds the "play again with..." suggestions.
  const [history, setHistory] = useState<LocalRound[]>([]);
  // The tag this phone last played under (lib/myTag) — read once; this screen
  // is also one of the places that writes it.
  const [rememberedTag] = useState(() => getMyTag());

  useEffect(() => {
    void fetchMe().then(setMe);
    void getAllRounds().then(setHistory);
  }, []);

  const activeTags = useMemo(() => tags.slice(0, count), [tags, count]);
  // Suggestions derived from history, never a separate store (lib/recentPlayers).
  const lastGroup = useMemo(() => lastRoster(history), [history]);
  const tagChips = useMemo(
    () => recentTags(history).filter((t) => !activeTags.includes(t)),
    [history, activeTags],
  );
  const teamChips = useMemo(
    () => recentTeamTags(history).filter((t) => t !== teamTag),
    [history, teamTag],
  );
  // Untapped default for "which player is you": the seat whose tag is the
  // holder's own — the account's saved tag when signed in, else the tag this
  // phone last played under. A known holder tag that isn't on the roster means
  // they're just keeping score. A phone with no idea who holds it defaults to
  // player 1, the convention the shared-game flow states out loud ("Enter your
  // own tag (player 1)"). One tap overrides any of it.
  const autoOwner = useMemo<number | 'none'>(() => {
    const accountTag = me !== 'loading' ? me?.defaultTag : null;
    return ownerSeatFor(activeTags, accountTag ?? rememberedTag);
  }, [me, rememberedTag, activeTags]);
  // An explicit pick of a seat that a lower player count removed falls back to
  // the default rather than silently crediting whoever now sits there.
  const owner =
    ownerChoice === 'auto' || (typeof ownerChoice === 'number' && ownerChoice >= count)
      ? autoOwner
      : ownerChoice;
  // The team tag is optional — empty is fine, but a partial/blocked one isn't.
  const teamErr = teamTag.length === 0 ? null : tagError(teamTag);
  const rosterValid = validateRoster(activeTags).ok && teamErr === null;

  if (!course) {
    return (
      <Screen>
        <TopBar title="Setup" back="/" />
        <Content>
          <p className="text-fairway-100/70">Course not found. Go back and pick a course.</p>
        </Content>
      </Screen>
    );
  }

  function setTag(i: number, raw: string) {
    setFormError(null);
    setTags((prev) => {
      const next = [...prev];
      next[i] = sanitizeTagInput(raw);
      return next;
    });
  }

  /** One-tap refill of the whole form from the last group on this phone. */
  function useLastGroup() {
    if (!lastGroup) return;
    setFormError(null);
    setCount(lastGroup.tags.length);
    setTags([0, 1, 2, 3].map((i) => lastGroup.tags[i] ?? ''));
    if (lastGroup.groupTag) setTeamTag(lastGroup.groupTag);
  }

  /** Drop a recent tag into the first empty seat; a full roster ignores it. */
  function addRecentTag(tag: string) {
    setFormError(null);
    setTags((prev) => {
      const seat = prev.findIndex((t, i) => i < count && t === '');
      if (seat === -1) return prev;
      const next = [...prev];
      next[seat] = tag;
      return next;
    });
  }

  async function start() {
    const check = validateRoster(activeTags);
    if (!check.ok) {
      setFormError(check.error ?? 'Fix player tags');
      return;
    }
    if (teamErr) {
      setFormError(`Team tag: ${teamErr}`);
      return;
    }
    setSubmitting(true);
    const round = createLocalRound(
      courseId,
      activeTags,
      teamTag.length === TAG_LENGTH ? teamTag : null,
      courseById(courseId)?.pars,
      owner === 'none' ? null : owner,
    );
    // The holder just told us which tag is theirs — remember it so the picker
    // (and the shared-game flows) preselect right next time.
    if (owner !== 'none') rememberMyTag(activeTags[owner]);
    await putRound(round);
    navigate(`/golf/play/${round.clientId}`, { replace: true });
  }

  // Host a shared multi-device game: the host's own tag is player 1's field;
  // everyone else joins by code from their own phone (no roster entry here).
  async function startShared() {
    const hostTag = tags[0];
    if (!isValidTag(hostTag)) {
      setFormError('Enter your own tag (player 1) to host a shared game');
      return;
    }
    if (me === 'loading') return;
    if (!me) {
      navigate('/me/account');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const res = await createGame(courseId, hostTag);
    if (!res.ok) {
      setSubmitting(false);
      setFormError(
        res.status === 401 ? 'Sign in to host a shared game' : res.error ?? 'Could not start',
      );
      return;
    }
    // Hosting states "player 1 is your own tag" — that's the holder's tag.
    rememberMyTag(hostTag);
    // Create returns the bare game; the snapshot fills the roster (just us).
    const snap = await fetchSnapshot(res.game.id, res.participantToken);
    const snapshot = snap.ok
      ? snap.snapshot
      : { game: res.game, players: [{ slot: 0, tag: hostTag, userId: me.id, displayName: me.displayName }], scores: [] };
    const round = createSharedLocalRound(snapshot, res.participantToken, res.slot);
    await putRound(round);
    navigate(`/games/${res.game.id}/lobby`, { replace: true });
  }

  // Testing aid — roll a random roster (1..4 players, random tags), start the
  // round, and hand the scorecard an auto-play mode so it walks the course on
  // arrival. Skips the roster form entirely. No ownerSlot on purpose: nobody
  // on a rolled roster is the holder, and the legacy every-seat reading keeps
  // auto-played rounds useful for exercising the wall.
  async function autoStart(mode: 'slow' | 'fast') {
    if (submitting) return;
    const n = 1 + Math.floor(Math.random() * 4); // 1..4 players
    const roster = Array.from({ length: n }, () => randomTag());
    setSubmitting(true);
    const round = createLocalRound(courseId, roster, null, courseById(courseId)?.pars);
    await putRound(round);
    navigate(`/golf/play/${round.clientId}`, { replace: true, state: { autoPlay: mode } });
  }

  return (
    <CourseTheme theme={course.theme} accent={course.accent}>
    <Screen>
      <TopBar title={course.name} back={`/golf/courses/${courseId}/map`} />
      <Content>
        <label className="mb-2 block text-sm font-semibold text-fairway-100/80">Players</label>
        <div className="mb-6 grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`rounded-xl py-3 text-lg font-bold ${
                count === n
                  ? 'btn-accent text-fairway-50'
                  : 'key text-fairway-100'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <label className="mb-2 block text-sm font-semibold text-fairway-100/80">
          Tags <span className="font-normal text-fairway-100/70">(3 letters/numbers, arcade style)</span>
        </label>
        <div className="space-y-3">
          {activeTags.map((tag, i) => {
            const err = tag.length === TAG_LENGTH ? tagError(tag) : null;
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="w-6 text-right font-mono text-sm text-fairway-100/70">
                  {i + 1}
                </span>
                <input
                  value={tag}
                  onChange={(e) => setTag(i, e.target.value)}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={TAG_LENGTH}
                  placeholder="ABC"
                  aria-label={`Player ${i + 1} tag`}
                  className="surface-sunk font-arcade w-32 rounded-xl border border-fairway-800/60 px-4 py-2.5 text-center text-2xl font-bold uppercase tracking-widest text-fairway-50 focus:border-fairway-500 focus:outline-none"
                  style={{ borderColor: err ? '#ef4444' : undefined }}
                />
                {err && <span className="text-sm text-danger">{err}</span>}
              </div>
            );
          })}
        </div>

        {/* Play again with the same people — suggestions derived from the
            rounds already on this phone (lib/recentPlayers), so regulars never
            retype a roster. Chips only offer tags not already entered. */}
        {lastGroup && (
          <button
            onClick={useLastGroup}
            className="key mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-fairway-100"
          >
            ↺ Last group: <span className="font-arcade">{lastGroup.tags.join(' · ')}</span>
            {lastGroup.groupTag && (
              <span className="text-fairway-100/70">
                {' '}
                · Team <span className="font-arcade">{lastGroup.groupTag}</span>
              </span>
            )}
          </button>
        )}
        {tagChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-fairway-100/70">Played here before:</span>
            {tagChips.map((tag) => (
              <button
                key={tag}
                onClick={() => addRecentTag(tag)}
                className="key font-arcade rounded-full px-3 py-1.5 text-sm font-bold text-fairway-100"
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Whose phone is this? Everyone's scores get typed here, but the
            achievements wall is the holder's own — a friend's hole-in-one on
            your phone is their badge, not yours. The round records the
            holder's seat so detection can tell (lib/achievements/detect). */}
        <label className="mb-2 mt-6 block text-sm font-semibold text-fairway-100/80">
          Which player is you?{' '}
          <span className="font-normal text-fairway-100/70">
            (achievements on this phone count for your player)
          </span>
        </label>
        <div className="grid grid-cols-4 gap-2">
          {activeTags.map((tag, i) => (
            <button
              key={i}
              onClick={() => setOwnerChoice(i)}
              aria-pressed={owner === i}
              className={`rounded-xl py-3 text-lg font-bold ${
                owner === i ? 'btn-accent text-fairway-50' : 'key text-fairway-100'
              }`}
            >
              {tag.length === TAG_LENGTH ? tag : `P${i + 1}`}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOwnerChoice('none')}
          aria-pressed={owner === 'none'}
          className={`mt-2 w-full rounded-xl py-2.5 text-sm font-semibold ${
            owner === 'none' ? 'btn-accent text-fairway-50' : 'key text-fairway-100'
          }`}
        >
          Just keeping score
        </button>

        {/* Optional team tag (punchlist #4 tier 1) — one tag for the whole
            group; the round then also lands on the TV board's Teams tab. */}
        <label className="mb-2 mt-6 block text-sm font-semibold text-fairway-100/80">
          Team tag{' '}
          <span className="font-normal text-fairway-100/70">(optional — play as a team)</span>
        </label>
        <div className="flex items-center gap-3">
          <Icon name="award.medal" className="w-6 text-right text-sm" />
          <input
            value={teamTag}
            onChange={(e) => {
              setFormError(null);
              setTeamTag(sanitizeTagInput(e.target.value));
            }}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={TAG_LENGTH}
            placeholder="TEA"
            aria-label="Team tag (optional)"
            className="surface-sunk font-arcade w-32 rounded-xl border border-fairway-800/60 px-4 py-2.5 text-center text-2xl font-bold uppercase tracking-widest text-fairway-50 focus:border-fairway-500 focus:outline-none"
            style={{ borderColor: teamErr ? '#ef4444' : undefined }}
          />
          {teamErr && <span className="text-sm text-danger">{teamErr}</span>}
        </div>
        {teamChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-fairway-100/70">Recent teams:</span>
            {teamChips.map((team) => (
              <button
                key={team}
                onClick={() => {
                  setFormError(null);
                  setTeamTag(team);
                }}
                className="key font-arcade rounded-full px-3 py-1.5 text-sm font-bold text-fairway-100"
              >
                {team}
              </button>
            ))}
          </div>
        )}

        {formError && <p className="mt-4 text-sm text-danger">{formError}</p>}

        <div className="mt-8">
          <Button onClick={start} disabled={!rosterValid || submitting}>
            {submitting ? 'Starting…' : 'Start round'}
          </Button>
        </div>

        {/* Shared game — friends score the same card from their own phones.
            Uses player 1's tag as the host's; the rest join by code. */}
        <div className="mt-3">
          <Button variant="ghost" onClick={() => void startShared()} disabled={submitting}>
            <Icon name="action.play-together" /> Play together (everyone on their own phone)
          </Button>
          {!me && me !== 'loading' && (
            <p className="mt-1.5 text-center text-xs text-fairway-100/80">
              Hosting needs a (free) account — friends join without one.
            </p>
          )}
        </div>

        {/* Auto-play (testing, dev-mode only) — skip the roster, roll a random
            one, and walk the whole course automatically. Play paces the taps;
            fast forward races through. Mirrors the scorecard's auto-play. */}
        {DEV_MODE && (
          <div className="mt-3 flex gap-3">
            <Button variant="ghost" onClick={() => void autoStart('slow')} disabled={submitting}>
              ▶ Auto play (test)
            </Button>
            <Button variant="ghost" onClick={() => void autoStart('fast')} disabled={submitting}>
              ⏭ Fast forward
            </Button>
          </div>
        )}
      </Content>
    </Screen>
    </CourseTheme>
  );
}
