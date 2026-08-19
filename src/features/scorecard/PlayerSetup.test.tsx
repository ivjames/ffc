// @vitest-environment jsdom
// Roster setup, from the signed-in angle: a saved account tag is assumed to be
// the player at the controls (the arcade convention), so it lands prefilled in
// player 1's field — while guests and tagless accounts still start blank. The
// screen reads the SHARED session store (not its own /me fetch), so the fake
// store below stands in for it and lands the user whenever a test says so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlayerSetup from './PlayerSetup';

type FakeUser = { id: string; email: string; displayName: string | null; defaultTag: string | null };

const session = vi.hoisted(() => {
  const store = {
    state: { user: null as FakeUser | null, known: false, loading: true },
    listeners: new Set<() => void>(),
    /** Land an authoritative session answer, like refreshSession resolving. */
    set(user: FakeUser | null) {
      store.state = { user, known: true, loading: false };
      store.listeners.forEach((notify) => notify());
    },
    reset() {
      store.state = { user: null, known: false, loading: true };
      store.listeners.clear();
    },
  };
  return store;
});

vi.mock('../../lib/session', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSession: () =>
      useSyncExternalStore(
        (cb: () => void) => {
          session.listeners.add(cb);
          return () => session.listeners.delete(cb);
        },
        () => session.state,
      ),
  };
});
vi.mock('../../lib/gamesApi', () => ({
  createGame: vi.fn(),
  fetchSnapshot: vi.fn(),
}));
vi.mock('../../lib/sharedMerge', () => ({ createSharedLocalRound: vi.fn() }));
vi.mock('../../db', () => ({
  createLocalRound: vi.fn(),
  putRound: () => Promise.resolve(),
  getAllRounds: () => Promise.resolve([]),
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

const IVJ: FakeUser = { id: 'u1', email: 'a@b.c', displayName: null, defaultTag: 'IVJ' };

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
  beforeEach(() => {
    vi.clearAllMocks();
    session.reset();
    localStorage.clear(); // no remembered holder tag (lib/myTag) leaks between tests
  });
  afterEach(() => cleanup());

  it("prefills player 1 with a signed-in user's saved tag", async () => {
    session.set(IVJ); // resolved before the screen mounts
    renderSetup();
    await vi.waitFor(() => expect(tagInput('Player 1 tag').value).toBe('IVJ'));
    // Only the first seat is assumed — the rest of the roster stays blank.
    expect(tagInput('Player 2 tag').value).toBe('');
  });

  it('prefills when the session resolves after the screen mounts', async () => {
    renderSetup();
    expect(tagInput('Player 1 tag').value).toBe('');
    act(() => session.set(IVJ));
    await vi.waitFor(() => expect(tagInput('Player 1 tag').value).toBe('IVJ'));
  });

  it('leaves the roster blank for guests and accounts without a tag', async () => {
    renderSetup();
    act(() => session.set(null));
    await Promise.resolve();
    expect(tagInput('Player 1 tag').value).toBe('');
  });

  it('does not overwrite a field the player edited while the session was loading', async () => {
    // A slow session check: the player types into (or clears) player 1 first.
    renderSetup();
    fireEvent.change(tagInput('Player 1 tag'), { target: { value: 'ZZ9' } });
    fireEvent.change(tagInput('Player 1 tag'), { target: { value: '' } });
    act(() => session.set(IVJ));
    // The deliberate clear must survive the session landing.
    await Promise.resolve();
    expect(tagInput('Player 1 tag').value).toBe('');
  });
});
