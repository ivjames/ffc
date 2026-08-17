import { useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import CourseTheme from '../../ui/CourseTheme';
import { TAG_LENGTH, sanitizeTagInput, tagError } from '../../lib/sanitize';
import { startVenueHuntSession, type VenueHuntSession } from './venueSession';

// The venue hunt's front door. A course hunt inherits its group from the round
// the players already set up; a course-free hunt has no such round, so this is
// where the group is formed — the same 1..4 arcade tags, collected the same way
// as the scorecard's PlayerSetup so one player's tag means the same thing on
// the hunt, the leaderboard, and the TV board.
//
// Deliberately NOT the golf setup screen: no course to pick, no pars, no team
// tag (the venue hunt has no team board behind it). Just "who's playing".
const MAX_PLAYERS = 4;

export default function VenueHuntStart({
  backTo,
  venueName,
  accent,
  itemCount,
  locationId,
  onStarted,
}: {
  backTo: string;
  venueName?: string;
  accent?: string;
  /** How many things there are to find — set expectations before committing. */
  itemCount: number;
  locationId: string;
  onStarted: (session: VenueHuntSession) => void;
}) {
  // Start with one player: a solo hunt is the common case for a walk-up, and
  // adding people is one tap.
  const [tags, setTags] = useState<string[]>(['']);

  function setTag(i: number, raw: string) {
    setTags((prev) => {
      const next = [...prev];
      next[i] = sanitizeTagInput(raw);
      return next;
    });
  }

  // Every slot must hold a complete, allowed tag. Duplicates are allowed
  // through by the same reasoning as the round roster — the hunt keys finds by
  // tag, so two "ABC" players are simply one hunt identity, not an error.
  const errors = tags.map((t) => (t.length === TAG_LENGTH ? tagError(t) : null));
  const ready = tags.every((t) => t.length === TAG_LENGTH) && errors.every((e) => e === null);

  function start() {
    if (!ready) return;
    onStarted(startVenueHuntSession(locationId, tags));
  }

  return (
    <CourseTheme accent={accent}>
      <Screen>
        <TopBar title="Scavenger hunt" back={backTo} />
        <Content>
          <div className="mb-5 text-center">
            <div className="text-5xl">🔍</div>
            <h2 className="mt-3 text-xl font-bold text-fairway-50">
              {venueName ? `Hunt around ${venueName}` : 'Start the hunt'}
            </h2>
            <p className="mx-auto mt-2 max-w-xs text-sm text-fairway-100/70">
              {itemCount > 0
                ? `${itemCount} ${itemCount === 1 ? 'thing' : 'things'} to find. `
                : ''}
              Snap a photo of each one and we'll check it off. No game required —
              hunt whenever you like.
            </p>
          </div>

          <label className="mb-2 block text-sm font-semibold text-fairway-100/80">
            Who's playing?{' '}
            <span className="font-normal text-fairway-100/70">
              (3 letters/numbers, arcade style)
            </span>
          </label>
          <div className="space-y-3">
            {tags.map((tag, i) => (
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
                  style={{ borderColor: errors[i] ? '#ef4444' : undefined }}
                />
                {errors[i] && <span className="text-sm text-danger">{errors[i]}</span>}
                {tags.length > 1 && (
                  <button
                    onClick={() => setTags((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove player ${i + 1}`}
                    className="text-sm text-fairway-100/70 underline active:opacity-70"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {tags.length < MAX_PLAYERS && (
            <button
              onClick={() => setTags((prev) => [...prev, ''])}
              className="mt-3 text-sm font-semibold text-fairway-400 active:opacity-70"
            >
              + Add player
            </button>
          )}

          <div className="mt-7">
            <Button onClick={start} disabled={!ready}>
              Start hunting
            </Button>
          </div>
        </Content>
      </Screen>
    </CourseTheme>
  );
}
