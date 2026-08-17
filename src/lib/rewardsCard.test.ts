// The account-bound card store. Two properties matter most, and both are
// about NOT showing a card that isn't the current player's at the current
// venue: a 401 answers "no card" rather than erroring, and the state is keyed
// to the venue so switching sites can't leave the old venue's balances up.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const currentLocationId = vi.fn(() => 'loc-a');
vi.mock('./location', () => ({
  getCurrentLocationId: () => currentLocationId(),
  useCurrentLocationId: () => currentLocationId(),
}));
vi.mock('../sync', () => ({ apiUrl: (p: string) => `http://test${p}` }));

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const CARD = {
  id: 'PL-1001',
  displayName: 'Alex Card',
  cardNumber: '770001112223',
  tier: 'standard',
  balances: { tickets: 420, gamePlayCredits: 12 },
};

async function freshStore() {
  vi.resetModules();
  return import('./rewardsCard');
}

describe('rewards card store', () => {
  beforeEach(() => {
    currentLocationId.mockReturnValue('loc-a');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the account’s linked card for the current venue', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonRes(200, { ok: true, player: CARD, transactions: [{ id: 't1' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = await freshStore();
    await store.refreshCard();
    const state = store.getCardState();
    expect(state.player?.id).toBe('PL-1001');
    expect(state.transactions).toHaveLength(1);
    expect(state.locationId).toBe('loc-a');
    expect(state.error).toBeNull();
    // The request names the venue, never a card.
    expect(fetchMock.mock.calls[0][0]).toContain('/api/loyalty/me?locationId=loc-a');
  });

  it('treats signed-out as "no card", not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(401, { ok: false, error: 'sign in required' })));
    const store = await freshStore();
    await store.refreshCard();
    const state = store.getCardState();
    expect(state.player).toBeNull();
    expect(state.known).toBe(true);
    expect(state.error).toBeNull();
  });

  it('treats a venue without the add-on the same way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(403, { ok: false, error: 'not enabled' })));
    const store = await freshStore();
    await store.refreshCard();
    expect(store.getCardState().player).toBeNull();
    expect(store.getCardState().error).toBeNull();
  });

  it('stamps the venue it loaded, so a switch invalidates the card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(200, { ok: true, player: CARD, transactions: [] })));
    const store = await freshStore();
    await store.refreshCard();
    expect(store.getCardState().locationId).toBe('loc-a');

    // Player switches venue: the loaded card belongs to the OLD site, so the
    // stamp no longer matches and useCard() will refetch rather than show it.
    currentLocationId.mockReturnValue('loc-b');
    expect(store.getCardState().locationId).not.toBe(currentLocationId());
  });

  it('linking posts the number and adopts the returned card', async () => {
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonRes(200, { ok: true, player: CARD }))
      .mockResolvedValueOnce(jsonRes(200, { ok: true, player: CARD, transactions: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const store = await freshStore();
    const res = await store.linkCard('770001112223');
    expect(res.ok).toBe(true);
    expect(store.getCardState().player?.id).toBe('PL-1001');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/loyalty/link');
    expect(JSON.parse(String(init?.body))).toEqual({
      locationId: 'loc-a',
      cardNumber: '770001112223',
    });
  });

  it('reports an unknown card number without binding anything', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(404, { ok: false, error: 'no card found' })));
    const store = await freshStore();
    const res = await store.linkCard('nope');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No card found/);
    expect(store.getCardState().player).toBeNull();
  });

  it('resetCard drops the card so a shared phone never leaks the last player’s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(200, { ok: true, player: CARD, transactions: [] })));
    const store = await freshStore();
    await store.refreshCard();
    expect(store.getLinkedPlayerId()).toBe('PL-1001');
    store.resetCard();
    expect(store.getLinkedPlayerId()).toBeNull();
    expect(store.getCardState().player).toBeNull();
  });
});
