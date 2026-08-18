// Load the committed OpenTriviaQA pack into the platform question bank.
//
//   npm run import:trivia            insert anything not already there
//   npm run import:trivia -- --dry-run    say what it would do, write nothing
//   npm run import:trivia -- --archive    retire every row this import created
//   npm run import:trivia -- --unarchive  put them back
//
// Deliberately NOT wired into `npm run migrate`. The schema seed plants the
// 57-question House Pack because a venue that switches trivia on needs
// something to deal tonight; forty-eight thousand donated questions are an
// editorial decision, and an operator makes it once, on purpose, rather than
// discovering it happened during a deploy.
//
// Re-runnable. Rows are matched on the prompt, so a second run inserts only
// what a first run didn't, and an operator who archived the pack and changed
// their mind gets it back with --unarchive.
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { normalizeQuestion } from "./lib/triviaLive.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACK_PATH = join(__dirname, "seed", "open-trivia-pack.ndjson.gz");

/** The `source` value stamped on every row this import writes. */
export const PACK_SOURCE = "opentriviaqa";

/**
 * One insert statement per this many questions.
 *
 * Not tuning for tuning's sake: at one statement per row this is 48,000 round
 * trips, and in a single statement it is a parameter list Postgres refuses
 * (the bind limit is 65,535). A thousand rows is five arrays of a thousand.
 */
const BATCH = 1000;

/**
 * Read the gzipped NDJSON pack: a header line, then one question per line.
 *
 * Every row is re-validated on the way in. The pack is a committed artifact
 * and could have been hand-edited, or built by an older version of the build
 * script; the bank should not be the place that finds out.
 *
 * @returns {Promise<{ header: object, rows: object[] }>}
 */
export async function readPack(path = PACK_PATH) {
  const lines = createInterface({ input: createReadStream(path).pipe(createGunzip()) });
  let header = null;
  const rows = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (header === null) {
      header = parsed;
      if (header.pack !== PACK_SOURCE) {
        throw new Error(`unexpected pack header: ${JSON.stringify(header).slice(0, 120)}`);
      }
      continue;
    }
    const checked = normalizeQuestion(parsed);
    if (checked.error) throw new Error(`pack row ${rows.length + 1} is invalid: ${checked.error}`);
    rows.push(checked.row);
  }
  if (header === null) throw new Error("pack is empty");
  if (header.count !== rows.length) {
    throw new Error(`pack header claims ${header.count} questions but holds ${rows.length}`);
  }
  return { header, rows };
}

/**
 * Insert the pack's questions into the platform bank (org_id null).
 *
 * Idempotent on the prompt, and scoped to the platform pack: a client who
 * happens to have written the same question keeps their own copy untouched.
 * The whole import runs in one transaction, so a failure halfway through
 * leaves the bank exactly as it was rather than half-donated.
 *
 * @param {import("pg").PoolClient} client
 * @param {object[]} rows
 * @param {{ dryRun?: boolean, source?: string }} opts
 *   `source` is the stamp written to the `source` column; overridable so a
 *   test can write and clean up its own rows without touching a real import's.
 * @returns {Promise<{ inserted: number, alreadyPresent: number }>}
 */
export async function importPack(client, rows, { dryRun = false, source = PACK_SOURCE } = {}) {
  let inserted = 0;
  await client.query("begin");
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const result = await client.query(
        `insert into trivia_question
           (org_id, location_id, category, prompt, choices, answer, difficulty, source)
         select null, null, p.category, p.prompt, p.choices, p.answer, p.difficulty, $6
           from unnest($1::text[], $2::text[], $3::jsonb[], $4::int[], $5::int[])
                as p(category, prompt, choices, answer, difficulty)
          where not exists (
            select 1 from trivia_question t
             where t.org_id is null and t.prompt = p.prompt
          )`,
        [
          batch.map((r) => r.category),
          batch.map((r) => r.prompt),
          batch.map((r) => JSON.stringify(r.choices)),
          batch.map((r) => r.answer),
          batch.map((r) => r.difficulty),
          source,
        ]
      );
      inserted += result.rowCount;
    }
    await client.query(dryRun ? "rollback" : "commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
  return { inserted, alreadyPresent: rows.length - inserted };
}

/**
 * Retire every row this import created, or put them back.
 *
 * Archives rather than deletes, for two reasons: `archived_at` is already what
 * the deal query filters on, so the questions stop being dealt the moment this
 * returns; and a DELETE would not actually be undoable by re-running the
 * import — matching is on the prompt, so deleted rows come back but archived
 * ones do not. Hence `--unarchive`: the undo has to be a real command, not a
 * SQL snippet in a README that an operator has to trust at 9pm on a Friday.
 *
 * @param {import("pg").PoolClient} client
 * @param {{ archived: boolean, dryRun?: boolean, source?: string }} opts
 * @returns {Promise<{ changed: number }>}
 */
export async function setPackArchived(client, { archived, dryRun = false, source = PACK_SOURCE }) {
  await client.query("begin");
  try {
    const result = archived
      ? await client.query(
          `update trivia_question set archived_at = now()
            where source = $1 and archived_at is null`,
          [source]
        )
      : await client.query(
          `update trivia_question set archived_at = null
            where source = $1 and archived_at is not null`,
          [source]
        );
    await client.query(dryRun ? "rollback" : "commit");
    return { changed: result.rowCount };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const archive = process.argv.includes("--archive");
  const unarchive = process.argv.includes("--unarchive");
  const started = Date.now();
  const client = await pool.connect();
  try {
    if (archive || unarchive) {
      const { changed } = await setPackArchived(client, { archived: archive, dryRun });
      const verb = archive ? "archived" : "restored";
      console.log(`[import-trivia] ${dryRun ? `would have ${verb}` : verb} ${changed} pack questions`);
      return;
    }

    const { header, rows } = await readPack();
    console.log(`[import-trivia] pack: ${rows.length} questions from ${header.source}`);
    console.log(`[import-trivia] license: ${header.license} (upstream ${header.upstreamCommit ?? "unknown"})`);

    // Pre-flight: an operator about to grow their bank by three orders of
    // magnitude should see the number before it happens, not after.
    const before = await client.query(
      `select count(*)::int as n from trivia_question where org_id is null and archived_at is null`
    );
    console.log(`[import-trivia] platform bank holds ${before.rows[0].n} live questions right now`);
    if (dryRun) console.log("[import-trivia] --dry-run: the transaction will be rolled back");

    const { inserted, alreadyPresent } = await importPack(client, rows, { dryRun });
    console.log(
      `[import-trivia] ${dryRun ? "would insert" : "inserted"} ${inserted}, ` +
        `${alreadyPresent} already in the bank`
    );

    const byCategory = await client.query(
      `select category, count(*)::int as n from trivia_question
        where org_id is null and archived_at is null and active
        group by category order by n desc`
    );
    for (const { category, n } of byCategory.rows) {
      console.log(`[import-trivia]   ${String(n).padStart(5)}  ${category}`);
    }
    console.log(`[import-trivia] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    // Per the house rule on reporting spend for bulk operations: this one makes
    // no model or API calls at all. Zero tokens, zero dollars — the corpus was
    // parsed and filtered at build time and ships as a committed file.
    console.log("[import-trivia] model/API cost: none — 0 tokens, $0.00");
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[import-trivia] failed:", err);
    process.exit(1);
  });
}
