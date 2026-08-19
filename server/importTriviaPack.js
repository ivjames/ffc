// Load the committed OpenTriviaQA pack into the platform question bank.
//
//   npm run import:trivia            insert anything not already there
//   npm run import:trivia -- --dry-run    say what it would do, write nothing
//   npm run import:trivia -- --archive    retire every row this import created
//   npm run import:trivia -- --unarchive  put them back
//   npm run import:trivia -- --prune      also retire rows the pack has dropped
//   npm run import:trivia -- --refresh    update rows whose text the pack changed
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
import { readFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeQuestion } from "./lib/triviaLive.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACK_PATH = join(__dirname, "seed", "open-trivia-pack.ndjson.gz");
export const LINEAGE_PATH = join(__dirname, "seed", "open-trivia-lineage.ndjson");

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
 * Where each repaired prompt came from, written beside the pack by the build.
 *
 * @returns {Promise<{was: string, now: string}[]>}
 */
export async function readLineage(path = LINEAGE_PATH) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // An older pack shipped without one. Not fatal: it only means archives
    // cannot be carried across a rename, which is how this used to behave.
    return [];
  }
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * Keep a retired question retired when a repair rewrites its prompt.
 *
 * The import matches on the prompt, so a corrected question is indistinguishable
 * from a brand new one: it arrives as a fresh insert with `archived_at` null,
 * and `--prune` then retires the row it replaced. The net effect, without this,
 * is that an operator who deliberately pulled a question off the screen finds
 * it back on the screen the next time somebody fixes its spelling — their
 * decision silently undone by a typo fix.
 *
 * The lineage beside the pack is what closes that gap. For every prompt a
 * repair rewrote, this carries the old row's `archived_at` onto the new one.
 *
 * Run AFTER `importPack`, so the successor row exists to carry it to.
 *
 * @param {import("pg").PoolClient} client
 * @param {{was: string, now: string}[]} lineage
 * @param {{ dryRun?: boolean, source?: string }} opts
 * @returns {Promise<{ carried: number }>}
 */
export async function carryArchives(client, lineage, { dryRun = false, source = PACK_SOURCE } = {}) {
  let carried = 0;
  await client.query("begin");
  try {
    for (let i = 0; i < lineage.length; i += BATCH) {
      const batch = lineage.slice(i, i + BATCH);
      const result = await client.query(
        `update trivia_question t
            set archived_at = prior.archived_at
           from unnest($1::text[], $2::text[]) as p(was, now)
           join trivia_question prior
             on prior.prompt = p.was and prior.org_id is null and prior.source = $3
          where t.prompt = p.now and t.org_id is null and t.source = $3
            and prior.archived_at is not null
            and t.archived_at is null`,
        [batch.map((l) => l.was), batch.map((l) => l.now), source]
      );
      carried += result.rowCount;
    }
    await client.query(dryRun ? "rollback" : "commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
  return { carried };
}

/**
 * Bring already-imported rows back in line with the pack's text.
 *
 * `importPack` matches on the prompt, which is the right key for "have I
 * seen this question before" and the wrong one for "has this question
 * changed". A repair that rewrites a prompt therefore arrives as a fresh
 * insert (and the superseded row is retired by `--prune`), but a repair that
 * only touches the OPTIONS leaves the prompt identical — so the row reads as
 * already present and the correction never lands. That is not hypothetical:
 * the apostrophe, typo and ampersand overlays fix 1,804 rows that way, and
 * without this they would sit misspelled in the bank forever.
 *
 * So the contract is simple and worth stating: for rows this import owns, the
 * pack is the source of truth, and `--refresh` makes the bank agree with it.
 * Scoped to `source` and the platform pack, so a client's own questions are
 * never touched. `archived_at` and `active` are deliberately left alone — an
 * operator who retired a question was making an editorial decision about the
 * question, not about its spelling, and fixing a typo must not quietly put it
 * back on the screen.
 *
 * @param {import("pg").PoolClient} client
 * @param {object[]} rows
 * @param {{ dryRun?: boolean, source?: string }} opts
 * @returns {Promise<{ updated: number }>}
 */
export async function refreshPack(client, rows, { dryRun = false, source = PACK_SOURCE } = {}) {
  let updated = 0;
  await client.query("begin");
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const result = await client.query(
        `update trivia_question t
            set choices = p.choices, answer = p.answer,
                category = p.category, difficulty = p.difficulty
           from unnest($1::text[], $2::text[], $3::jsonb[], $4::int[], $5::int[])
                as p(category, prompt, choices, answer, difficulty)
          where t.org_id is null and t.source = $6 and t.prompt = p.prompt
            and (t.choices is distinct from p.choices
                 or t.answer is distinct from p.answer
                 or t.category is distinct from p.category
                 or t.difficulty is distinct from p.difficulty)`,
        [
          batch.map((r) => r.category),
          batch.map((r) => r.prompt),
          batch.map((r) => JSON.stringify(r.choices)),
          batch.map((r) => r.answer),
          batch.map((r) => r.difficulty),
          source,
        ]
      );
      updated += result.rowCount;
    }
    await client.query(dryRun ? "rollback" : "commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
  return { updated };
}

/**
 * How many imported rows the pack would change — the number `--refresh` acts on.
 *
 * @param {import("pg").PoolClient} client
 * @param {object[]} rows
 * @param {{ source?: string }} opts
 * @returns {Promise<number>}
 */
export async function countDrifted(client, rows, { source = PACK_SOURCE } = {}) {
  let drifted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const result = await client.query(
      `select count(*)::int as n
         from trivia_question t
         join unnest($1::text[], $2::jsonb[], $3::int[], $4::text[], $5::int[])
              as p(prompt, choices, answer, category, difficulty)
           on t.prompt = p.prompt
        where t.org_id is null and t.source = $6
          and (t.choices is distinct from p.choices
               or t.answer is distinct from p.answer
               or t.category is distinct from p.category
               or t.difficulty is distinct from p.difficulty)`,
      [
        batch.map((r) => r.prompt),
        batch.map((r) => JSON.stringify(r.choices)),
        batch.map((r) => r.answer),
        batch.map((r) => r.category),
        batch.map((r) => r.difficulty),
        source,
      ]
    );
    drifted += result.rows[0].n;
  }
  return drifted;
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

/**
 * Retire imported rows that the current pack no longer contains.
 *
 * The reason this exists is safety, not tidiness. The pack's content filter
 * gets tightened from time to time, and a tightened filter is worthless to a
 * venue that already ran the import: inserting is idempotent, but it never
 * takes anything back, so a question dropped upstream would keep being dealt
 * forever. `--prune` is how a filter fix actually reaches a live bank.
 *
 * Archives rather than deletes, like everything else in Master Control, and
 * only ever touches rows this import created — a question an operator wrote by
 * hand has `source` null and is never in scope.
 *
 * @returns {Promise<{ pruned: number }>}
 */
export async function prunePack(client, rows, { dryRun = false, source = PACK_SOURCE } = {}) {
  await client.query("begin");
  try {
    const result = await client.query(
      `update trivia_question t set archived_at = now()
        where t.source = $2 and t.archived_at is null
          and not exists (
            select 1 from unnest($1::text[]) as p(prompt) where p.prompt = t.prompt
          )`,
      [rows.map((r) => r.prompt), source]
    );
    await client.query(dryRun ? "rollback" : "commit");
    return { pruned: result.rowCount };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Load the pg pool, or explain what to do about it.
 *
 * `db.js` pulls in `pg` at module load, so importing it at the top of this
 * file turns a missing `node_modules` into a raw ERR_MODULE_NOT_FOUND stack
 * trace before a single line here runs — which is what an operator saw, and
 * which tells them nothing about the fix. Deferring the import is what buys
 * the chance to say it plainly.
 */
async function connectPool() {
  let pool;
  try {
    ({ pool } = await import("./db.js"));
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      const here = dirname(fileURLToPath(import.meta.url));
      console.error("[import-trivia] the server's dependencies are not installed here.");
      console.error(`[import-trivia]   cd ${here} && npm ci --omit=dev`);
      console.error("[import-trivia] (this is the same install `ffc deploy` runs, so it is safe to repeat)");
      process.exit(1);
    }
    throw err;
  }
  if (!process.env.DATABASE_URL) {
    console.error("[import-trivia] DATABASE_URL is not set, so there is no bank to import into.");
    console.error("[import-trivia] it is normally read from the server's .env — run this from the server directory.");
    process.exit(1);
  }
  return pool;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refresh = process.argv.includes("--refresh");
  const archive = process.argv.includes("--archive");
  const unarchive = process.argv.includes("--unarchive");
  const prune = process.argv.includes("--prune");
  const started = Date.now();
  const pool = await connectPool();
  const client = await pool.connect();
  try {
    if (archive || unarchive) {
      const { changed } = await setPackArchived(client, { archived: archive, dryRun });
      const verb = archive ? "archived" : "restored";
      console.log(`[import-trivia] ${dryRun ? `would have ${verb}` : verb} ${changed} pack questions`);
      return;
    }

    // Anything a plain run leaves undone. Reported at the very end rather than
    // where it is discovered: the per-category tally is forty lines long, so a
    // notice printed before it scrolls off and the operator walks away with a
    // half-corrected bank believing it is done.
    const outstanding = [];

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

    // Immediately after the insert, so a question an operator retired stays
    // retired even when a repair gave it a new prompt and therefore a new row.
    const lineage = await readLineage();
    if (lineage.length) {
      const { carried } = await carryArchives(client, lineage, { dryRun });
      if (carried > 0) {
        console.log(
          `[import-trivia] ${dryRun ? "would keep" : "kept"} ${carried} operator-retired questions retired ` +
            `across a repaired prompt`
        );
      }
    }

    // Before --prune, because pruning is about rows the pack DROPPED and this is
    // about rows it still has: refreshing first means the counts an operator
    // reads afterwards describe a bank that already agrees with the pack.
    if (refresh) {
      const { updated } = await refreshPack(client, rows, { dryRun });
      console.log(
        `[import-trivia] ${dryRun ? "would update" : "updated"} ${updated} rows whose text the pack changed`
      );
    } else {
      // Same reasoning as the --prune notice below: an operator who has just
      // pulled a corrected pack needs to know that inserting alone does not
      // fix a question whose PROMPT was already right.
      const drifted = await countDrifted(client, rows);
      if (drifted > 0) outstanding.push([drifted, "differ from the pack", "--refresh"]);
    }

    if (prune) {
      const { pruned } = await prunePack(client, rows, { dryRun });
      console.log(
        `[import-trivia] ${dryRun ? "would retire" : "retired"} ${pruned} rows no longer in the pack`
      );
    } else {
      // Say it out loud. An operator tightening the content filter needs to
      // know that re-importing alone does not remove anything.
      const stale = await client.query(
        `select count(*)::int as n from trivia_question t
          where t.source = $2 and t.archived_at is null
            and not exists (
              select 1 from unnest($1::text[]) as p(prompt) where p.prompt = t.prompt
            )`,
        [rows.map((r) => r.prompt), PACK_SOURCE]
      );
      if (stale.rows[0].n > 0) outstanding.push([stale.rows[0].n, "are no longer in the pack", "--prune"]);
    }

    const byCategory = await client.query(
      `select category, count(*)::int as n from trivia_question
        where org_id is null and archived_at is null and active
        group by category order by n desc`
    );
    for (const { category, n } of byCategory.rows) {
      console.log(`[import-trivia]   ${String(n).padStart(5)}  ${category}`);
    }
    console.log(`[import-trivia] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (outstanding.length) {
      const flags = outstanding.map(([, , flag]) => flag).join(" ");
      console.log("[import-trivia] ");
      console.log("[import-trivia] *** THIS BANK IS NOT YET FULLY UPDATED ***");
      for (const [n, what, flag] of outstanding) {
        console.log(`[import-trivia]   ${n} imported rows ${what} — ${flag} would fix them`);
      }
      console.log(`[import-trivia]   re-run:  npm run import:trivia -- ${flags}`);
      console.log("[import-trivia] ");
    }
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
