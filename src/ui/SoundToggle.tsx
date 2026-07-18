import { useSyncExternalStore } from 'react';
import { isMuted, subscribeMuted, toggleMuted, playClick } from '../lib/sound';

// Small, always-available mute switch. Fixed to the bottom-left so it mirrors
// the build stamp in the opposite corner and never blocks the main controls.
export default function SoundToggle() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, isMuted);
  return (
    <button
      onClick={() => {
        // Toggling ON should give immediate audible confirmation.
        const wasMuted = isMuted();
        toggleMuted();
        if (wasMuted) playClick();
      }}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-fairway-800/70 bg-fairway-950/80 text-base text-fairway-100/80 backdrop-blur active:bg-fairway-800"
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      aria-pressed={muted}
      title={muted ? 'Sound off' : 'Sound on'}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
