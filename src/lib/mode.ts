// Light / dark mode.
//
// The whole environment is driven by the `--color-fairway-*` ramp in index.css,
// which has a dark set (default) and a light set under `:root[data-theme=light]`.
// All this module does is flip the `data-theme` attribute on <html> (and keep
// the PWA status-bar color in step); the CSS does the actual recoloring, so no
// component has to re-render to change theme.
//
// The initial attribute is set by a tiny inline script in index.html BEFORE
// first paint, so there's no flash of the wrong theme; this module reads it
// back and stays the source of truth from then on.

export type Mode = 'light' | 'dark';

const KEY = 'ffc-theme';
const THEME_COLOR: Record<Mode, string> = { dark: '#2f2f2f', light: '#eaeaea' };

function readInitial(): Mode {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage unavailable (private mode) — fall through to default */
  }
  return 'dark';
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

// Sync the meta color to the mode the inline script already applied.
apply(current);
