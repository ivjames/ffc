import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActivity, getAllRounds, getEarnedBadges, putEarnedBadges } from '../db';
import { useLinkedPlayerId } from '../lib/rewardsCard';
import { useSession } from '../lib/session';
import { isStandalone } from '../lib/pwaInstall';
import { ACHIEVEMENTS_BY_KEY, type Achievement } from '../lib/achievements/catalog';
import { detectEarned } from '../lib/achievements/detect';
import Icon from './Icon';

// "Achievement unlocked" — the finish-screen surface of the achievements wall.
//
// The wall (features/me/Achievements) runs detection when the PLAYER goes
// looking, which meant a badge earned mid-game sat invisible until they
// happened to visit Me → Achievements. This runs the same detection at the
// moment the badge was actually earned — a game's end screen, a round's final
// scorecard — banks anything new, and shows it in the wall's gold. Nothing new
// this time renders nothing at all.
//
//   <BadgeUnlocks sessionId={sessionId} mark={async () => { …markActivity… }} />
//
// Detection runs TWICE — once on the state before this event, once after — and
// only the difference is shown. The banked set can't stand in for "before": a
// device with plenty of history whose player never opened the wall has an
// empty bank, and judging against it would dump every historically-provable
// badge onto one unrelated finish screen as "just unlocked". Everything the
// before-pass proves is still banked, just silently — surfacing it was always
// the wall's job.
//
// The event is described by the props: `mark` (optional) records the activity
// this round produced, awaited between the two passes — two sibling effects
// racing over IndexedDB would sometimes judge the round before its own feat
// landed. `newRoundId` (optional) names the stored round that IS the event
// (the golf summary), so the before-pass judges the history without it.
// `sessionId` is the once-only key: a re-render or StrictMode's double effect
// can't re-mark or re-detect the same round.
//
// The whole card navigates to the wall, so the moment doubles as the door to
// the rest of the collection.
export default function BadgeUnlocks({
  sessionId,
  mark,
  newRoundId,
}: {
  sessionId: string;
  /** Record this round's activity marks; awaited between the two passes. */
  mark?: () => Promise<void>;
  /** The stored round this event IS — excluded from the before-pass. */
  newRoundId?: string;
}) {
  const navigate = useNavigate();
  const signedIn = useSession().user != null;
  const carded = useLinkedPlayerId() != null;
  const [fresh, setFresh] = useState<Achievement[]>([]);
  const ran = useRef<string | null>(null);

  useEffect(() => {
    if (ran.current === sessionId) return;
    ran.current = sessionId;
    void (async () => {
      const [rounds, activityBefore, banked] = await Promise.all([
        getAllRounds(),
        getActivity(),
        getEarnedBadges(),
      ]);
      const known = new Set(banked.map((b) => b.key));
      // Same context the wall uses, so the two can never disagree about what
      // just unlocked. detectEarned unions in `alreadyEarned`, so the meta
      // badges ("earn twenty others") count what's banked too.
      const app = { installed: isStandalone(), signedIn, carded };
      const before = detectEarned(
        newRoundId ? rounds.filter((r) => r.clientId !== newRoundId) : rounds,
        { activity: activityBefore, app, alreadyEarned: [...known] },
      );
      await mark?.();
      // Only the activity store can have changed between the passes.
      const activity = mark ? await getActivity() : activityBefore;
      const all = detectEarned(rounds, { activity, app, alreadyEarned: [...known] });
      // Bank EVERYTHING newly provable — the badge is earned whether or not
      // this render survives — but show only what this event unlocked.
      const toBank = [...all].filter((k) => !known.has(k));
      if (toBank.length > 0) await putEarnedBadges(toBank);
      const freshKeys = [...all].filter((k) => !before.has(k));
      if (freshKeys.length === 0) return;
      setFresh(
        freshKeys
          .map((k) => ACHIEVEMENTS_BY_KEY.get(k))
          .filter((a): a is Achievement => a != null),
      );
    })();
  }, [sessionId, mark, newRoundId, signedIn, carded]);

  if (fresh.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/me/achievements')}
      className="animate-pop-in mt-4 block w-full text-left transition-transform active:translate-y-px"
    >
      <div className="surface rounded-3xl border border-fairway-500/40 p-4">
        <div className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.25em] text-fairway-400">
          <Icon name="award.medal" /> Achievement{fresh.length === 1 ? '' : 's'} unlocked
        </div>
        <div className="space-y-2">
          {fresh.map((a) => (
            // Gold, like the wall: "earned" is the same colour everywhere.
            <div
              key={a.key}
              className="surface-1 badge-earned flex items-center gap-3 rounded-2xl border px-4 py-2.5"
            >
              <span className="badge-disc flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <Icon name={a.icon} className="text-lg" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="badge-label text-sm font-bold">{a.label}</div>
                <div className="text-xs text-fairway-100/70">{a.how}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-center text-xs font-semibold text-fairway-400">
          See all achievements ›
        </div>
      </div>
    </button>
  );
}
