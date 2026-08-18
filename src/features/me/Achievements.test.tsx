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
vi.mock('../../db', () => ({ getAllRounds: () => Promise.resolve(rounds.current) }));

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
});
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

  it('flags the badge only the venue can grant', async () => {
    renderWall();
    await waitFor(() => expect(screen.getByText('Hunt Master')).toBeInTheDocument());
    expect(screen.getByText('At the venue')).toBeInTheDocument();
  });
});
