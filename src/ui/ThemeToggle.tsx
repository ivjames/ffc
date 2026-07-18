import { useSyncExternalStore } from 'react';
import { getMode, subscribeMode, toggleMode } from '../lib/mode';
import { playClick } from '../lib/sound';

// Always-available light/dark switch. Mirrors SoundToggle's pill styling and
// sits next to it in the bottom-left corner. The icon shows the mode you'd
// switch TO (sun while dark, moon while light) — the usual toggle convention.
export default function ThemeToggle() {
  const mode = useSyncExternalStore(subscribeMode, getMode, getMode);
  const dark = mode === 'dark';
  return (
    <button
      onClick={() => {
        toggleMode();
        playClick();
      }}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-fairway-800/70 bg-fairway-950/80 text-base text-fairway-100/80 backdrop-blur active:bg-fairway-800"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={!dark}
      title={dark ? 'Dark mode' : 'Light mode'}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
