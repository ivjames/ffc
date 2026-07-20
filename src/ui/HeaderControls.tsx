import SoundToggle from './SoundToggle';
import ThemeToggle from './ThemeToggle';

// The always-available light/dark and mute switches, grouped for a screen's
// top-right. These used to float in a fixed bottom-left cluster; they now ride
// in the header (TopBar's right edge, or Home's top-right) so they sit with the
// rest of each screen's chrome instead of hovering over the playfield.
export default function HeaderControls() {
  return (
    <div className="flex items-center gap-1.5">
      <ThemeToggle />
      <SoundToggle />
    </div>
  );
}
