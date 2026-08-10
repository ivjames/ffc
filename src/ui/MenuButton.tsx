import { openNav } from '../lib/navDrawer';
import { playClick } from '../lib/sound';

// Hamburger that opens the global navigation drawer. Rides in HeaderControls, so
// it appears on every screen's header (and Home's top-right cluster) — the one
// always-present entry point to the top-level sections. Uses the site's chunky
// `.key` material (the same skinnable relief as the TopBar back button), so the
// two header affordances read as a matched pair rather than a floating pill.
export default function MenuButton() {
  return (
    <button
      onClick={() => {
        openNav();
        playClick();
      }}
      className="key flex h-10 w-10 items-center justify-center rounded-xl text-fairway-100"
      aria-label="Open menu"
      aria-haspopup="menu"
      title="Menu"
    >
      <span aria-hidden="true" className="text-xl leading-none">
        ☰
      </span>
    </button>
  );
}
