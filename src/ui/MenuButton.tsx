import { openNav } from '../lib/navDrawer';
import { playClick } from '../lib/sound';

// Hamburger that opens the global navigation drawer. Rides in HeaderControls, so
// it appears on every screen's header (and Home's top-right cluster) — the one
// always-present entry point to the top-level sections. Mirrors the round pill
// styling of ThemeToggle/SoundToggle so the header cluster reads as one control
// group.
export default function MenuButton() {
  return (
    <button
      onClick={() => {
        openNav();
        playClick();
      }}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-fairway-800/70 bg-fairway-950/80 text-base text-fairway-100/80 backdrop-blur active:bg-fairway-800"
      aria-label="Open menu"
      aria-haspopup="menu"
      title="Menu"
    >
      <span aria-hidden="true" className="text-lg leading-none">
        ☰
      </span>
    </button>
  );
}
