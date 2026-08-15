import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button, TagChip } from '../../ui/components';
import CourseTheme from '../../ui/CourseTheme';
import JoinQr from './JoinQr';
import { courseById } from '../../data/courses';
import { getRound } from '../../db';
import { openSharedRound, type SharedStatus } from '../../sync/shared';
import type { LocalRound } from '../../types';

// Shared-game lobby — the host lands here after creating a game (joiners can
// visit too). Shows the join code + QR and the roster filling up live; Start
// heads to the scorecard (play can begin any time — late joiners still land
// in the same game).
export default function Lobby() {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
  const clientId = `shared:${gameId}`;
  const [round, setRound] = useState<LocalRound | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState<SharedStatus>('offline');
  const [copied, setCopied] = useState(false);
  const handleRef = useRef<ReturnType<typeof openSharedRound> | null>(null);

  useEffect(() => {
    let disposed = false;
    void getRound(clientId).then((r) => {
      if (disposed) return;
      if (!r?.shared) {
        setNotFound(true);
        return;
      }
      setRound(r);
      handleRef.current = openSharedRound(clientId, setRound, setStatus);
    });
    return () => {
      disposed = true;
      handleRef.current?.close();
      handleRef.current = null;
    };
  }, [clientId]);

  if (notFound) {
    return (
      <Screen>
        <TopBar title="Shared game" back="/" />
        <Content>
          <p className="text-fairway-100/70">
            This game isn't on this device — join it with its code instead.
          </p>
          <div className="mt-4">
            <Button onClick={() => navigate('/join')}>Enter a join code</Button>
          </div>
        </Content>
      </Screen>
    );
  }

  const course = round ? courseById(round.courseId) : undefined;
  if (!round?.shared || !course) return null;

  const joinUrl = `${window.location.origin}/join?code=${round.shared.joinCode}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (http, permissions) — the code is on
      // screen anyway.
    }
  }

  return (
    <CourseTheme theme={course.theme} accent={course.accent}>
      <Screen>
        <TopBar title="Play together" back="/" />
        <Content>
          <p className="mb-4 text-center text-sm text-fairway-100/70">
            {course.name} · friends join from their own phone and everyone marks the same
            scorecard.
          </p>

          <div className="surface-1 mb-4 rounded-3xl border border-fairway-800/60 p-5 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-fairway-400">
              Join code
            </div>
            <div
              data-testid="join-code"
              className="font-arcade mt-1 text-5xl font-black tracking-[0.2em] text-fairway-50"
            >
              {round.shared.joinCode}
            </div>
            <div className="mt-4 flex justify-center">
              <JoinQr url={joinUrl} />
            </div>
            <p className="mt-3 text-xs text-fairway-100/70">
              Scan the code, or open <span className="font-semibold">{window.location.host}/join</span>{' '}
              and type it in.
            </p>
            <button
              onClick={() => void copyLink()}
              className="mt-2 text-sm font-semibold text-fairway-400"
            >
              {copied ? 'Link copied ✓' : 'Copy join link'}
            </button>
          </div>

          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-semibold text-fairway-100/80">Players</label>
            <LivePill status={status} />
          </div>
          <div className="mb-6 space-y-2">
            {round.playerTags.map((tag, i) => (
              <div
                key={i}
                className="surface-1 flex items-center gap-3 rounded-2xl border border-fairway-800/60 px-4 py-2.5"
              >
                <TagChip tag={tag} color={course.accent} />
                {i === round.shared!.slot && (
                  <span className="text-xs text-fairway-100/80">(this phone)</span>
                )}
              </div>
            ))}
            {round.playerTags.length < 4 && (
              <p className="px-1 text-xs text-fairway-100/80">
                Waiting for friends… up to {4 - round.playerTags.length} more can join.
              </p>
            )}
          </div>

          <Button sound="cup" onClick={() => navigate(`/golf/play/${clientId}`)}>
            Start playing
          </Button>
          <p className="mt-2 text-center text-xs text-fairway-100/80">
            Friends can still join after you start.
          </p>
        </Content>
      </Screen>
    </CourseTheme>
  );
}

export function LivePill({ status }: { status: SharedStatus }) {
  const styles: Record<SharedStatus, { dot: string; label: string }> = {
    live: { dot: 'bg-emerald-400', label: 'Live' },
    reconnecting: { dot: 'bg-amber-400', label: 'Reconnecting…' },
    offline: { dot: 'bg-danger', label: 'Offline' },
  };
  const s = styles[status];
  return (
    <span className="surface-1 inline-flex items-center gap-1.5 rounded-full border border-fairway-800/60 px-2.5 py-1 text-xs font-semibold text-fairway-100/80">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
