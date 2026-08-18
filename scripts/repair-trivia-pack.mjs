#!/usr/bin/env node
// Apply scripts/lib/trivia-pack-repairs.ndjson to the committed pack in place.
//
//   node scripts/repair-trivia-pack.mjs [--dry-run]
//
// This is the no-upstream-checkout path: it rewrites
// server/seed/open-trivia-pack.ndjson.gz with the judgment repairs applied,
// producing the same bytes a full `build-trivia-pack.mjs` run would (the
// build applies the same entries, at the same point, via the same function).
// Entries key rows by their unrepaired prompt, so running this twice is a
// no-op — the second pass matches nothing.
import { createReadStream, createWriteStream } from "node:fs";
import { createGunzip, createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { applyPackRepairs, loadPackRepairs } from "./lib/trivia-pack.mjs";
import { PACK_PATH } from "./build-trivia-pack.mjs";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const entries = loadPackRepairs();
  if (!entries.length) {
    console.log("[repair-trivia-pack] no repairs file — nothing to do");
    return;
  }

  const lines = createInterface({ input: createReadStream(PACK_PATH).pipe(createGunzip()) });
  let header = null;
  const rows = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (header === null) header = JSON.parse(line);
    else rows.push(JSON.parse(line));
  }

  const { applied, skipped } = applyPackRepairs(rows, entries);
  const byReason = new Map();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);

  console.log(`[repair-trivia-pack] ${entries.length} entries: ${applied} applied, ${skipped.length} skipped`);
  for (const [reason, n] of byReason) {
    console.log(`[repair-trivia-pack]   skipped ${String(n).padStart(5)}  ${reason}`);
  }
  // Anything but no-such-prompt (the already-applied case) deserves eyes.
  for (const s of skipped.filter((s) => s.reason !== "no-such-prompt").slice(0, 20)) {
    console.log(`[repair-trivia-pack]   ${s.reason}: ${JSON.stringify(s.entry)}`);
  }

  if (dryRun) {
    console.log("[repair-trivia-pack] dry run — pack not written");
    return;
  }
  if (!applied) {
    console.log("[repair-trivia-pack] nothing applied — pack left untouched");
    return;
  }

  const out = [header, ...rows].map((o) => `${JSON.stringify(o)}\n`);
  await pipeline(Readable.from(out), createGzip({ level: 9 }), createWriteStream(PACK_PATH));
  console.log(`[repair-trivia-pack] wrote ${PACK_PATH}`);
  console.log("[repair-trivia-pack] no model or API calls — applying committed repairs costs nothing but CPU");
}

main().catch((err) => {
  console.error("[repair-trivia-pack] failed:", err);
  process.exit(1);
});
