// Tiny Web Audio "sound kit". All effects are synthesized on the fly so there
// are no audio files to bundle or fetch — important for an offline-first PWA.
// One shared AudioContext, created lazily on the first sound (which always
// happens inside a user gesture, so autoplay policies are satisfied), plus a
// persisted mute toggle.

const MUTE_KEY = 'ffc.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let muted = readMuted();

// Listeners so a mute toggle in the UI can re-render when the flag flips.
const listeners = new Set<() => void>();

export function isMuted(): boolean {
  return muted;
}

export function subscribeMuted(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* private mode / storage disabled — just keep it in memory */
  }
  if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 1, ctx.currentTime, 0.01);
  listeners.forEach((fn) => fn());
}

export function toggleMuted(): void {
  setMuted(!muted);
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  // A context can start (or get) suspended; resume on demand from the gesture.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// A single enveloped oscillator voice.
function tone(opts: {
  type?: OscillatorType;
  freq: number;
  // Optional pitch glide to `freqEnd` over the note.
  freqEnd?: number;
  start?: number; // seconds relative to now
  dur: number;
  gain?: number;
  attack?: number;
}): void {
  const ac = getCtx();
  if (!ac || !master) return;
  const t0 = ac.currentTime + (opts.start ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.freqEnd != null) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);

  const peak = opts.gain ?? 0.2;
  const attack = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

// Short filtered noise burst — used for the putter "tock" and cup rattle.
function noise(opts: { start?: number; dur: number; gain?: number; freq?: number }): void {
  const ac = getCtx();
  if (!ac || !master) return;
  const t0 = ac.currentTime + (opts.start ?? 0);
  const len = Math.max(1, Math.floor(ac.sampleRate * opts.dur));
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = opts.freq ?? 1800;
  bp.Q.value = 0.8;
  const g = ac.createGain();
  const peak = opts.gain ?? 0.15;
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

// —— The kit ——————————————————————————————————————————————————————————

/** Mild, soft click for ordinary buttons. */
export function playClick(): void {
  tone({ type: 'triangle', freq: 660, freqEnd: 520, dur: 0.05, gain: 0.09 });
}

/** Putter "tock" when a stroke is added. */
export function playStroke(): void {
  noise({ dur: 0.045, gain: 0.12, freq: 2600 });
  tone({ type: 'triangle', freq: 420, freqEnd: 300, dur: 0.09, gain: 0.14 });
}

/** Reverse-sounding blip when a stroke is undone (rising sweep). */
export function playUndo(): void {
  tone({ type: 'triangle', freq: 300, freqEnd: 620, dur: 0.12, gain: 0.11 });
}

/** Ball dropping into the cup: a couple of descending plunks + a low thunk. */
export function playCup(): void {
  tone({ type: 'sine', freq: 900, freqEnd: 760, dur: 0.06, gain: 0.16 });
  tone({ type: 'sine', freq: 620, freqEnd: 520, dur: 0.07, gain: 0.16, start: 0.07 });
  tone({ type: 'sine', freq: 300, freqEnd: 180, dur: 0.16, gain: 0.2, start: 0.15 });
  noise({ dur: 0.05, gain: 0.05, freq: 1200, start: 0.15 });
}

/** Bright rising two-note "ding" for a correct answer. */
export function playDing(): void {
  tone({ type: 'triangle', freq: 784, dur: 0.09, gain: 0.16 });
  tone({ type: 'triangle', freq: 1046.5, dur: 0.16, gain: 0.16, start: 0.08 });
}

/** Low descending "buzz" for a wrong answer (soft, not harsh). */
export function playBuzz(): void {
  tone({ type: 'sawtooth', freq: 220, freqEnd: 150, dur: 0.22, gain: 0.09 });
}

/** Short percussive tick — one click of a spinning wheel passing a peg. */
export function playTick(): void {
  noise({ dur: 0.02, gain: 0.06, freq: 3200 });
}

/** Rubbery fender thud when bumper cars collide. `intensity` (~0.5–1.4)
 *  scales the loudness with the closing speed of the hit. */
export function playBump(intensity = 1): void {
  const g = Math.min(0.24, 0.12 * intensity);
  tone({ type: 'sine', freq: 150, freqEnd: 68, dur: 0.13, gain: g });
  noise({ dur: 0.04, gain: g * 0.5, freq: 520 });
}

/** Watery plunk when bumper boats collide. `intensity` (~0.5–1.4) scales the
 *  loudness with the closing speed of the hit. */
export function playWaterBump(intensity = 1): void {
  const g = Math.min(0.2, 0.1 * intensity);
  tone({ type: 'sine', freq: 260, freqEnd: 150, dur: 0.14, gain: g });
  noise({ dur: 0.13, gain: g * 0.7, freq: 1300 });
}

/** Bright little "bip" accent layered on a bump that scores. */
export function playScore(): void {
  tone({ type: 'triangle', freq: 880, freqEnd: 1174.7, dur: 0.09, gain: 0.12 });
}

/** Triumphant little fanfare for the final scorecard. */
export function playFanfare(): void {
  // Ascending arpeggio into a held chord — C5 E5 G5 C6, then C-major triad.
  const seq: Array<[number, number]> = [
    [523.25, 0.0],
    [659.25, 0.12],
    [783.99, 0.24],
    [1046.5, 0.36],
  ];
  for (const [freq, start] of seq) {
    tone({ type: 'triangle', freq, dur: 0.18, gain: 0.16, start });
    tone({ type: 'sine', freq: freq / 2, dur: 0.18, gain: 0.06, start });
  }
  // Final ringing chord.
  const chord = [523.25, 659.25, 783.99, 1046.5];
  for (const freq of chord) tone({ type: 'triangle', freq, dur: 0.7, gain: 0.12, start: 0.5 });
}
