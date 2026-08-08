// Disk store for the vision bake-off: the test dataset (images + subjects)
// and the full run history persist across page loads and API restarts, so
// many test rounds accumulate into comparable stats until the operator
// explicitly clears them.
//
// Layout under BAKEOFF_DATA_DIR (default <cwd>/bakeoff-data — for the admin
// mount that's server/bakeoff-data on the droplet; gitignored):
//   dataset.json    [{id, name, subject, mediaType, createdAt}]
//   images/<id>     raw image bytes
//   runs.jsonl      one JSON line per model call (verdict text included —
//                   "keep everything"); cleared separately from the dataset
import {
  mkdirSync, readFileSync, writeFileSync, appendFileSync,
  readdirSync, rmSync, existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

const DIR = process.env.BAKEOFF_DATA_DIR || join(process.cwd(), "bakeoff-data");
const IMAGES = join(DIR, "images");
const DATASET = join(DIR, "dataset.json");
const RUNS = join(DIR, "runs.jsonl");

function ensureDirs() {
  mkdirSync(IMAGES, { recursive: true });
}

function readDataset() {
  try {
    return JSON.parse(readFileSync(DATASET, "utf8"));
  } catch {
    return [];
  }
}

function writeDataset(rows) {
  ensureDirs();
  writeFileSync(DATASET, JSON.stringify(rows, null, 1));
}

export function listDataset() {
  return readDataset();
}

export function addDatasetImage({ name, subject, mediaType, base64 }) {
  ensureDirs();
  const entry = {
    id: randomUUID(),
    name: String(name || "image"),
    subject: String(subject || ""),
    // Ground truth: `truth` is what the image actually shows; `expected` is
    // whether the current subject matches it (false after scrambling).
    truth: String(subject || ""),
    expected: true,
    mediaType,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(IMAGES, entry.id), Buffer.from(base64, "base64"));
  writeDataset([...readDataset(), entry]);
  return entry;
}

/**
 * Reset every subject to its truth, then give a random half of the images a
 * DIFFERENT image's subject (expected=false). Re-running re-randomizes from
 * scratch, so repeated scrambles never compound.
 */
export function scrambleDataset() {
  const rows = readDataset();
  rows.forEach((r) => {
    if (!r.truth) r.truth = r.subject; // entries predating ground truth
    r.subject = r.truth;
    r.expected = true;
  });
  const eligible = rows.filter((r) => r.truth);
  const k = Math.floor(eligible.length / 2);
  if (k >= 2) {
    const picked = eligible
      .map((r) => ({ r, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, k)
      .map((x) => x.r);
    // Rotate the picked subjects by one — nobody keeps their own (unless two
    // truths are identical text, which the neq check below patches).
    const subjects = picked.map((r) => r.truth);
    picked.forEach((r, i) => {
      r.subject = subjects[(i + 1) % subjects.length];
      r.expected = false;
    });
    // A rotation can hand an image an identical-text subject if two truths
    // match; those entries stay honest (expected=true).
    picked.forEach((r) => {
      if (r.subject === r.truth) r.expected = true;
    });
  }
  writeDataset(rows);
  const mismatched = rows.filter((r) => r.expected === false).length;
  return { total: rows.length, mismatched };
}

export function getDatasetImage(id) {
  const entry = readDataset().find((e) => e.id === id);
  if (!entry) return null;
  try {
    return { entry, bytes: readFileSync(join(IMAGES, id)) };
  } catch {
    return null;
  }
}

export function updateSubject(id, subject) {
  const rows = readDataset();
  const entry = rows.find((e) => e.id === id);
  if (!entry) return null;
  entry.subject = String(subject || "");
  writeDataset(rows);
  return entry;
}

export function removeDatasetImage(id) {
  const rows = readDataset();
  if (!rows.some((e) => e.id === id)) return false;
  rmSync(join(IMAGES, id), { force: true });
  writeDataset(rows.filter((e) => e.id !== id));
  return true;
}

export function clearDataset() {
  if (existsSync(IMAGES)) {
    for (const f of readdirSync(IMAGES)) rmSync(join(IMAGES, f), { force: true });
  }
  writeDataset([]);
}

// --- Pre-scan cache ---------------------------------------------------------
// Subject labels keyed by image content hash, so re-adding an image that was
// ever scanned before costs nothing. Deliberately survives dataset/run
// clears — it's a cost cache, not test state.
const PRESCAN_CACHE = join(DIR, "prescan-cache.json");

function imageHash(base64) {
  return createHash("sha256").update(base64).digest("hex");
}

function readPrescanCache() {
  try {
    return JSON.parse(readFileSync(PRESCAN_CACHE, "utf8"));
  } catch {
    return {};
  }
}

export function prescanCacheGet(base64) {
  return readPrescanCache()[imageHash(base64)] || null;
}

export function prescanCachePut(base64, subject) {
  ensureDirs();
  const cache = readPrescanCache();
  cache[imageHash(base64)] = { subject, cachedAt: new Date().toISOString() };
  writeFileSync(PRESCAN_CACHE, JSON.stringify(cache, null, 1));
}

export function appendRun(row) {
  ensureDirs();
  appendFileSync(RUNS, JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");
}

export function clearRuns() {
  rmSync(RUNS, { force: true });
}

/** All-time aggregates since the last clear: totals + per-provider stats. */
export function runsSummary() {
  let lines = [];
  try {
    lines = readFileSync(RUNS, "utf8").split("\n").filter(Boolean);
  } catch {
    /* no runs yet */
  }
  const totals = { calls: 0, inTok: 0, outTok: 0, cost: 0 };
  const perProvider = {};
  for (const line of lines) {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const p = perProvider[r.provider] ||
      (perProvider[r.provider] = {
        calls: 0, errors: 0, inTok: 0, outTok: 0, cost: 0, lat: [],
        huntN: 0, jsonOk: 0, presentN: 0, confSum: 0, confN: 0, outliers: 0,
        accN: 0, accOk: 0, expFalseN: 0, falseCredit: 0, expTrueN: 0, falseReject: 0,
      });
    totals.calls += 1;
    p.calls += 1;
    if (r.error) {
      p.errors += 1;
      continue;
    }
    totals.inTok += r.inputTokens || 0;
    totals.outTok += r.outputTokens || 0;
    totals.cost += r.cost || 0;
    p.inTok += r.inputTokens || 0;
    p.outTok += r.outputTokens || 0;
    p.cost += r.cost || 0;
    if (r.ms) p.lat.push(r.ms);
    // Hunt rows carry the model's raw reply — parse the verdict here so the
    // page can chart JSON-validity, present-rate, and confidence.
    if (r.kind === "hunt" && typeof r.text === "string") {
      p.huntN += 1;
      if (r.outlier) p.outliers += 1;
      const m = r.text.match(/\{[\s\S]*\}/);
      let v = null;
      if (m) {
        try {
          v = JSON.parse(m[0]);
        } catch {
          /* malformed → counts against jsonOk */
        }
      }
      if (v && typeof v.present === "boolean") {
        p.jsonOk += 1;
        if (v.present) p.presentN += 1;
        if (typeof v.confidence === "number") {
          p.confSum += Math.max(0, Math.min(1, v.confidence));
          p.confN += 1;
        }
        // Ground-truth grading (rows from scrambled/sourced datasets).
        if (typeof r.expected === "boolean") {
          p.accN += 1;
          if (v.present === r.expected) p.accOk += 1;
          if (r.expected) {
            p.expTrueN += 1;
            if (!v.present) p.falseReject += 1;
          } else {
            p.expFalseN += 1;
            if (v.present) p.falseCredit += 1;
          }
        }
      } else {
        // Unparseable verdict = failed call for this workload; its tokens
        // were still billed and stay in the totals above.
        p.errors += 1;
      }
    }
  }
  return {
    totals,
    providers: Object.entries(perProvider).map(([name, p]) => {
      const ok = p.calls - p.errors;
      return {
        name,
        calls: p.calls,
        errors: p.errors,
        inTok: p.inTok,
        outTok: p.outTok,
        cost: p.cost,
        avgInTok: ok ? Math.round(p.inTok / ok) : 0,
        latMin: p.lat.length ? Math.min(...p.lat) : null,
        latAvg: p.lat.length
          ? Math.round(p.lat.reduce((a, b) => a + b) / p.lat.length)
          : null,
        latMax: p.lat.length ? Math.max(...p.lat) : null,
        huntN: p.huntN,
        jsonOk: p.jsonOk,
        presentN: p.presentN,
        confAvg: p.confN ? p.confSum / p.confN : null,
        outliers: p.outliers,
        accN: p.accN,
        accOk: p.accOk,
        expFalseN: p.expFalseN,
        falseCredit: p.falseCredit,
        expTrueN: p.expTrueN,
        falseReject: p.falseReject,
      };
    }),
  };
}
