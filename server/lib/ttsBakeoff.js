// Polly voice bake-off — the shared engine behind the CLI script and the
// Master Control screen.
//
// Provider-agnostic: lib/ttsProviders.js owns what each service can be asked
// for and how to call it, this owns picking the questions, pricing a run,
// storing it and replaying it. Adding a provider is one adapter, not a fork.
//
// Nothing here spends except synthesizeAll(). planClips() and estimate() price
// a run so a caller can show the bill before committing to it — the house rule
// for anything that makes a batch of API calls.
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS, providerByKey } from "./ttsProviders.js";
import { lobbyScript, questionScript, revealScript } from "./triviaSpeechScript.js";

/** Where runs are stored. Inside the release dir by default, so a deploy
 *  clears old auditions; point TTS_BAKEOFF_DIR at $APP_DIR/shared/... to keep
 *  them across deploys. */
export function bakeoffDir(env = process.env) {
  return env.TTS_BAKEOFF_DIR || join(process.cwd(), "data", "tts-bakeoff");
}

// --- what gets read ---------------------------------------------------------

/** Live venues, for the picker. */
export async function loadVenues(pool) {
  const res = await pool.query(
    `select l.id, l.name, l.slug, l.org_id as "orgId", o.name as "orgName"
       from location l left join org o on o.id = l.org_id
      where l.archived_at is null
      order by o.name nulls first, l.sort_order, l.name`
  );
  return res.rows;
}

/** Questions from ONE venue's bank, spread across the length range: the
 *  shortest, the longest, and evenly spaced between. A voice that handles a
 *  one-line question can still fall apart on a long one, so auditioning three
 *  of the same size tells you the least.
 *
 *  Scoped exactly as dealSession scopes it (lib/triviaDeal.js) — platform pack
 *  plus this org's questions plus anything written for this venue. This box is
 *  multi-tenant, and an unscoped read would pull another client's material
 *  into a page that then sits on disk. */
export async function loadQuestions(pool, { locationId, orgId, count = 3 }) {
  const res = await pool.query(
    `select category, prompt, choices, answer from trivia_question
      where archived_at is null and active
        and (org_id is null or org_id = $1)
        and (location_id is null or location_id = $2)
      order by length(prompt)`,
    [orgId ?? null, locationId]
  );
  const rows = res.rows;
  if (rows.length === 0) return [];
  const take = Math.min(count, rows.length);
  const picked = [];
  for (let i = 0; i < take; i++) {
    const at = Math.round((i * (rows.length - 1)) / Math.max(1, take - 1));
    picked.push(rows[at]);
  }
  return picked;
}

/** Every line the bake-off reads, in the order a game says them. */
export function linesFor(questions) {
  const lines = [{ label: "Join code (lobby)", text: lobbyScript("B8S5Z2").join(" ") }];
  for (const [i, q] of questions.entries()) {
    const view = {
      index: i,
      category: q.category,
      prompt: q.prompt,
      choices: Array.isArray(q.choices) ? q.choices : JSON.parse(q.choices),
      answer: q.answer,
    };
    lines.push({
      label: `Q${i + 1} — question (${view.prompt.length} chars)`,
      text: questionScript(view).join(" "),
    });
    lines.push({ label: `Q${i + 1} — reveal`, text: revealScript(view).join(" ") });
  }
  return lines;
}

// --- planning ---------------------------------------------------------------

/** Which providers can actually run, and why the others cannot — so the screen
 *  can say "no OPENAI_API_KEY" instead of silently showing two columns. */
export async function providerStatus(env = process.env) {
  const out = [];
  for (const p of PROVIDERS) {
    const configured = p.configured(env);
    let voices = [];
    let error = null;
    if (configured && p.discover) {
      try {
        voices = await p.discover(env);
      } catch (err) {
        error = err.message;
      }
    }
    out.push({ key: p.key, label: p.label, configured, why: p.why, voices, error });
  }
  return out;
}

/** Every clip a run would make, priced before anything is spent. */
export async function planClips(lines, env = process.env) {
  const status = await providerStatus(env);
  const clips = [];
  for (const line of lines) {
    for (const p of PROVIDERS) {
      const state = status.find((s) => s.key === p.key);
      if (!state?.configured || state.error) continue;
      for (const row of p.lineup(env, state.voices)) {
        clips.push({
          lineLabel: line.label,
          text: line.text,
          provider: p.key,
          providerLabel: p.label,
          voice: row.voice,
          voiceLabel: row.voiceLabel ?? row.voice,
          model: row.model,
          styleLabel: row.styleLabel,
          instructions: row.instructions,
          chars: line.text.length,
          usdPerM: row.usdPerM ?? p.usdPerM,
          estimated: Boolean(p.estimated),
          file: `${p.key}-${(row.voiceLabel ?? row.voice).slice(0, 12)}-${row.styleLabel.replace(/[^a-z0-9]+/gi, "-")}-${line.label.replace(/[^a-z0-9]+/gi, "-")}.mp3`.toLowerCase(),
        });
      }
    }
  }
  return { clips, status };
}

/** Priced per clip: the providers cost different amounts, and a blended
 *  "characters times one rate" would misreport whichever way the mix leans. */
export function estimate(clips) {
  const chars = clips.reduce((n, c) => n + c.chars, 0);
  const usd = clips.reduce((n, c) => n + (c.chars / 1e6) * c.usdPerM, 0);
  const byProvider = {};
  for (const c of clips) {
    const e = (byProvider[c.providerLabel] ??= { clips: 0, chars: 0, usd: 0, estimated: c.estimated });
    e.clips += 1;
    e.chars += c.chars;
    e.usd += (c.chars / 1e6) * c.usdPerM;
  }
  return { clips: clips.length, chars, usd, byProvider };
}

// --- synthesis (the only part that spends) ----------------------------------

/** Polly neural/generative is 8 tps; the others are happier but nothing here
 *  is in a hurry, so one modest cap keeps every provider inside a polite
 *  burst. */
const CONCURRENCY = 4;

async function one(clip, outDir, env) {
  const provider = providerByKey(clip.provider);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { audio, billed } = await provider.synth(clip, env);
      writeFileSync(join(outDir, clip.file), audio);
      const { instructions, ...rest } = clip;
      return { ...rest, bytes: audio.length, billed, usd: (billed / 1e6) * clip.usdPerM };
    } catch (err) {
      const retryable = /throttl|429|rate|timeout|5\d\d/i.test(err.message ?? "");
      if (!retryable || attempt === 3) {
        const { instructions, ...rest } = clip;
        return { ...rest, error: err.message };
      }
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
}

/** Synthesize every clip into `runDir`, writing a manifest beside them. */
export async function synthesizeAll(clips, { runId, root = bakeoffDir(), env = process.env, meta = {} }) {
  const outDir = join(root, runId);
  mkdirSync(outDir, { recursive: true });

  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, clips.length) }, async () => {
      while (next < clips.length) {
        const i = next++;
        results[i] = await one(clips[i], outDir, env);
      }
    })
  );

  const billed = results.reduce((n, r) => n + (r.billed ?? 0), 0);
  const run = {
    runId,
    ...meta,
    createdAt: new Date().toISOString(),
    clips: results,
    billed,
    usd: results.reduce((n, r) => n + (r.usd ?? 0), 0),
    errors: results.filter((r) => r.error).length,
  };
  writeFileSync(join(outDir, "run.json"), JSON.stringify(run, null, 2));
  return run;
}

/** Past runs, newest first — so the page can offer yesterday's audition
 *  without spending again. */
export function listRuns(root = bakeoffDir()) {
  if (!existsSync(root)) return [];
  const runs = [];
  for (const entry of readdirSync(root)) {
    try {
      const run = JSON.parse(readFileSync(join(root, entry, "run.json"), "utf8"));
      runs.push({
        runId: run.runId,
        createdAt: run.createdAt,
        venue: run.venue ?? null,
        clips: run.clips?.length ?? 0,
        billed: run.billed ?? 0,
        usd: run.usd ?? 0,
        errors: run.errors ?? 0,
      });
    } catch {
      // A half-written or hand-deleted run dir — skip it rather than 500.
    }
  }
  return runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function readRun(runId, root = bakeoffDir()) {
  try {
    return JSON.parse(readFileSync(join(root, runId, "run.json"), "utf8"));
  } catch {
    return null;
  }
}
