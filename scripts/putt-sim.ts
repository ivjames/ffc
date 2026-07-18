// Offline validation for the authored course. Not shipped — run with node.
// The actual checks live in the shared contract (src/features/putt/validate.ts),
// so the CLI and the runtime generator agree on what "valid" means. This file
// just runs that contract over the authored HOLES and prints the result.
import { HOLES } from '../src/features/putt/world.ts';
import { validateHole } from '../src/features/putt/validate.ts';

let failures = 0;

for (let i = 0; i < HOLES.length; i++) {
  const h = HOLES[i];
  console.log(`Hole ${i + 1} (par ${h.par})`);
  const { ok, errors, stats } = validateHole(h);
  for (const e of errors) console.log('  ✗ ' + e);
  if (!ok) {
    failures++;
    continue;
  }
  const waterNote = h.water ? ` · ${stats.splashes} splashes` : '';
  console.log(
    `  ✓ path ok · ${stats.oneShotSinks} one-shot sinks · best approach ${stats.bestApproach.toFixed(0)}px${waterNote}`,
  );
}

console.log(failures === 0 ? '\nALL HOLES VALID ✓' : `\n${failures} PROBLEM(S) ✗`);
if (failures > 0) process.exit(1);
