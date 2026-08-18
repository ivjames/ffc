// @vitest-environment jsdom
// The achievements wall. The rules themselves are covered in
// lib/achievements/detect.test.ts; this is about what a player SEES — grouping,
// secret badges, the server-owned badge, and badges a deployment can't reach.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LocalRound } from '../../types';

// Two venues, three courses — enough that "every course at one venue" is real
// but "three different venues" is not, so both sides of `reach` are exercised.
// Declared inside the factory: vi.mock is hoisted above module-level consts.
vi.mock('../../data/courses', () => {
  const pars = Array(18).fill(3);
  return {
    COURSES: [
      { id: 'c1', locationId: 'v1', pars },
      { id: 'c2', locationId: 'v1', pars },
      { id: 'c3', locationId: 'v2', pars },
    ],
    LOCATIONS: [],
    courseById: () => undefined,
    locationById: () => undefined,
  };
});

const rounds = vi.hoisted(() => ({ current: [] as LocalRound[] }));
const banked = vi.hoisted(() => ({ current: [] as { key: string; earnedAt: number }[] }));
const saved = vi.hoisted(() => ({ keys: [] as string[] }));
const stored = vi.hoisted(() => ({ rounds: [] as LocalRound[] }));
const server = vi.hoisted(() => ({
  grants: [] as { playerIndex: number; playerTag: string; achievement: string }[],
  fail: false,
  calls: [] as string[],
}));
vi.mock('../../db', () => ({
  getAllRounds: () => Promise.resolve(rounds.current),
  getActivity: () => Promise.resolve([]),
  getEarnedBadges: () => Promise.resolve(banked.current),
  putEarnedBadges: (keys: string[]) => {
    saved.keys.push(...keys);
    return Promise.resolve();
  },
  putRound: (r: LocalRound) => {
    stored.rounds.push(r);
    return Promise.resolve();
  },
}));
vi.mock('../../sync', () => ({
  fetchRewards: (clientId: string) => {
    server.calls.push(clientId);
    return server.fail ? Promise.reject(new Error('offline')) : Promise.resolve(server.grants);
  },
}));

// App state the wall reads for the install / account / card badges.
vi.mock('../../lib/session', () => ({ useSession: () => ({ user: null }) }));
vi.mock('../../lib/rewardsCard', () => ({ useLinkedPlayerId: () => null }));
vi.mock('../../lib/pwaInstall', () => ({ isStandalone: () => false }));

import Achievements from './Achievements';

function aceRound(): LocalRound {
  const card: (number | null)[] = Array(18).fill(3);
  card[4] = 1;
  return {
    clientId: 'r1',
    courseId: 'c1',
    playerTags: ['ACE'],
    scores: { 0: card },
    createdAt: 1,
    completedAt: 1,
    syncState: 'synced',
  } as LocalRound;
}

const renderWall = () =>
  render(
    <MemoryRouter initialEntries={['/me/achievements']}>
      <Achievements />
    </MemoryRouter>,
  );

beforeEach(() => {
  rounds.current = [];
  banked.current = [];
  saved.keys = [];
  stored.rounds = [];
  server.grants = [];
  server.fail = false;
  server.calls = [];
});

/** A synced round whose server grants have not been pulled in yet. */
function syncedRound(over: Partial<LocalRound> = {}): LocalRound {
  return {
    ...aceRound(),
    clientId: 'synced-1',
    scores: { 0: Array(18).fill(3) },
    syncState: 'synced',
    ...over,
  } as LocalRound;
}
afterEach(cleanup);

describe('Achievements wall', () => {
  it('groups badges under category headings', async () => {
    renderWall();
    await waitFor(() => expect(screen.getByText('Scoring')).toBeInTheDocument());
    expect(screen.getByText('The field')).toBeInTheDocument();
    expect(screen.getByText('Wipeouts')).toBeInTheDocument();
    expect(screen.getByText('Courses & venues')).toBeInTheDocument();
  });

  it('counts nothing earned on a fresh device', async () => {
    renderWall();
    await waitFor(() => expect(screen.getByText(/^0 of \d+ unlocked$/)).toBeInTheDocument());
  });

  it('marks a badge earned once a round proves it', async () => {
    rounds.current = [aceRound()];
    renderWall();
    await waitFor(() => expect(screen.getAllByText('Earned').length).toBeGreaterThan(0));
    expect(screen.getByText(/^[1-9]\d* of \d+ unlocked$/)).toBeInTheDocument();
    expect(screen.getByText('Hole-in-One')).toBeInTheDocument();
  });

  it('hides secret badges behind ??? until they are earned', async () => {
    renderWall();
    await waitFor(() => expect(screen.getAllByText('???').length).toBeGreaterThan(0));
    // Rock Bottom is secret, so its name must not leak on an unearned wall.
    expect(screen.queryByText('Rock Bottom')).not.toBeInTheDocument();
  });

  it('omits badges this deployment cannot reach', async () => {
    renderWall();
    await waitFor(() => expect(screen.getByText('Scoring')).toBeInTheDocument());
    // Only two venues in the mocked catalog.
    expect(screen.queryByText('Road Trip')).not.toBeInTheDocument();
    // ...but a venue with two courses makes this one reachable.
    expect(screen.getByText('Course Collector')).toBeInTheDocument();
  });

  it('flags badges only the venue can grant', async () => {
    renderWall();
    await waitFor(() => expect(screen.getByText('Hunt Master')).toBeInTheDocument());
    expect(screen.getAllByText('At the venue').length).toBeGreaterThan(0);
  });

  it('banks newly-earned badges so a cleared history cannot take them back', async () => {
    rounds.current = [aceRound()];
    renderWall();
    await waitFor(() => expect(saved.keys).toContain('hole_in_one'));
  });

  it('shows a badge that was banked earlier even with no rounds left', async () => {
    banked.current = [{ key: 'hole_in_one', earnedAt: 1 }];
    renderWall();
    // No rounds on the device at all, but the badge stays earned.
    await waitFor(() => expect(screen.getAllByText('Earned').length).toBeGreaterThan(0));
    expect(screen.getByText('Hole-in-One')).toBeInTheDocument();
  });
});

describe('importing server-granted badges', () => {
  it('pulls grants for a synced round and banks them', async () => {
    rounds.current = [syncedRound()];
    server.grants = [{ playerIndex: 0, playerTag: 'ACE', achievement: 'hunt_master' }];
    renderWall();
    await waitFor(() => expect(saved.keys).toContain('hunt_master'));
    // And the round is marked, so it is never fetched again.
    expect(stored.rounds.at(-1)?.grantsImportedAt).toEqual(expect.any(Number));
  });

  it('covers rounds the background worker synced after the summary closed', async () => {
    // The point of doing this here rather than on the summary screen: nothing
    // about this round involves that screen having been open.
    rounds.current = [syncedRound({ clientId: 'offline-round' })];
    server.grants = [{ playerIndex: 0, playerTag: 'ACE', achievement: 'first_find' }];
    renderWall();
    await waitFor(() => expect(server.calls).toContain('offline-round'));
    expect(saved.keys).toContain('first_find');
  });

  it('leaves a round unmarked when the fetch fails, so it retries', async () => {
    rounds.current = [syncedRound()];
    server.fail = true;
    renderWall();
    await waitFor(() => expect(server.calls).toHaveLength(1));
    expect(stored.rounds).toHaveLength(0); // never marked
  });

  it('does not re-fetch a round already imported', async () => {
    rounds.current = [syncedRound({ grantsImportedAt: 123 })];
    renderWall();
    await waitFor(() => expect(screen.getByText(/unlocked$/)).toBeInTheDocument());
    expect(server.calls).toHaveLength(0);
  });

  it("takes only this device's seat from a shared game", async () => {
    rounds.current = [
      syncedRound({
        clientId: 'shared:g1',
        shared: { gameId: 'g1', participantToken: 't', slot: 1 },
      } as Partial<LocalRound>),
    ];
    server.grants = [
      { playerIndex: 0, playerTag: 'AAA', achievement: 'hunt_master' },
      { playerIndex: 1, playerTag: 'BBB', achievement: 'first_find' },
    ];
    renderWall();
    await waitFor(() => expect(saved.keys).toContain('first_find'));
    expect(saved.keys).not.toContain('hunt_master');
  });
});
