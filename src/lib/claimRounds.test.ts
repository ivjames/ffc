import { describe, it, expect } from 'vitest';
import { collectClaimableClientIds } from './claimRounds';

// Pure selection of which device round ids to claim — the network claim is
// exercised in the app (node env here, no DOM).

const r = (clientId: string, completedAt: number | null) => ({ clientId, completedAt });

describe('collectClaimableClientIds', () => {
  it('keeps only completed rounds (the ones that have synced)', () => {
    const ids = collectClaimableClientIds([r('a', 123), r('b', null), r('c', 456)]);
    expect(ids).toEqual(['a', 'c']);
  });

  it('de-dupes ids and caps the batch at 500', () => {
    expect(collectClaimableClientIds([r('x', 1), r('x', 2)])).toEqual(['x']);
    const many = Array.from({ length: 600 }, (_, i) => r(`id-${i}`, 1));
    expect(collectClaimableClientIds(many)).toHaveLength(500);
  });

  it('excludes shared games (one canonical round, many participants)', () => {
    const ids = collectClaimableClientIds([r('solo-1', 1), r('shared:game-9', 1)]);
    expect(ids).toEqual(['solo-1']);
  });
});
