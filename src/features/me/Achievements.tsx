import { useEffect, useMemo, useState } from 'react';
import { Screen, TopBar, Content } from '../../ui/components';
import { getAllRounds } from '../../db';
import Icon from '../../ui/Icon';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Achievement,
} from '../../lib/achievements/catalog';
import { detectEarned, reachableAchievements } from '../../lib/achievements/detect';

// The player's achievements wall. The catalog lives in lib/achievements/catalog
// and the rules in lib/achievements/detect — this file is only the surface.
//
// Achievements are BADGES and pay nothing (see server/lib/rewards.js): no
// tickets, no loyalty-card credit, no counter redemption. Earned state is
// computed from locally-stored completed rounds, so the wall works with no
// account and no network.
//
// Three display rules the catalog drives:
//   · unreachable badges are omitted entirely — a single-venue deployment never
//     shows "play at three venues", because a permanently grey badge reads as
//     broken rather than aspirational
//   · secret badges show as "???" until earned; the discovery is the point
//   · a badge the server owns (the hunt) can't be auto-detected here, so it
//     stays visibly earnable rather than pretending to be locked

/** Unearned secret badges give nothing away. */
const SECRET_LABEL = '???';
const SECRET_HOW = 'Hidden — you will know it when it happens.';

export default function Achievements() {
  const [earned, setEarned] = useState<Set<string> | null>(null);
  // The catalog is read once per mount: it depends on the venue list, which is
  // hydrated at boot, and the wall is not a hot path.
  const shown = useMemo(() => reachableAchievements(), []);

  useEffect(() => {
    void getAllRounds().then((rounds) => setEarned(detectEarned(rounds)));
  }, []);

  const earnedCount = earned ? shown.filter((a) => earned.has(a.key)).length : 0;

  const sections = CATEGORY_ORDER.map((category) => ({
    category,
    items: sortEarnedFirst(
      shown.filter((a) => a.category === category),
      earned,
    ),
  })).filter((s) => s.items.length > 0);

  return (
    <Screen>
      <TopBar title="Achievements" back="/me" />
      <Content>
        <p className="mb-4 text-center text-sm text-fairway-100/70">
          {earned == null ? 'Checking your rounds…' : `${earnedCount} of ${shown.length} unlocked`}
        </p>

        {sections.map(({ category, items }) => (
          <section key={category} className="mb-5">
            <h2 className="mb-2 flex items-baseline justify-between gap-2 px-1">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-fairway-400">
                {CATEGORY_LABELS[category]}
              </span>
              <span className="text-[11px] tabular-nums text-fairway-100/60">
                {items.filter((a) => earned?.has(a.key)).length}/{items.length}
              </span>
            </h2>
            <ul className="space-y-2">
              {items.map((a) => (
                <BadgeRow key={a.key} badge={a} isEarned={!!earned?.has(a.key)} />
              ))}
            </ul>
          </section>
        ))}

        <p className="mt-4 text-center text-xs text-fairway-100/80">
          Achievements are tracked on this device. Sign in on the Me screen to keep them across
          visits.
        </p>
      </Content>
    </Screen>
  );
}

/** Earned badges rise to the top of their section; catalog order otherwise. */
function sortEarnedFirst(items: Achievement[], earned: Set<string> | null): Achievement[] {
  if (!earned) return items;
  return [...items].sort(
    (a, b) => Number(earned.has(b.key)) - Number(earned.has(a.key)),
  );
}

function BadgeRow({ badge, isEarned }: { badge: Achievement; isEarned: boolean }) {
  const hidden = !!badge.secret && !isEarned;
  return (
    <li
      className={`surface-1 flex items-center gap-3 rounded-2xl border px-4 py-3 ${
        isEarned ? 'border-fairway-500/50' : 'border-fairway-800/60'
      }`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl ${
          isEarned ? '' : 'grayscale'
        }`}
        style={{
          background: isEarned ? '#16653433' : 'transparent',
          border: '1px solid',
          borderColor: isEarned ? '#16653488' : 'var(--color-fairway-800)',
          opacity: isEarned ? 1 : 0.6,
        }}
        aria-hidden="true"
      >
        <Icon name={hidden ? 'state.locked' : badge.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-fairway-50">
            {hidden ? SECRET_LABEL : badge.label}
          </span>
          {isEarned && (
            <span className="rounded-full bg-fairway-500/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fairway-300">
              Earned
            </span>
          )}
          {/* The hunt is granted server-side from verified finds, so this device
              can't see it. Say so rather than showing a locked badge that will
              never tick over on its own. */}
          {!badge.local && !isEarned && (
            <span className="rounded-full border border-fairway-800/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fairway-100/60">
              At the venue
            </span>
          )}
        </div>
        <div className="text-xs text-fairway-100/70">{hidden ? SECRET_HOW : badge.how}</div>
      </div>
    </li>
  );
}
