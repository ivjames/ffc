// Amazon Polly voice bake-off for live trivia — pick the room's voice by ear.
//
//   cd /var/www/ffc/server && npm run tts:bakeoff -- --location upland --yes
//
// Synthesizes REAL questions from ONE venue's bank (not lorem ipsum) through
// several Polly neural voices and speaking styles, writes the mp3s and a page
// that plays them side by side, and reports exactly what AWS billed.
//
// Run it on the droplet: the AWS key belongs in server/.env next to the
// others, and the audition should happen on the machine that will do the real
// synthesis. Open the page on the tablet you'll host from — a voice that is
// clear on a laptop can disappear over a venue PA, which is the entire thing
// being judged here.
//
// WHY THESE VARIANTS
//   plain      — the neural voice as-is, the baseline.
//   newscaster — <amazon:domain name="news">, an announcer register. Only a
//                few en-US voices support it (Joanna, Matthew), and it is the
//                closest thing Polly has to "reads to a room for a living".
//   +drc       — <amazon:effect name="drc">, dynamic range compression. It
//                lifts the quiet parts so consonants survive a noisy bar.
//                Fully supported on neural, and there is no equivalent in the
//                browser voice the app falls back to.
//
// NOT A VARIANT, ON PURPOSE: <say-as interpret-as="characters"> for the join
// code. AWS silently synthesizes that sentence with the STANDARD voice and
// still bills it as neural, so the code — the one line the room must get right
// — would arrive in a worse voice than the rest of the game. lobbyScript
// spells it with commas instead, and this bake-off reads that, so you hear
// what players will actually hear.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

// This imports the app's TypeScript script builders rather than keeping a
// second copy of the words, which needs `--experimental-strip-types` and so
// Node 22. The flag CANNOT live in the npm script: node rejects an unknown
// flag while parsing its own argv, before this file runs, so a version check
// inside the script would never get to print anything on Node 18 or 20 — the
// operator would just see a flag-parse error. So the entry point takes no
// flag, checks the version itself, and re-execs with it.
const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(
    `\nThis script needs Node 22+ (found ${process.versions.node}).\n` +
      `It imports the app's TypeScript script builders via --experimental-strip-types,\n` +
      `so the words the room hears have exactly one definition.\n` +
      `The API itself still runs fine on ${process.versions.node}; only this script needs 22.\n`
  );
  process.exit(1);
}
if (!process.execArgv.includes("--experimental-strip-types")) {
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit" }
  );
  process.exit(run.status ?? 1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// $ per 1M characters, Polly neural. Re-verify at build time — cheap TTS tiers
// churn (see the house note in CLAUDE.md and TTS-PRICING.md).
const NEURAL_USD_PER_M = 16;

// Voices to audition. `newscaster` marks the ones AWS documents as supporting
// the news speaking style on the neural engine; asking for it on any other
// voice is an API error, not a silent downgrade.
const VOICES = [
  { id: "Joanna", newscaster: true },
  { id: "Matthew", newscaster: true },
];

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);

// --- config ----------------------------------------------------------------
// server/.env is the only place the AWS key should live: on the droplet, in a
// file the app already reads, never in a cloud environment variable or a chat.
function loadEnv() {
  try {
    const text = readFileSync(join(ROOT, "server", ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["'](.*)["']$/, "$1");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch {
    // No .env — fall back to whatever is already exported.
  }
}

// --- the lines to read ------------------------------------------------------

/** Questions from ONE venue's bank, spread across the length range: the
 *  shortest, the longest, and evenly spaced in between. A voice that handles a
 *  one-line question can still fall apart on a long one, so auditioning three
 *  of the same size tells you the least.
 *
 *  Scoped exactly as dealSession scopes it (lib/triviaDeal.js): the platform
 *  pack plus this org's own questions plus anything written for this venue.
 *  This box is multi-tenant — an unscoped "select every active question" would
 *  happily pick another client's material, send it to Polly, and write it into
 *  a page that then sits on disk. A venue has to be named. */
async function loadQuestions(count) {
  if (!process.env.DATABASE_URL) {
    console.warn("  ! no DATABASE_URL — using built-in sample questions");
    return SAMPLES.slice(0, count);
  }
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const wanted = flag("location");
    const venues = await pool.query(
      `select l.id, l.org_id, l.name, l.slug, o.name as org_name
         from location l left join org o on o.id = l.org_id
        where l.archived_at is null
        order by o.name nulls first, l.sort_order, l.name`
    );
    const loc = wanted
      ? venues.rows.find((v) => v.id === wanted || v.slug === wanted)
      : null;
    if (!loc) {
      console.error(
        wanted ? `\nNo live venue matches "${wanted}".\n` : `\n--location is required: the bank is per venue.\n`
      );
      console.error("Available venues:");
      for (const v of venues.rows) {
        console.error(`  ${v.slug.padEnd(20)} ${v.name}${v.org_name ? ` (${v.org_name})` : ""}`);
      }
      console.error(`\n  npm run tts:bakeoff -- --location <slug>\n`);
      process.exit(1);
    }
    const res = await pool.query(
      `select category, prompt, choices, answer from trivia_question
        where archived_at is null and active
          and (org_id is null or org_id = $1)
          and (location_id is null or location_id = $2)
        order by length(prompt)`,
      [loc.org_id ?? null, loc.id]
    );
    if (res.rowCount === 0) {
      console.warn("  ! the bank is empty — using built-in sample questions");
      return SAMPLES.slice(0, count);
    }
    const rows = res.rows;
    const picked = [];
    for (let i = 0; i < Math.min(count, rows.length); i++) {
      // Evenly spaced across the sorted range, so the set always includes the
      // shortest and the longest question in the bank.
      const at = Math.round((i * (rows.length - 1)) / Math.max(1, Math.min(count, rows.length) - 1));
      picked.push(rows[at]);
    }
    picked.venue = `${loc.name}${loc.org_name ? ` (${loc.org_name})` : ""}`;
    return picked;
  } finally {
    await pool.end();
  }
}

const SAMPLES = [
  {
    category: "House Pack",
    prompt: "How many pins are set up at the end of a bowling lane?",
    choices: ["9", "10", "12", "15"],
    answer: 1,
  },
  {
    category: "House Pack",
    prompt: "In golf, what do you call a score of one stroke under par on a hole?",
    choices: ["Birdie", "Eagle", "Bogey", "Ace"],
    answer: 0,
  },
  {
    category: "House Pack",
    prompt:
      "Which planet in our solar system has the most moons orbiting it, according to the count recognised by astronomers today?",
    choices: ["Jupiter", "Saturn", "Neptune", "Uranus"],
    answer: 1,
  },
];

/** Every line the bake-off reads, in the order a game says them. */
function linesFor(questions, { lobbyScript, questionScript, revealScript }) {
  const lines = [{ label: "Join code (lobby)", text: lobbyScript("B8S5Z2").join(" ") }];
  for (const [i, q] of questions.entries()) {
    const view = {
      index: i,
      category: q.category,
      prompt: q.prompt,
      choices: Array.isArray(q.choices) ? q.choices : JSON.parse(q.choices),
      answer: q.answer,
    };
    lines.push({ label: `Q${i + 1} — question (${view.prompt.length} chars)`, text: questionScript(view).join(" ") });
    lines.push({ label: `Q${i + 1} — reveal`, text: revealScript(view).join(" ") });
  }
  return lines;
}

// --- SSML -------------------------------------------------------------------

/** Wrap plain text for one style. SSML tags are NOT billed, so the markup is
 *  free — only the words below count against the bill. */
export function ssmlFor(text, style) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  let inner = escaped;
  if (style.drc) inner = `<amazon:effect name="drc">${inner}</amazon:effect>`;
  if (style.newscaster) inner = `<amazon:domain name="news">${inner}</amazon:domain>`;
  return `<speak>${inner}</speak>`;
}

const STYLES = [
  { key: "plain", label: "plain", newscaster: false, drc: false },
  { key: "news", label: "newscaster", newscaster: true, drc: false },
  { key: "news-drc", label: "newscaster + DRC", newscaster: true, drc: true },
];

// --- synthesis --------------------------------------------------------------

/** Neural is 8 tps with a burst of 10, so a handful at a time with backoff
 *  keeps a whole bake-off inside one polite burst instead of collecting
 *  ThrottlingExceptions. */
const CONCURRENCY = 4;

async function synthesize(polly, clip, outDir) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await polly.send(
        new SynthesizeSpeechCommand({
          Engine: "neural",
          VoiceId: clip.voice,
          OutputFormat: "mp3",
          TextType: "ssml",
          Text: clip.ssml,
        })
      );
      const audio = Buffer.from(await res.AudioStream.transformToByteArray());
      writeFileSync(join(outDir, clip.file), audio);
      return {
        ...clip,
        bytes: audio.length,
        // The API's own count of what it billed — not our estimate.
        billed: res.RequestCharacters ?? clip.chars,
      };
    } catch (err) {
      const retryable = err.name === "ThrottlingException" || err.$metadata?.httpStatusCode >= 500;
      if (!retryable || attempt === 4) {
        console.error(`  ! ${clip.file}: ${err.name} — ${err.message}`);
        return { ...clip, error: `${err.name}: ${err.message}` };
      }
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
}

async function runPool(items, worker) {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i]);
      }
    })
  );
  return out;
}

// --- the page ---------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderPage(lines, results, totals, stamp) {
  const byLine = new Map();
  for (const r of results) {
    if (!byLine.has(r.lineLabel)) byLine.set(r.lineLabel, []);
    byLine.get(r.lineLabel).push(r);
  }
  const rows = [...byLine.entries()]
    .map(
      ([label, clips]) => `
    <section>
      <h2>${esc(label)}</h2>
      <p class="said">${esc(clips[0].text)}</p>
      <table>
        <tr><th>voice</th><th>style</th><th>listen</th><th>billed chars</th><th>cost</th></tr>
        ${clips
          .map(
            (c) => `<tr>
          <td>${esc(c.voice)}</td>
          <td>${esc(c.styleLabel)}</td>
          <td>${
            c.error
              ? `<span class="err">${esc(c.error)}</span>`
              : `<audio controls preload="none" src="${esc(c.file)}"></audio>`
          }</td>
          <td class="num">${c.billed ?? "—"}</td>
          <td class="num">$${(((c.billed ?? 0) / 1e6) * NEURAL_USD_PER_M).toFixed(5)}</td>
        </tr>`
          )
          .join("")}
      </table>
    </section>`
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Polly voice bake-off — live trivia</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0 auto; padding: 24px; max-width: 900px; background: #0c1116; color: #e6edf3;
         font: 16px/1.5 system-ui, sans-serif; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .burn { margin: 16px 0 28px; padding: 12px 16px; border: 1px solid #2b3947; border-radius: 12px;
          background: #111a22; }
  .burn strong { font-size: 1.25rem; }
  section { margin-bottom: 28px; }
  h2 { font-size: 1rem; color: #9fb3c8; margin: 0 0 4px; }
  .said { margin: 0 0 10px; padding: 8px 12px; border-left: 3px solid #2b3947; color: #b9c7d4;
          font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #1d2833; font-size: 0.9rem; }
  th { color: #7d8fa1; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .err { color: #ff8080; }
  audio { width: 100%; max-width: 320px; height: 32px; }
  footer { color: #7d8fa1; font-size: 0.85rem; border-top: 1px solid #1d2833; padding-top: 12px; }
</style></head><body>
<h1>Polly voice bake-off — live trivia</h1>
<p class="said">Generated ${esc(stamp)}. Play these on the tablet you host from, through whatever
speaker the room hears — a voice that reads well on a laptop can vanish over a PA.</p>
<div class="burn">
  <div>Billed this run: <strong>${totals.billed.toLocaleString()} characters</strong> —
  <strong>$${totals.usd.toFixed(4)}</strong> at $${NEURAL_USD_PER_M}/M (Polly neural)</div>
  <div style="color:#9fb3c8;font-size:0.9rem;margin-top:4px">
    ${totals.clips} clips${totals.errors ? `, ${totals.errors} failed` : ""}.
    A whole ${totals.perBank.questions}-question bank at this rate would cost about
    $${totals.perBank.usd.toFixed(2)} to synthesize once, then nothing to replay.
  </div>
</div>
${rows}
<footer>Newscaster style is <code>&lt;amazon:domain name="news"&gt;</code>; DRC is
<code>&lt;amazon:effect name="drc"&gt;</code>. Neither is billed — SSML tags are free, only the words
count. The join code is spelled with commas rather than <code>say-as interpret-as="characters"</code>,
which AWS synthesizes with the standard voice while still billing neural.</footer>
</body></html>`;
}

// --- main -------------------------------------------------------------------

async function main() {
  loadEnv();
  // Dynamic, so the re-exec guard above runs first — a static import of a .ts
  // file is hoisted and would fail to parse on the first pass.
  const { lobbyScript, questionScript, revealScript } = await import(
    "../../src/lib/speechScript.ts"
  );
  const count = Number(flag("questions", "3"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = flag("out", join(ROOT, "data", "tts-bakeoff", stamp));

  const questions = await loadQuestions(count);
  const lines = linesFor(questions, { lobbyScript, questionScript, revealScript });

  // Every clip we intend to make, priced BEFORE anything is spent.
  const clips = [];
  for (const line of lines) {
    for (const voice of VOICES) {
      for (const style of STYLES) {
        if (style.newscaster && !voice.newscaster) continue;
        clips.push({
          lineLabel: line.label,
          text: line.text,
          voice: voice.id,
          styleLabel: style.label,
          chars: line.text.length,
          ssml: ssmlFor(line.text, style),
          file: `${voice.id}-${style.key}-${line.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp3`,
        });
      }
    }
  }
  const estChars = clips.reduce((n, c) => n + c.chars, 0);
  const estUsd = (estChars / 1e6) * NEURAL_USD_PER_M;

  console.log(`\nPolly bake-off — pre-flight`);
  console.log(`  venue       ${questions.venue ?? "built-in samples (no DATABASE_URL)"}`);
  console.log(`  questions   ${questions.length}, spread shortest to longest`);
  console.log(`  voices      ${VOICES.map((v) => v.id).join(", ")}`);
  console.log(`  styles      ${STYLES.map((s) => s.label).join(", ")}`);
  console.log(`  clips       ${clips.length}`);
  console.log(`  billable    ${estChars.toLocaleString()} characters`);
  console.log(`  estimate    $${estUsd.toFixed(4)} at $${NEURAL_USD_PER_M}/M neural`);
  console.log(`  output      ${outDir}`);

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

  mkdirSync(outDir, { recursive: true });
  const polly = new PollyClient({ region: process.env.AWS_REGION || "us-east-1" });
  console.log(`\nSynthesizing ${clips.length} clips…`);
  const results = await runPool(clips, (c) => synthesize(polly, c, outDir));

  const billed = results.reduce((n, r) => n + (r.billed ?? 0), 0);
  const errors = results.filter((r) => r.error).length;
  // Per-question cost of a full read (question + reveal), so the bank figure
  // reflects this bank rather than a generic guess.
  const perQuestion =
    lines.filter((l) => /question|reveal/.test(l.label)).reduce((n, l) => n + l.text.length, 0) /
    Math.max(1, questions.length);
  const totals = {
    billed,
    usd: (billed / 1e6) * NEURAL_USD_PER_M,
    clips: results.length,
    errors,
    perBank: { questions: 5000, usd: ((perQuestion * 5000) / 1e6) * NEURAL_USD_PER_M },
  };

  writeFileSync(join(outDir, "index.html"), renderPage(lines, results, totals, stamp));

  console.log(`\nDone.`);
  console.log(`  billed      ${billed.toLocaleString()} characters (AWS RequestCharacters)`);
  console.log(`  cost        $${totals.usd.toFixed(4)}`);
  if (errors) console.log(`  failed      ${errors} clip(s) — see the page`);
  console.log(`  per question ${Math.round(perQuestion)} chars ≈ $${((perQuestion / 1e6) * NEURAL_USD_PER_M).toFixed(5)} to voice once`);
  console.log(`  a 5,000-question bank ≈ $${totals.perBank.usd.toFixed(2)} once, then free to replay`);
  console.log(`\n  open ${join(outDir, "index.html")}\n`);
}

// Only when invoked directly, so ssmlFor/renderPage can be imported without
// the script running itself (same guard as scripts/export-content.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
