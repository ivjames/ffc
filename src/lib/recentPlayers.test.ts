import { describe, test, expect } from 'vitest';
import type { LocalRound } from '../types';
import { lastRoster, recentTags, recentTeamTags } from './recentPlayers';

let seq = 0;
function round(playerTags: string[], createdAt: number, groupTag: string | null = null): LocalRound {
  return {
    clientId: `r${++seq}`,
    courseId: 'c1',
    playerTags,
    groupTag,
    scores: {},
    createdAt,
    completedAt: createdAt,
    syncState: 'synced',
  } as LocalRound;
}

describe('lastRoster', () => {
  test('returns the newest roster with its team tag', () => {
    const rounds = [
      round(['JIM', 'AVA'], 1, 'FAM'),
      round(['JIM', 'TOM', 'SUE'], 2),
    ];
    expect(lastRoster(rounds)).toEqual({ tags: ['JIM', 'TOM', 'SUE'], groupTag: null });
    expect(lastRoster([rounds[0]])).toEqual({ tags: ['JIM', 'AVA'], groupTag: 'FAM' });
  });

  test('skips rounds with invalid tags whole, rather than refilling holes', () => {
    const rounds = [round(['JIM', 'AVA'], 1), round(['JIM', ''], 2)];
    expect(lastRoster(rounds)).toEqual({ tags: ['JIM', 'AVA'], groupTag: null });
    expect(lastRoster([])).toBeNull();
  });
});

describe('recentTags', () => {
  test('distinct, most recently played first', () => {
    const rounds = [
      round(['JIM', 'AVA'], 1),
      round(['TOM', 'JIM'], 2),
    ];
    expect(recentTags(rounds)).toEqual(['TOM', 'JIM', 'AVA']);
  });

  test('respects the limit and skips invalid tags', () => {
    const rounds = [round(['JIM', '', 'AVA', 'TOM'], 1)];
    expect(recentTags(rounds, 2)).toEqual(['JIM', 'AVA']);
  });
});

describe('recentTeamTags', () => {
  test('distinct team tags, newest first, teamless rounds skipped', () => {
    const rounds = [
      round(['JIM'], 1, 'FAM'),
      round(['JIM'], 2),
      round(['JIM'], 3, 'ACE'),
      round(['JIM'], 4, 'FAM'),
    ];
    expect(recentTeamTags(rounds)).toEqual(['FAM', 'ACE']);
  });
});
