import BumperArena, { type BumperTheme } from './BumperArena';

// §12 Bumper Boats — the shared bumper arena on water: floatier handling (less
// damping, gentler thrust) so the boats glide and drift more than the cars.
const BOATS: BumperTheme = {
  title: 'Bumper Boats',
  emoji: '🚤',
  kind: 'boat',
  playerColor: '#22c55e',
  aiColors: ['#f97316', '#facc15', '#e879f9', '#f43f5e'],
  hint: 'Touch and drag to steer your green boat — ram the others to score bumps.',
  remark: (s) =>
    s >= 20 ? 'Wave wrecker! 🏆' : s >= 12 ? 'Boat boss! 🚤' : s >= 6 ? 'Nice cruising! 👍' : 'Keep bumping! 🎮',
  // Floatier than the cars: less damping (more glide), a touch gentler thrust.
  friction: 0.984,
  accel: 0.14,
  maxSpeed: 5.1,
  aiAccel: 0.1,
  aiMax: 4.1,
};

export default function BumperBoats() {
  return <BumperArena theme={BOATS} />;
}
