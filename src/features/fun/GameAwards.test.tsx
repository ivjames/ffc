// @vitest-environment jsdom
// The finish-screen awards block: a round is recorded for the achievements
// wall, and anything that recording just unlocked shows up right there — the
// player must not have to visit Me → Achievements to learn they earned a badge
// (the Mole Patrol problem). The detection rules themselves are covered in
// lib/achievements/detect.test.ts; this is the surfacing.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { ActivityMark } from '../../types';

// In-memory stand-ins for the device stores, with a real markActivity so the
// record-then-detect sequencing is exercised end to end.
const db = vi.hoisted(() => ({
  activity: new Map<string, ActivityMark>(),
  banked: [] as { key: string; earnedAt: number }[],
  saved: [] as string[],
}));
vi.mock('../../db', () => ({
  getAllRounds: () => Promise.resolve([]),
  getActivity: () => Promise.resolve([...db.activity.values()]),
  getEarnedBadges: () => Promise.resolve([...db.banked]),
  putEarnedBadges: (keys: string[]) => {
    db.saved.push(...keys);
    for (const key of keys) db.banked.push({ key, earnedAt: 1 });
    return Promise.resolve();
  },
  markActivity: (kind: ActivityMark['kind'], name: string, value?: number) => {
    const id = `${kind}:${name}`;
    const prior = db.activity.get(id);
    db.activity.set(id, {
      id,
      kind,
      name,
      count: (prior?.count ?? 0) + 1,
      best: Math.max(prior?.best ?? 0, value ?? 0),
      firstAt: 1,
      lastAt: 1,
    });
    return Promise.resolve();
  },
}));

// Empty venue catalog: no round-based badges in play, which keeps these tests
// about the activity-driven arcade badges.
vi.mock('../../data/courses', () => ({
  COURSES: [],
  LOCATIONS: [],
}));

// Signed out, no card, browser tab — none of the app-state badges fire.
vi.mock('../../lib/session', () => ({ useSession: () => ({ user: null }) }));
vi.mock('../../lib/rewardsCard', () => ({ useLinkedPlayerId: () => null }));
vi.mock('../../lib/pwaInstall', () => ({ isStandalone: () => false }));

// Ticket gating off by default — most venues don't sell the add-on, and the
// badge surface must not depend on it.
const pos = vi.hoisted(() => ({ gameRewards: false }));
vi.mock('../../lib/pos', () => ({ usePos: () => ({ gameRewards: pos.gameRewards }) }));
vi.mock('../../lib/pos/gameRewards', () => ({ awardGameTickets: () => Promise.resolve(null) }));

import GameAwards from './GameAwards';

const renderAwards = (ui: ReactElement) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/me/achievements" element={<div>THE WALL</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  db.activity.clear();
  db.banked = [];
  db.saved = [];
  pos.gameRewards = false;
});
afterEach(cleanup);

describe('GameAwards badge surfacing', () => {
  it('shows a feat badge on the finish screen the moment it is earned', async () => {
    renderAwards(
      <GameAwards game="whackamole" tickets={30} sessionId="s1" feat="mole-streak" />,
    );
    await waitFor(() => expect(screen.getByText('Mole Patrol')).toBeInTheDocument());
    // First arcade round ever also unlocks Arcade Rookie — both show at once.
    expect(screen.getByText('Arcade Rookie')).toBeInTheDocument();
    expect(screen.getByText(/Achievements unlocked/i)).toBeInTheDocument();
    // ...in the wall's gold.
    expect(screen.getByText('Mole Patrol').closest('.badge-earned')).not.toBeNull();
  });

  it('banks what it shows, so the wall agrees later', async () => {
    renderAwards(
      <GameAwards game="whackamole" tickets={30} sessionId="s1" feat="mole-streak" />,
    );
    await waitFor(() => expect(db.saved).toContain('mole_patrol'));
    expect(db.saved).toContain('arcade_rookie');
  });

  it('shows nothing when the round unlocked nothing new', async () => {
    db.banked = [
      { key: 'arcade_rookie', earnedAt: 1 },
      { key: 'mole_patrol', earnedAt: 1 },
    ];
    renderAwards(
      <GameAwards game="whackamole" tickets={30} sessionId="s2" feat="mole-streak" />,
    );
    // The round is still recorded for the wall's tallies...
    await waitFor(() => expect(db.activity.get('game:whackamole')?.count).toBe(1));
    // ...but no card appears, and nothing is re-banked.
    expect(screen.queryByText(/unlocked/i)).not.toBeInTheDocument();
    expect(db.saved).toHaveLength(0);
  });

  it('surfaces only the NEW badge when others were banked earlier', async () => {
    db.banked = [{ key: 'arcade_rookie', earnedAt: 1 }];
    renderAwards(
      <GameAwards game="whackamole" tickets={30} sessionId="s3" feat="mole-streak" />,
    );
    await waitFor(() => expect(screen.getByText('Mole Patrol')).toBeInTheDocument());
    expect(screen.queryByText('Arcade Rookie')).not.toBeInTheDocument();
    expect(screen.getByText(/Achievement unlocked/i)).toBeInTheDocument();
  });

  it('opens the achievements wall when the card is tapped', async () => {
    renderAwards(
      <GameAwards game="whackamole" tickets={30} sessionId="s4" feat="mole-streak" />,
    );
    const card = await screen.findByText('Mole Patrol');
    expect(screen.getByText('See all achievements ›')).toBeInTheDocument();
    card.closest('button')!.click();
    await waitFor(() => expect(screen.getByText('THE WALL')).toBeInTheDocument());
  });

  it('records the round once per session id, re-renders included', async () => {
    const { rerender } = renderAwards(
      <GameAwards game="darts" tickets={10} sessionId="s5" feat="bullseye" />,
    );
    await waitFor(() => expect(db.activity.get('game:darts')?.count).toBe(1));
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={<GameAwards game="darts" tickets={10} sessionId="s5" feat="bullseye" />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Bullseye')).toBeInTheDocument());
    expect(db.activity.get('game:darts')?.count).toBe(1);
    expect(db.activity.get('feat:bullseye')?.count).toBe(1);
  });

  it('keeps the ticket nudge working beside the badges', async () => {
    // gameRewards venue, no linked card: the badge card and the link-your-card
    // nudge both render — composing the two must not gate the badges.
    pos.gameRewards = true;
    renderAwards(
      <GameAwards game="whackamole" tickets={30} sessionId="s6" feat="mole-streak" />,
    );
    await waitFor(() => expect(screen.getByText('Mole Patrol')).toBeInTheDocument());
    expect(screen.getByText(/link your rewards card/i)).toBeInTheDocument();
  });
});
