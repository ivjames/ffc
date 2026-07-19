import BumperArena, { type BumperTheme } from './BumperArena';

// §12 Bumper Cars — grippy rink handling on the shared bumper arena.
const CARS: BumperTheme = {
  title: 'Bumper Cars',
  emoji: '🚗',
  kind: 'car',
  playerColor: '#22c55e',
  aiColors: ['#f97316', '#eab308', '#a855f7', '#38bdf8'],
  hint: 'Touch and drag to steer your green car — ram the others to score bumps.',
  remark: (s) =>
    s >= 20 ? 'Demolition champ! 🏆' : s >= 12 ? 'Bumper pro! 🚗' : s >= 6 ? 'Nice driving! 👍' : 'Keep bumping! 🎮',
  friction: 0.975,
  accel: 0.11,
  maxSpeed: 3.9,
  aiAccel: 0.085,
  aiMax: 3.15,
  bumpSpeed: 1.7,
};

export default function BumperCars() {
  return <BumperArena theme={CARS} />;
}
