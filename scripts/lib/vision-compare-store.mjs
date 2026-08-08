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
import { randomUUID } from "node:crypto";

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
    mediaType,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(IMAGES, entry.id), Buffer.from(base64, "base64"));
  writeDataset([...readDataset(), entry]);
  return entry;
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
        huntN: 0, jsonOk: 0, presentN: 0, confSum: 0, confN: 0,
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
      };
    }),
  };
}
