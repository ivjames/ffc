// Bumper Cars — the grippy rink theme over the shared bumper policy.
// AI hues mirror CARS.aiColors in src/features/fun/BumperCars.tsx.
import { makeBumper } from './bumper.mjs';

export default makeBumper({
  key: 'bumpercars',
  route: '/arcade/bumper',
  label: 'Bumper Cars',
  aiColors: ['#f97316', '#eab308', '#a855f7', '#38bdf8'],
});
