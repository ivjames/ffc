// Offline validation for the authored courses. Not shipped — run with node.
// The actual checks live in the shared contract (src/features/putt/validate.ts),
// so the CLI and the runtime generator agree on what "valid" means. This file
// just runs that contract over every authored course and prints the result.
import { COURSES } from '../src/features/putt/courses.ts';
import { validateHole } from '../src/features/putt/validate.ts';

let failures = 0;

for (const course of COURSES) {
  console.log(`\n=== ${course.label} (${course.key}) ===`);
  for (let i = 0; i < course.holes.length; i++) {
    const h = course.holes[i];
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
}

console.log(failures === 0 ? '\nALL HOLES VALID ✓' : `\n${failures} PROBLEM(S) ✗`);
if (failures > 0) process.exit(1);
