// @vitest-environment jsdom
// Joining a shared game, from the achievements angle: "Crashed the Party" is
// about joining SOMEONE ELSE's game, and the join endpoint happily hands a
// host their own seat back when they type their own code. The slot is what
// tells the two apart — seat 0 is the creator's by construction.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JoinGame from './JoinGame';

const joinGame = vi.fn();
const markActivity = vi.fn();

vi.mock('../../lib/gamesApi', () => ({ joinGame: (...a: unknown[]) => joinGame(...a) }));
vi.mock('../../lib/authApi', () => ({ fetchMe: () => Promise.resolve(null) }));
vi.mock('../../lib/sharedMerge', () => ({
  createSharedLocalRound: () => ({ clientId: 'shared:g1' }),
}));
vi.mock('../../db', () => ({
  getRound: () => Promise.resolve(undefined),
  putRound: () => Promise.resolve(),
  markActivity: (...a: unknown[]) => markActivity(...a),
}));

const ok = (slot: number) => ({
  ok: true as const,
  slot,
  participantToken: 't',
  snapshot: { game: { id: 'g1' } },
});

async function joinAs(slot: number) {
  joinGame.mockResolvedValue(ok(slot));
  render(
    <MemoryRouter initialEntries={['/join']}>
      <JoinGame />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Join code'), { target: { value: 'AB12CD' } });
  fireEvent.change(screen.getByLabelText('Your player tag'), { target: { value: 'ABC' } });
  fireEvent.click(screen.getByText('Join game'));
  await vi.waitFor(() => expect(joinGame).toHaveBeenCalled());
  // The mark is fired from the same continuation as the navigate, so let the
  // microtask queue drain before asserting it did NOT happen.
  await Promise.resolve();
  await Promise.resolve();
}

describe('JoinGame', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('records the joiner badge for a seat above the host', async () => {
    await joinAs(2);
    expect(markActivity).toHaveBeenCalledWith('social', 'join');
  });

  it('does not record it when the host rejoins their own game', async () => {
    // /api/games/join returns the creator's existing slot 0 for a rejoin, and
    // the request succeeds — so success alone can't be the trigger.
    await joinAs(0);
    expect(markActivity).not.toHaveBeenCalled();
  });
});
