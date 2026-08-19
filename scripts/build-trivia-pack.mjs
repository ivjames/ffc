#!/usr/bin/env node
// Build the committed OpenTriviaQA pack from a checkout of the upstream corpus.
//
//   git clone --depth 1 https://github.com/uberspot/OpenTriviaQA /tmp/otqa
//   node scripts/build-trivia-pack.mjs --src /tmp/otqa
//
// Writes server/seed/open-trivia-pack.ndjson.gz — the artifact the importer
// reads. The corpus itself is NOT vendored: it is 22 loosely-formatted text
// files that only ever get read through this script, and committing the built
// pack instead means a deploy never has to parse, repair or filter anything.
//
// The build is deterministic. Same upstream commit in, byte-identical pack
// out — no timestamps in the header, and the option shuffle is seeded on each
// prompt — so re-running this on an unchanged corpus produces an empty diff
// and a rebuild after an upstream change only churns the questions that moved.
import { createWriteStream } from "node:fs";
import { readdir, readFile, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_LABELS,
  REJECT_REASONS,
  MAX_CHOICE_CHARS,
  MAX_PROMPT_CHARS,
  applyPackAmpersands,
  applyPackRepairs,
  applyPackTypos,
  decodeMixedUtf8,
  dropOversized,
  loadPackAmpersands,
  loadPackRepairs,
  loadPackTypos,
  parseCategoryFile,
  toPackRow,
} from "./lib/trivia-pack.mjs";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PACK_PATH = join(ROOT, "server", "seed", "open-trivia-pack.ndjson.gz");

const UPSTREAM = "https://github.com/uberspot/OpenTriviaQA";
const LICENSE = "CC BY-SA 4.0";

function usage(message) {
  console.error(`${message}

Usage: node scripts/build-trivia-pack.mjs --src <path-to-OpenTriviaQA-checkout>

Get the corpus with:
  git clone --depth 1 ${UPSTREAM} /tmp/otqa`);
  process.exit(1);
}

/** The commit the pack was built from, so a rebuild is reproducible. */
async function upstreamCommit(src) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", src, "rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    // A tarball download has no git metadata. Not fatal — the pack is still
    // valid, it just cannot say which revision produced it.
    return null;
  }
}

async function main() {
  const srcFlag = process.argv.indexOf("--src");
  if (srcFlag === -1 || !process.argv[srcFlag + 1]) usage("Missing --src.");
  const src = process.argv[srcFlag + 1];
  const categoriesDir = join(src, "categories");
  try {
    if (!(await stat(categoriesDir)).isDirectory()) throw new Error("not a directory");
  } catch {
    usage(`No categories/ directory under ${src}.`);
  }

  const files = (await readdir(categoriesDir)).sort();
  const unknown = files.filter((f) => !(f in CATEGORY_LABELS));
  if (unknown.length) {
    // A new upstream category would otherwise be silently skipped, which is
    // exactly the kind of quiet data loss that goes unnoticed for a year.
    console.error(`[build-trivia-pack] unmapped upstream categories: ${unknown.join(", ")}`);
    console.error("[build-trivia-pack] add them to CATEGORY_LABELS in scripts/lib/trivia-pack.mjs");
    process.exit(1);
  }

  const seen = new Set();
  const rows = [];
  const rejects = Object.fromEntries(REJECT_REASONS.map((r) => [r, 0]));
  const perCategory = new Map();
  let repairedBytes = 0;
  let droppedBytes = 0;
  let read = 0;

  for (const file of files) {
    const category = CATEGORY_LABELS[file];
    const { text, repaired, dropped } = decodeMixedUtf8(await readFile(join(categoriesDir, file)));
    repairedBytes += repaired;
    droppedBytes += dropped;
    for (const raw of parseCategoryFile(text)) {
      read++;
      const result = toPackRow(raw, { category, seen });
      if (result.reject) {
        rejects[result.reject]++;
        continue;
      }
      rows.push(result.row);
      perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    }
  }

  // Sorted so the artifact does not depend on directory-read order, and so a
  // question moving between upstream files does not reshuffle the whole file.
  rows.sort((a, b) => (a.category === b.category ? cmp(a.prompt, b.prompt) : cmp(a.category, b.category)));

  // Judgment repairs go on last, after the sort and the shuffle, both of which
  // are seeded on the unrepaired prompt — so patching the committed pack in
  // place (scripts/repair-trivia-pack.mjs) and rebuilding from upstream land
  // on the identical artifact.
  const repairs = applyPackRepairs(rows, loadPackRepairs());
  const typos = applyPackTypos(rows, loadPackTypos());
  const ampersands = applyPackAmpersands(rows, loadPackAmpersands());
  const skippedByReason = new Map();
  for (const s of [...repairs.skipped, ...typos.skipped, ...ampersands.skipped]) {
    skippedByReason.set(s.reason, (skippedByReason.get(s.reason) ?? 0) + 1);
  }

  // Length is judged last, on the repaired text: restoring an apostrophe or an
  // ampersand makes a row longer, so measuring before the overlays would keep
  // rows that end up over the line.
  const sized = dropOversized(rows);
  rows.length = 0;
  rows.push(...sized.kept);
  // Recount after the drop, or the per-category tally below describes a pack
  // that was never written.
  perCategory.clear();
  for (const row of rows) perCategory.set(row.category, (perCategory.get(row.category) ?? 0) + 1);

  const header = {
    pack: "opentriviaqa",
    source: UPSTREAM,
    license: LICENSE,
    upstreamCommit: await upstreamCommit(src),
    count: rows.length,
  };

  await mkdir(dirname(PACK_PATH), { recursive: true });
  const lines = [header, ...rows].map((o) => `${JSON.stringify(o)}\n`);
  await pipeline(Readable.from(lines), createGzip({ level: 9 }), createWriteStream(PACK_PATH));

  const packed = (await stat(PACK_PATH)).size;
  console.log(`[build-trivia-pack] read ${read} source questions from ${files.length} files`);
  console.log(`[build-trivia-pack] encoding: ${repairedBytes} bytes repaired via CP1252, ${droppedBytes} dropped`);
  for (const reason of REJECT_REASONS) {
    console.log(`[build-trivia-pack]   dropped ${String(rejects[reason]).padStart(5)}  ${reason}`);
  }
  console.log(`[build-trivia-pack] apostrophe repairs: ${repairs.applied} applied, ${repairs.skipped.length} skipped`);
  console.log(`[build-trivia-pack] typo repairs: ${typos.applied} applied, ${typos.skipped.length} skipped`);
  console.log(`[build-trivia-pack] ampersands: ${ampersands.applied} applied, ${ampersands.skipped.length} skipped`);
  for (const [reason, n] of skippedByReason) {
    console.log(`[build-trivia-pack]   skipped ${String(n).padStart(5)}  ${reason}`);
  }
  console.log(
    `[build-trivia-pack] too long to deal: ${sized.dropped.length} dropped ` +
      `(${sized.longPrompt} prompt over ${MAX_PROMPT_CHARS}, ${sized.longChoice} option over ${MAX_CHOICE_CHARS})`
  );
  console.log(`[build-trivia-pack] kept ${rows.length} questions across ${perCategory.size} categories`);
  for (const [category, n] of [...perCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`[build-trivia-pack]   ${String(n).padStart(5)}  ${category}`);
  }
  console.log(`[build-trivia-pack] wrote ${PACK_PATH} (${(packed / 1e6).toFixed(2)} MB gzipped)`);
  console.log("[build-trivia-pack] no model or API calls — this build costs nothing but CPU");
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Only run when invoked directly; the test imports PACK_PATH from here.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[build-trivia-pack] failed:", err);
    process.exit(1);
  });
}
