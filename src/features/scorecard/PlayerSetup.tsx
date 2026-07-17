import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { courseById } from '../../data/courses';
import { sanitizeTagInput, tagError, validateRoster, TAG_LENGTH } from '../../lib/sanitize';
import { createLocalRound, putRound } from '../../db';

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
        <TopBar title="Setup" back="/new" />
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

  return (
    <Screen>
      <TopBar title={course.name} back="/new" />
      <Content>
        <label className="mb-2 block text-sm font-semibold text-fairway-100/80">Players</label>
        <div className="mb-6 grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`rounded-xl py-4 text-lg font-bold transition ${
                count === n
                  ? 'bg-fairway-500 text-fairway-950'
                  : 'border border-fairway-700 bg-fairway-900/40 text-fairway-100'
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <label className="mb-2 block text-sm font-semibold text-fairway-100/80">
          Tags <span className="font-normal text-fairway-100/50">(3 letters/numbers, arcade style)</span>
        </label>
        <div className="space-y-3">
          {activeTags.map((tag, i) => {
            const err = tag.length === TAG_LENGTH ? tagError(tag) : null;
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="w-6 text-right font-mono text-sm text-fairway-100/50">
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
                  className="font-arcade w-32 rounded-xl border-2 border-fairway-700 bg-fairway-950 px-4 py-3 text-center text-2xl font-bold uppercase tracking-widest text-fairway-50 focus:border-fairway-500 focus:outline-none"
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
      </Content>
    </Screen>
  );
}
