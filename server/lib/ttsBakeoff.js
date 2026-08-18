// Polly voice bake-off — the shared engine behind the CLI script and the
// Master Control page.
//
// Lives here rather than in scripts/ for two reasons: @aws-sdk/client-polly is
// a server dependency (node resolves it relative to the importing file, and
// scripts/ has no node_modules of its own), and the server is where real
// pre-synthesis will live once a voice is chosen. scripts/tts-bakeoff.mjs is a
// thin CLI over this.
//
// Nothing here spends money except synthesizeAll(). planClips() and
// estimate() price a run so a caller can show the bill before committing to
// it — the house rule for anything that makes a batch of API calls.
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { lobbyScript, questionScript, revealScript } from "./triviaSpeechScript.js";

// $ per 1M characters, Polly neural. Re-verify at build time — cheap TTS tiers
// churn (TTS-PRICING.md).
export const NEURAL_USD_PER_M = 16;

// `newscaster` marks the voices AWS documents as supporting the news speaking
// style on the neural engine. Asking for it on any other voice is an API
// error, not a silent downgrade.
export const VOICES = [
  { id: "Joanna", newscaster: true },
  { id: "Matthew", newscaster: true },
];

// plain      — the neural voice as-is, the baseline.
// newscaster — an announcer register, the closest Polly has to "reads to a
//              room for a living".
// +drc       — dynamic range compression: lifts the quiet parts so consonants
//              survive a noisy bar. No equivalent exists in the browser voice
//              the app falls back to.
export const STYLES = [
  { key: "plain", label: "plain", newscaster: false, drc: false },
  { key: "news", label: "newscaster", newscaster: true, drc: false },
  { key: "news-drc", label: "newscaster + DRC", newscaster: true, drc: true },
];

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

// --- SSML -------------------------------------------------------------------

/** Wrap plain text for one style. SSML tags are NOT billed, so the markup is
 *  free — only the words inside count against the bill. */
export function ssmlFor(text, style) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let inner = escaped;
  if (style.drc) inner = `<amazon:effect name="drc">${inner}</amazon:effect>`;
  if (style.newscaster) inner = `<amazon:domain name="news">${inner}</amazon:domain>`;
  return `<speak>${inner}</speak>`;
}

/** Every clip a run would make, priced before anything is spent. */
export function planClips(lines) {
  const clips = [];
  for (const line of lines) {
    for (const voice of VOICES) {
      for (const style of STYLES) {
        if (style.newscaster && !voice.newscaster) continue;
        clips.push({
          lineLabel: line.label,
          text: line.text,
          voice: voice.id,
          styleKey: style.key,
          styleLabel: style.label,
          chars: line.text.length,
          ssml: ssmlFor(line.text, style),
          file: `${voice.id}-${style.key}-${line.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp3`,
        });
      }
    }
  }
  return clips;
}

export function estimate(clips) {
  const chars = clips.reduce((n, c) => n + c.chars, 0);
  return { clips: clips.length, chars, usd: (chars / 1e6) * NEURAL_USD_PER_M };
}

// --- synthesis (the only part that spends) ----------------------------------

/** Neural is 8 tps with a burst of 10, so a handful at a time with backoff
 *  keeps a whole run inside one polite burst instead of collecting
 *  ThrottlingExceptions. */
const CONCURRENCY = 4;

async function one(polly, clip, outDir) {
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
      const { ssml, ...rest } = clip;
      // RequestCharacters is the API's own count of what it billed — not our
      // estimate. Falls back to the plain-text length if a response omits it.
      return { ...rest, bytes: audio.length, billed: res.RequestCharacters ?? clip.chars };
    } catch (err) {
      const retryable = err.name === "ThrottlingException" || err.$metadata?.httpStatusCode >= 500;
      if (!retryable || attempt === 4) {
        const { ssml, ...rest } = clip;
        return { ...rest, error: `${err.name}: ${err.message}` };
      }
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
}

/** Synthesize every clip into `runDir`, writing a manifest beside them.
 *  Returns { runId, clips, billed, usd, errors }. */
export async function synthesizeAll(clips, { runId, root = bakeoffDir(), env = process.env, meta = {} }) {
  const outDir = join(root, runId);
  mkdirSync(outDir, { recursive: true });
  const polly = new PollyClient({ region: env.AWS_REGION || "us-east-1" });

  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, clips.length) }, async () => {
      while (next < clips.length) {
        const i = next++;
        results[i] = await one(polly, clips[i], outDir);
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
    usd: (billed / 1e6) * NEURAL_USD_PER_M,
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
