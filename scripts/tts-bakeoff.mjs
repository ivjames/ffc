// Polly voice bake-off, from the command line.
//
//   cd /var/www/ffc/server && npm run tts:bakeoff -- --location upland
//   cd /var/www/ffc/server && npm run tts:bakeoff -- --location upland --yes
//
// A thin CLI over server/lib/ttsBakeoff.js, which Master Control's Voice bench
// screen (Ops → Voice bench, admin/VoiceBench.tsx) drives too — so the script
// and the screen audition identically. Prefer the screen: the clips have to be
// judged on the tablet you host from, and files on the droplet are not
// listenable. A run made here shows up there under "replay a past run".
//
// A bare run prices the batch and spends nothing. --yes synthesizes, and the
// report uses the API's own RequestCharacters rather than an estimate.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENGINES,
  STYLES,
  VOICES,
  bakeoffDir,
  estimate,
  linesFor,
  loadQuestions,
  loadVenues,
  planClips,
  synthesizeAll,
} from "../server/lib/ttsBakeoff.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);

// server/.env is the only place the AWS key should live: on the droplet, in a
// file the app already reads, never in a cloud environment variable or a chat.
function loadEnv() {
  try {
    for (const line of readFileSync(join(ROOT, "server", ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["'](.*)["']$/, "$1");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch {
    // No .env — fall back to whatever is already exported.
  }
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    console.error("\nNo DATABASE_URL (server/.env) — the bake-off reads a venue's real bank.\n");
    process.exitCode = 1;
    return;
  }
  // The server's own pool, imported dynamically so loadEnv() above has already
  // put DATABASE_URL in the environment db.js reads at module load — and so
  // `pg` resolves from server/node_modules rather than from scripts/.
  const { pool } = await import("../server/db.js");
  try {
    const venues = await loadVenues(pool);
    const wanted = flag("location");
    const venue = venues.find((v) => v.id === wanted || v.slug === wanted);
    if (!venue) {
      // The bank is per venue and this box is multi-tenant, so guessing at one
      // is not an option — name the choices instead.
      console.error(wanted ? `\nNo live venue matches "${wanted}".\n` : `\n--location is required.\n`);
      console.error("Available venues:");
      for (const v of venues) {
        console.error(`  ${String(v.slug).padEnd(22)} ${v.name}${v.orgName ? ` (${v.orgName})` : ""}`);
      }
      console.error(`\n  npm run tts:bakeoff -- --location <slug>\n`);
      process.exitCode = 1;
      return;
    }

    const count = Number(flag("questions", "3"));
    const bank = await loadQuestions(pool, { locationId: venue.id, orgId: venue.orgId, count });
    if (bank.length === 0) {
      console.error(`\nNo active questions in ${venue.name}'s bank.\n`);
      process.exitCode = 1;
      return;
    }
    const clips = planClips(linesFor(bank));
    const est = estimate(clips);

    console.log(`\nPolly bake-off — pre-flight`);
    console.log(`  venue       ${venue.name}${venue.orgName ? ` (${venue.orgName})` : ""}`);
    console.log(`  questions   ${bank.length}, spread shortest to longest`);
    console.log(`  voices      ${VOICES.map((v) => `${v.id} (${v.engines.join("+")})`).join(", ")}`);
    console.log(`  styles      ${STYLES.map((s) => s.label).join(", ")} — neural only`);
    console.log(`  clips       ${est.clips}`);
    console.log(`  billable    ${est.chars.toLocaleString()} characters`);
    // Per engine, because they are priced differently and a single blended
    // rate would misreport whichever way the mix leans.
    for (const [name, e] of Object.entries(est.byEngine)) {
      console.log(`    ${name.padEnd(11)}${e.clips} clips, ${e.chars.toLocaleString()} chars, $${e.usd.toFixed(4)} at $${ENGINES[name].usdPerM}/M`);
    }
    console.log(`  estimate    $${est.usd.toFixed(4)}`);

    if (!has("yes")) {
      console.log(`\nNothing spent. Re-run with --yes to synthesize.\n`);
      return;
    }
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error(`\nNo AWS credentials. Add to server/.env:`);
      console.error(`  AWS_ACCESS_KEY_ID=...\n  AWS_SECRET_ACCESS_KEY=...\n  AWS_REGION=us-east-1\n`);
      process.exitCode = 1;
      return;
    }

    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${venue.slug}`;
    console.log(`\nSynthesizing ${clips.length} clips…`);
    const run = await synthesizeAll(clips, {
      runId,
      meta: { venue: `${venue.name}${venue.orgName ? ` (${venue.orgName})` : ""}` },
    });

    console.log(`\nDone.`);
    console.log(`  billed      ${run.billed.toLocaleString()} characters (AWS RequestCharacters)`);
    console.log(`  cost        $${run.usd.toFixed(4)}`);
    if (run.errors) console.log(`  failed      ${run.errors} clip(s)`);
    console.log(`  files       ${join(bakeoffDir(), runId)}`);
    console.log(`\n  Listen in Master Control → Ops → Voice bench (/voice-bench),`);
    console.log(`  which lists this run under "replay a past run".\n`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
