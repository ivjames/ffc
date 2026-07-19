// Tiny haptics kit. A touch-first PWA earns a lot of its "juice" from the phone
// itself buzzing when you tap — the cheapest, most physical feedback there is.
// Everything here is a thin, well-behaved wrapper over the Vibration API:
//
//  • It no-ops silently when unsupported (desktop, iOS Safari — which has never
//    shipped navigator.vibrate) so callers never have to feature-detect.
//  • It shares the app's single feedback mute (`ffc.muted`, owned by lib/sound):
//    one toggle silences both the click AND the buzz, which is what a user
//    reaching for the mute button actually wants.
//  • It honors prefers-reduced-motion — a vibration is motion you feel, and the
//    same users who dim the entrance animations rarely want their pocket
//    buzzing either.
//
// Haptics are fired FROM the sound kit (lib/sound.ts), so every button that
// already declares a sound gets a matching buzz for free — the tactile layer
// rides the audio layer that's already wired through the whole app.

import { isMuted } from './sound';

// Named vibration patterns, tuned to match each sound's character. Numbers are
// milliseconds; an array alternates buzz/pause/buzz for a textured pulse.
// Kept SHORT and gentle — long or heavy buzzes read as errors, not delight.
export type Haptic =
  | 'tap' // ordinary button — a single soft blip
  | 'stroke' // adding a stroke — a crisp tick
  | 'undo' // removing a stroke — a lighter tick
  | 'cup' // ball in the cup / advancing — a satisfying double-thunk
  | 'ding' // correct answer — a quick up-beat
  | 'buzz' // wrong answer — a longer, duller nudge
  | 'select' // landing on a wheel/result — a firm confirm
  | 'win'; // celebration — a little rhythmic fanfare

const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 8,
  stroke: 12,
  undo: 7,
  cup: [16, 40, 26],
  ding: [10, 30, 14],
  buzz: 55,
  select: 22,
  win: [18, 50, 18, 50, 34],
};

let reduceMotion = false;
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduceMotion = mq.matches;
  // Track live changes so a user toggling the OS setting mid-session is honored
  // without a reload. (Older Safari only has addListener; try both.)
  const onChange = (e: MediaQueryListEvent) => {
    reduceMotion = e.matches;
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof (mq as unknown as { addListener?: unknown }).addListener === 'function')
    (mq as unknown as { addListener: (fn: (e: MediaQueryListEvent) => void) => void }).addListener(
      onChange,
    );
}

function canVibrate(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.vibrate === 'function' &&
    !isMuted() &&
    !reduceMotion
  );
}

/** Fire a named haptic pattern. No-ops when unsupported, muted, or the user
 *  prefers reduced motion. Never throws. */
export function haptic(kind: Haptic): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some engines throw from background tabs / on rapid repeat — ignore */
  }
}
