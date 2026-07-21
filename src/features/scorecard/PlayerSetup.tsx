import { useMemo, useState } from 'react';
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
import { createLocalRound, putRound } from '../../db';
import { DEV_MODE } from '../../lib/flags';

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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const activeTags = useMemo(() => tags.slice(0, count), [tags, count]);
  const rosterValid = validateRoster(activeTags).ok;

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

  async function start() {
    const check = validateRoster(activeTags);
    if (!check.ok) {
      setFormError(check.error ?? 'Fix player tags');
      return;
    }
    setSubmitting(true);
    const round = createLocalRound(courseId, activeTags);
    await putRound(round);
    navigate(`/play/${round.clientId}`, { replace: true });
  }

  // Testing aid — roll a random roster (1..4 players, random tags), start the
  // round, and hand the scorecard an auto-play mode so it walks the course on
  // arrival. Skips the roster form entirely.
  async function autoStart(mode: 'slow' | 'fast') {
    if (submitting) return;
    const n = 1 + Math.floor(Math.random() * 4); // 1..4 players
    const roster = Array.from({ length: n }, () => randomTag());
    setSubmitting(true);
    const round = createLocalRound(courseId, roster);
    await putRound(round);
    navigate(`/play/${round.clientId}`, { replace: true, state: { autoPlay: mode } });
  }

  return (
    <CourseTheme theme={course.theme} accent={course.accent}>
    <Screen>
      <TopBar title={course.name} back={`/courses/${courseId}/map`} />
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
                {err && <span className="text-sm text-red-400">{err}</span>}
              </div>
            );
          })}
        </div>

        {formError && <p className="mt-4 text-sm text-red-400">{formError}</p>}

        <div className="mt-8">
          <Button onClick={start} disabled={!rosterValid || submitting}>
            {submitting ? 'Starting…' : 'Start round'}
          </Button>
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
