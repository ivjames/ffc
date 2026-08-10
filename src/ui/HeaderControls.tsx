import MenuButton from './MenuButton';

// The global header affordance for a screen's top-right. The light/dark and mute
// switches used to live here; they now sit in the drawer's Settings block
// (src/ui/NavDrawer.tsx), leaving the header to the one control that belongs on
// every screen — the menu button, the way into the top-level sections.
export default function HeaderControls() {
  return (
    <div className="flex items-center">
      <MenuButton />
    </div>
  );
}
