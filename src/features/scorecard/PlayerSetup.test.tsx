// @vitest-environment jsdom
// Roster setup, from the signed-in angle: a saved account tag is assumed to be
// the player at the controls (the arcade convention), so it lands prefilled in
// player 1's field — while guests and tagless accounts still start blank.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlayerSetup from './PlayerSetup';

const fetchMe = vi.fn();

vi.mock('../../lib/authApi', () => ({ fetchMe: () => fetchMe() }));
vi.mock('../../lib/gamesApi', () => ({
  createGame: vi.fn(),
  fetchSnapshot: vi.fn(),
}));
vi.mock('../../lib/sharedMerge', () => ({ createSharedLocalRound: vi.fn() }));
vi.mock('../../db', () => ({
  createLocalRound: vi.fn(),
  putRound: () => Promise.resolve(),
}));
vi.mock('../../data/courses', () => ({
  courseById: () => ({
    id: 'c1',
    locationId: 'l1',
    name: 'Test Course',
    theme: 'classic',
    holeCount: 18,
    pars: Array(18).fill(3),
    accent: '#22c55e',
    rules: [],
    hasHunt: false,
  }),
}));

function tagInput(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function renderSetup() {
  render(
    <MemoryRouter initialEntries={['/golf/setup?courseId=c1']}>
      <PlayerSetup />
    </MemoryRouter>,
  );
}

describe('PlayerSetup', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("prefills player 1 with a signed-in user's saved tag", async () => {
    fetchMe.mockResolvedValue({ id: 'u1', email: 'a@b.c', displayName: null, defaultTag: 'IVJ' });
    renderSetup();
    await vi.waitFor(() => expect(tagInput('Player 1 tag').value).toBe('IVJ'));
    // Only the first seat is assumed — the rest of the roster stays blank.
    expect(tagInput('Player 2 tag').value).toBe('');
  });

  it('leaves the roster blank for guests and accounts without a tag', async () => {
    fetchMe.mockResolvedValue(null);
    renderSetup();
    // fetchMe resolves in a microtask; drain it before asserting nothing moved.
    await vi.waitFor(() => expect(fetchMe).toHaveBeenCalled());
    await Promise.resolve();
    expect(tagInput('Player 1 tag').value).toBe('');
  });
});
