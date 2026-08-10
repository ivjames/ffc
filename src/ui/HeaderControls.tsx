import SoundToggle from './SoundToggle';
import ThemeToggle from './ThemeToggle';
import MenuButton from './MenuButton';

// The always-available header cluster for a screen's top-right: the menu
// (drawer) button plus the light/dark and mute switches. These used to float in
// a fixed bottom-left cluster; they now ride in the header (TopBar's right edge,
// or Home's top-right) so they sit with the rest of each screen's chrome instead
// of hovering over the playfield. The menu button is the one global entry point
// to the top-level sections, so it lives here to appear on every screen.
export default function HeaderControls() {
  return (
    <div className="flex items-center gap-1.5">
      <ThemeToggle />
      <SoundToggle />
      <MenuButton />
    </div>
  );
}
