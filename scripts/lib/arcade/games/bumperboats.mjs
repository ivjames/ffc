// Bumper Boats — the floatier water theme over the shared bumper policy. Same
// control, but less damping and a lower top speed, so the same lure logic just
// takes longer to close; the policy needs no per-theme tuning beyond the hues.
// AI hues mirror BOATS.aiColors in src/features/fun/BumperBoats.tsx.
import { makeBumper } from './bumper.mjs';

export default makeBumper({
  key: 'bumperboats',
  route: '/arcade/boats',
  label: 'Bumper Boats',
  aiColors: ['#f97316', '#facc15', '#e879f9', '#f43f5e'],
});
