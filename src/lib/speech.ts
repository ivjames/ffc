// Text-to-speech for the room — the MC voice for live trivia.
//
// Built on the browser's own SpeechSynthesis, for the same reason lib/sound
// synthesizes its effects rather than shipping audio files: nothing to bundle,
// nothing to fetch, no per-utterance API bill, and it keeps working when the
// venue wifi doesn't. A cloud voice would sound better and cost money on every
// question of every game; a local voice sounds fine over a PA and costs
// nothing, so that is what this is.
//
// Two rules the rest of the app relies on:
//
//   • It NEVER throws and never needs feature detection at the call site.
//     Unsupported browser, no voices installed, blocked autoplay — speak()
//     quietly does nothing. A game must not break because a phone can't talk.
//   • It is off unless someone turned it on, per device. Forty phones reading
//     the same question aloud a half-second apart is worse than silence, so
//     the host device opts in and players opt in individually if they want it.
//
// The shared mute (`ffc.muted`, owned by lib/sound) still wins: someone who
// hits mute wants the room quiet, and "quiet" obviously includes the voice —
// including the sentence already in the air. Muting drops the AudioContext's
// gain, which silences the effects instantly but does nothing to a voice
// mid-question, so this listens for the flip and cuts the queue itself.

import { isMuted, subscribeMuted } from './sound';
// The words themselves live in a dependency-free module so the server and
// build scripts can produce identical scripts — see lib/speechScript.
import { ROOM_RATE } from './speechScript';

export * from './speechScript';

const SPEECH_KEY = 'ffc.speech';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(SPEECH_KEY) === '1';
  } catch {
    return false;
  }
}

let enabled = typeof window === 'undefined' ? false : readEnabled();

const listeners = new Set<() => void>();

export function isSpeechEnabled(): boolean {
  return enabled;
}

export function subscribeSpeech(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSpeechEnabled(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(SPEECH_KEY, next ? '1' : '0');
  } catch {
    /* private mode — keep it in memory for this session */
  }
  if (!next) stopSpeaking();
  listeners.forEach((fn) => fn());
}

// Mute is a global the voice does not own, so it is watched rather than
// polled: `speak()` checks it before starting, and this catches the case where
// it flips while a question is already being read out.
subscribeMuted(() => {
  if (isMuted()) stopSpeaking();
});

/** True when this browser can speak at all. */
export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function synth(): SpeechSynthesis | null {
  return speechSupported() ? window.speechSynthesis : null;
}

// —— Voice choice ————————————————————————————————————————————————————————
//
// Voices load asynchronously in most browsers (getVoices() is empty until a
// `voiceschanged` event), so this is re-resolved rather than cached once at
// module load, and speaking with `voice: null` — the platform default — is a
// perfectly good fallback the first time.

/** Voices we'd pick out of a lineup, best first. These are the clear,
 *  broadcast-ish English voices that ship with the major platforms; anything
 *  not listed still works, it just isn't preferred. */
const PREFERRED = [
  'Google US English',
  'Samantha', // macOS / iOS default
  'Microsoft Aria',
  'Microsoft Jenny',
  'Daniel',
  'Karen',
];

/** Pick the voice to read with. Exported for the test — it is pure over the
 *  list it is handed. */
export function pickVoice<T extends { name: string; lang: string; localService?: boolean }>(
  voices: T[],
): T | null {
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  if (pool.length === 0) return null;

  const byName = (list: T[]): T | null => {
    for (const name of PREFERRED) {
      const hit = list.find((v) => v.name.startsWith(name));
      if (hit) return hit;
    }
    return null;
  };

  // Local voices come FIRST, before the nicest-sounding name — several of the
  // preferred voices (Google's especially) synthesize on a server, and a
  // question that needs the network to be read is exactly what this module
  // exists to avoid in a venue with bad wifi. Timbre loses to "it will speak".
  // Where the platform doesn't report localService at all, this list is empty
  // and the ranking falls through to name order over everything.
  const local = pool.filter((v) => v.localService);
  return byName(local) ?? local[0] ?? byName(pool) ?? pool[0];
}

function currentVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  try {
    return pickVoice(s.getVoices() ?? []);
  } catch {
    return null;
  }
}

// —— Speaking ————————————————————————————————————————————————————————————

/** Chrome cuts an utterance off after roughly fifteen seconds of speech — a
 *  long-standing bug with no workaround other than not handing it long
 *  utterances. Splitting on sentence boundaries (then clauses, then words as a
 *  last resort) keeps every chunk well under that, and reads better anyway:
 *  the gap between utterances lands as a natural beat. */
export function chunkForSpeech(text: string, max = 160): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return [];
  if (clean.length <= max) return [clean];

  // Sentences first, keeping their terminator.
  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const out: string[] = [];
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (s === '') continue;
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    // Still too long: pack clauses/words up to the limit.
    let buffer = '';
    for (const piece of s.split(/(?<=[,;:])\s+|\s+/)) {
      if (buffer === '') buffer = piece;
      else if (`${buffer} ${piece}`.length <= max) buffer = `${buffer} ${piece}`;
      else {
        out.push(buffer);
        buffer = piece;
      }
    }
    if (buffer !== '') out.push(buffer);
  }
  return out;
}

export type SpeakOptions = {
  /** Cut off whatever is being said first. On by default: a new question must
   *  never queue up behind the tail of the last one's answer. */
  interrupt?: boolean;
  /** 0.1–10, 1 is the voice's normal pace. */
  rate?: number;
  pitch?: number;
};



/** Say something. Silent no-op when speech is unsupported, disabled, or muted.
 *
 * Accepts an array to speak several lines back to back with a natural beat
 * between them (a question and its choices, say) — passing them as one string
 * would run them together and risk Chrome's long-utterance cutoff. */
export function speak(text: string | string[], opts: SpeakOptions = {}): void {
  const s = synth();
  if (!s || !enabled || isMuted()) return;

  const lines = (Array.isArray(text) ? text : [text]).flatMap((line) => chunkForSpeech(line));
  if (lines.length === 0) return;

  if (opts.interrupt !== false) s.cancel();

  const voice = currentVoice();
  for (const line of lines) {
    try {
      const u = new SpeechSynthesisUtterance(line);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = opts.rate ?? ROOM_RATE;
      u.pitch = opts.pitch ?? 1;
      s.speak(u);
    } catch {
      // A single bad utterance shouldn't take the rest of the read down.
    }
  }
}

/** Stop mid-sentence and drop anything queued behind it. */
export function stopSpeaking(): void {
  try {
    synth()?.cancel();
  } catch {
    /* nothing to stop */
  }
}

/** Unlock audio from inside a user gesture and warm the voice list.
 *
 * iOS refuses to speak unless the first utterance comes from a tap, and every
 * platform loads voices lazily — so the toggle that turns speech on speaks a
 * single space, which is inaudible but counts as that first gesture-driven
 * utterance. Without it the first question of the game is silent on iPhones. */
export function primeSpeech(): void {
  const s = synth();
  if (!s) return;
  try {
    s.getVoices();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    s.speak(u);
  } catch {
    /* nothing to prime */
  }
}
