import type { LocalRound } from '../types';
import { isValidTag } from './sanitize';

// "Who do I play with?" — derived from the rounds already stored on the
// device, not kept as a separate roster store. The history IS the roster:
// nothing to migrate, nothing to drift out of sync, and clearing site data
// clears the suggestions together with the rounds they came from. Shared
// multi-device rounds count too — the friends you hosted last week are
// exactly who you'll rack up again.

export type RecentRoster = { tags: string[]; groupTag: string | null };

/** Rounds newest-first by when they were STARTED — reuse is about recency of
 *  playing together, and an abandoned half-round still names real people. */
function newestFirst(rounds: LocalRound[]): LocalRound[] {
  return [...rounds].sort((a, b) => b.createdAt - a.createdAt);
}

/** The most recent complete roster, for one-tap refill at round setup. A round
 *  carrying any invalid tag (legacy or corrupt data) is skipped whole rather
 *  than refilled with holes. */
export function lastRoster(rounds: LocalRound[]): RecentRoster | null {
  for (const r of newestFirst(rounds)) {
    if (r.playerTags.length === 0 || !r.playerTags.every(isValidTag)) continue;
    return {
      tags: r.playerTags,
      groupTag: r.groupTag && isValidTag(r.groupTag) ? r.groupTag : null,
    };
  }
  return null;
}

/** Distinct player tags, most recently played first. */
export function recentTags(rounds: LocalRound[], limit = 8): string[] {
  const out: string[] = [];
  for (const r of newestFirst(rounds)) {
    for (const tag of r.playerTags) {
      if (!isValidTag(tag) || out.includes(tag)) continue;
      out.push(tag);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Distinct team tags, most recently used first. */
export function recentTeamTags(rounds: LocalRound[], limit = 4): string[] {
  const out: string[] = [];
  for (const r of newestFirst(rounds)) {
    const team = r.groupTag;
    if (!team || !isValidTag(team) || out.includes(team)) continue;
    out.push(team);
    if (out.length >= limit) return out;
  }
  return out;
}
