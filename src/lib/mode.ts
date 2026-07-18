// Light / dark mode.
//
// The whole environment is driven by the `--color-fairway-*` ramp in index.css,
// which has a dark set (default) and a light set under `:root[data-theme=light]`.
// All this module does is flip the `data-theme` attribute on <html> (and keep
// the PWA status-bar color in step); the CSS does the actual recoloring, so no
// component has to re-render to change theme.
//
// With no explicit choice the app follows the OS preference (and keeps
// following live OS changes until the user picks a mode). The initial attribute
// is set by a tiny inline script in index.html BEFORE first paint, so there's
// no flash of the wrong theme; this module reads it back and takes over.

export type Mode = 'light' | 'dark';

const KEY = 'ffc-theme';
const THEME_COLOR: Record<Mode, string> = { dark: '#2f2f2f', light: '#eaeaea' };

// The user's saved choice, or null if they've never toggled (→ follow the OS).
function storedMode(): Mode | null {
  try {
    const s = localStorage.getItem(KEY);
    return s === 'light' || s === 'dark' ? s : null;
  } catch {
    return null;
  }
}

function osMode(): Mode {
  return typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function readInitial(): Mode {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return storedMode() ?? osMode();
}

let current: Mode = readInitial();
const listeners = new Set<() => void>();

function apply(mode: Mode): void {
  document.documentElement.dataset.theme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[mode]);
}

export function getMode(): Mode {
  return current;
}

export function setMode(mode: Mode): void {
  if (mode === current) return;
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore persistence failures */
  }
  apply(mode);
  listeners.forEach((l) => l());
}

export function toggleMode(): void {
  setMode(current === 'dark' ? 'light' : 'dark');
}

export function subscribeMode(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Follow live OS changes, but only while the user hasn't made an explicit
// choice — once they toggle, their preference is persisted and wins.
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onOsChange = (e: MediaQueryListEvent | MediaQueryList) => {
    if (storedMode() !== null) return;
    current = e.matches ? 'light' : 'dark';
    apply(current);
    listeners.forEach((l) => l());
  };
  // Older iOS/Safari expose only the deprecated addListener; using
  // addEventListener unconditionally throws there and blanks the installed PWA.
  if (mq.addEventListener) mq.addEventListener('change', onOsChange);
  else if (mq.addListener) mq.addListener(onOsChange);
}

// Sync the meta color to the mode the inline script already applied.
apply(current);
