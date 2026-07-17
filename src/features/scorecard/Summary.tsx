import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { courseById } from '../../data/courses';
import { getRound, putRound } from '../../db';
import { syncPending } from '../../sync';
import type { LocalRound } from '../../types';
import {
  HOLE_COUNT,
  coursePar,
  playerTotal,
  formatOverUnder,
  winners,
} from '../../lib/scoring';

// §5.1 step 4 — final scorecard summary. On arrival the round is marked
// completed and queued for sync (§3: persist finished rounds from v1).
export default function Summary() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const [round, setRound] = useState<LocalRound | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    void getRound(clientId).then(async (r) => {
      if (!r) {
        setNotFound(true);
        return;
      }
      // Mark complete + queue for sync exactly once.
      if (r.syncState === 'active') {
        r = { ...r, completedAt: r.completedAt ?? Date.now(), syncState: 'pending' };
        await putRound(r);
      }
      setRound(r);
      // Best-effort push now; retries happen on reconnect (§9).
      void syncPending();
    });
  }, [clientId]);

  const course = round ? courseById(round.courseId) : undefined;

  if (notFound) {
    return (
      <Screen>
        <TopBar title="Summary" back="/" />
        <Content>
          <p className="text-fairway-100/70">That round no longer exists.</p>
        </Content>
      </Screen>
    );
  }
  if (!round || !course) return null;

  const par = coursePar(course.pars);
  const winnerIdx = winners(round.scores, round.playerTags.length);
  const ranked = round.playerTags
    .map((tag, p) => ({ tag, p, total: playerTotal(round.scores[p] ?? []) }))
    .sort((a, b) => a.total - b.total);

  return (
    <Screen>
      <TopBar title="Final scorecard" back="/" />
      <Content>
        <div className="mb-4 text-center">
          <div className="text-sm text-fairway-100/60">{course.name}</div>
          <div className="mt-1 text-xs text-fairway-100/40">Par {par}</div>
        </div>

        {/* Winner banner */}
        <div className="mb-6 rounded-2xl border border-fairway-500/40 bg-fairway-900/60 p-4 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
            {winnerIdx.length > 1 ? 'Tied' : 'Winner'}
          </div>
          <div className="mt-1 flex items-center justify-center gap-2 text-2xl font-black">
            🏆
            {winnerIdx.map((p) => (
              <span key={p} className="font-arcade" style={{ color: course.accent }}>
                {round.playerTags[p]}
              </span>
            ))}
          </div>
        </div>

        {/* Standings */}
        <div className="mb-6 space-y-2">
          {ranked.map((row, rank) => {
            const diff = row.total - par;
            return (
              <div
                key={row.p}
                className="flex items-center justify-between rounded-xl border border-fairway-800 bg-fairway-900/40 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-5 text-center font-mono text-sm text-fairway-100/50">
                    {rank + 1}
                  </span>
                  <span className="font-arcade text-xl font-bold" style={{ color: course.accent }}>
                    {row.tag}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-fairway-50">{row.total}</span>
                  <span className="ml-2 text-sm text-fairway-100/50">{formatOverUnder(diff)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Hole-by-hole grid */}
        <div className="mb-6 overflow-x-auto rounded-xl border border-fairway-800">
          <table className="w-full border-collapse text-center text-sm">
            <thead>
              <tr className="bg-fairway-900/60 text-fairway-100/60">
                <th className="px-2 py-2 text-left font-semibold">Hole</th>
                {Array.from({ length: HOLE_COUNT }, (_, h) => (
                  <th key={h} className="px-2 py-2 font-normal">
                    {h + 1}
                  </th>
                ))}
              </tr>
              <tr className="bg-fairway-950 text-fairway-100/40">
                <th className="px-2 py-1 text-left font-normal">Par</th>
                {course.pars.map((p, h) => (
                  <td key={h} className="px-2 py-1">
                    {p}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {round.playerTags.map((tag, p) => (
                <tr key={p} className="border-t border-fairway-800">
                  <td
                    className="font-arcade px-2 py-2 text-left font-bold"
                    style={{ color: course.accent }}
                  >
                    {tag}
                  </td>
                  {Array.from({ length: HOLE_COUNT }, (_, h) => {
                    const s = round.scores[p]?.[h];
                    const under = s != null && s < course.pars[h];
                    const over = s != null && s > course.pars[h];
                    return (
                      <td
                        key={h}
                        className={`px-2 py-2 ${
                          under ? 'text-fairway-400' : over ? 'text-amber-400' : 'text-fairway-100'
                        }`}
                      >
                        {s ?? '·'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <SyncNote state={round.syncState} />

        <div className="mt-4">
          <Button onClick={() => navigate('/')}>Done</Button>
        </div>
      </Content>
    </Screen>
  );
}

function SyncNote({ state }: { state: LocalRound['syncState'] }) {
  const text =
    state === 'synced'
      ? 'Saved to leaderboard ✓'
      : navigator.onLine
        ? 'Saving to leaderboard…'
        : 'Saved on this device — will sync when back online';
  return <p className="text-center text-xs text-fairway-100/40">{text}</p>;
}
