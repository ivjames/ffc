import { useEffect, useState } from 'react';
import { Screen, TopBar, Content } from '../../ui/components';
import { getAllRounds } from '../../db';
import { courseById } from '../../data/courses';
import { coursePar } from '../../lib/scoring';

// Player achievements gallery. The server grants three round achievements
// (server/routes/rounds.js: hole_in_one, under_par, hunt_master) and pays them
// out as tickets on a linked card; there's no player-facing catalog of them, so
// this is that surface — a badges wall showing what's earnable and which ones
// this device has already unlocked.
//
// Earned state is computed from locally-stored completed rounds (the offline
// source of truth), so it works with no account and no network:
//  - hole_in_one: any player carded a 1 on any hole.
//  - under_par:   any player finished a round below the course par.
//  - hunt_master: awarded server-side for finishing a course's scavenger hunt,
//                 which isn't tracked in the local round record — so it's shown
//                 as earnable-at-the-venue rather than auto-detected here.

type Badge = {
  key: string;
  emoji: string;
  label: string;
  how: string;
  /** Whether we can detect this from local round data. */
  detectable: boolean;
};

const BADGES: Badge[] = [
  {
    key: 'hole_in_one',
    emoji: '🎯',
    label: 'Hole-in-One',
    how: 'Sink any hole in a single stroke.',
    detectable: true,
  },
  {
    key: 'under_par',
    emoji: '⛳',
    label: 'Under Par',
    how: 'Finish a full round below the course par.',
    detectable: true,
  },
  {
    key: 'hunt_master',
    emoji: '🕵️',
    label: 'Hunt Master',
    how: "Complete a course's scavenger hunt during a round.",
    detectable: false,
  },
];

function earnedFromLocalRounds(): Promise<Set<string>> {
  return getAllRounds().then((rounds) => {
    const earned = new Set<string>();
    for (const r of rounds) {
      if (r.completedAt == null) continue; // only finished rounds count
      const pars = courseById(r.courseId)?.pars;
      const par = pars ? coursePar(pars) : null;
      for (const row of Object.values(r.scores)) {
        if (!row) continue;
        const entered = row.filter((s): s is number => s != null);
        if (entered.length === 0) continue;
        if (entered.some((s) => s === 1)) earned.add('hole_in_one');
        if (par != null && entered.length === pars!.length) {
          const total = entered.reduce((a, b) => a + b, 0);
          if (total < par) earned.add('under_par');
        }
      }
    }
    return earned;
  });
}

export default function Achievements() {
  const [earned, setEarned] = useState<Set<string> | null>(null);

  useEffect(() => {
    void earnedFromLocalRounds().then(setEarned);
  }, []);

  const earnedCount = earned ? BADGES.filter((b) => earned.has(b.key)).length : 0;

  return (
    <Screen>
      <TopBar title="Achievements" back="/me" />
      <Content>
        <p className="mb-3 text-center text-sm text-fairway-100/70">
          {earned == null
            ? 'Checking your rounds…'
            : `${earnedCount} of ${BADGES.length} unlocked · earn tickets at the counter`}
        </p>

        <ul className="space-y-2">
          {BADGES.map((b) => {
            const isEarned = !!earned?.has(b.key);
            return (
              <li
                key={b.key}
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
                  {b.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-fairway-50">{b.label}</span>
                    {isEarned && (
                      <span className="rounded-full bg-fairway-500/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fairway-300">
                        Earned
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-fairway-100/70">{b.how}</div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-center text-xs text-fairway-100/80">
          Achievements are tracked on this device. Sign in on the Me screen to keep them across
          visits.
        </p>
      </Content>
    </Screen>
  );
}
