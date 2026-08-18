import { useEffect, useState } from 'react';

/**
 * Seconds remaining until a server-set deadline, or null when there isn't one.
 *
 * A live trivia room advances on its own clock, and a countdown nobody can see
 * is indistinguishable from a game that has hung — the lobby especially, where
 * there is nothing else moving on the screen. The server sends the deadline
 * (`session.autoAt`) rather than a duration, so every phone in the room lands
 * on the same number regardless of when it connected.
 *
 * Local clock drift only affects what this displays; the server decides when
 * the phase actually ends, so a fast phone can't talk it into moving early.
 */
export function useDeadline(at: string | null | undefined): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!at) {
      setLeft(null);
      return;
    }
    const target = new Date(at).getTime();
    const tick = () => setLeft(Math.max(0, (target - Date.now()) / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [at]);
  return left;
}

/** m:ss for a countdown, or '—' before there is one. */
export function formatCountdown(seconds: number | null): string {
  if (seconds == null) return '—';
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
