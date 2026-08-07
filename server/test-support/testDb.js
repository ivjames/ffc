// Shared helpers for DB-backed integration tests.
//
// A test file that touches the DB must set `process.env.DATABASE_URL =
// TEST_DATABASE_URL` BEFORE importing app.js/db.js (directly or transitively) —
// db.js builds its pg Pool from DATABASE_URL at import time, so setting it
// later has no effect on that pool.
import pg from "pg";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/ffc_test";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Apply schema.sql (idempotent DDL + seed) to the test DB.
 *
 * The test runner executes each test FILE in its own parallel process, and
 * naively re-applying the whole schema from every file deadlocks (40P01)
 * intermittently: schema.sql runs as one big multi-lock transaction (alter
 * table / update / delete) while other files' app queries hold conflicting
 * locks. Two-part fix, both structural:
 *  - A session advisory lock serializes appliers, so DDL never runs
 *    concurrently with DDL — and because every file calls ensureSchema in its
 *    before() hook, files that would generate app traffic are still parked on
 *    this lock while the first applier runs the DDL.
 *  - A content-hash stamp (test_schema_stamp) makes application once-per-
 *    schema-version instead of once-per-file: after the first file applies a
 *    given schema.sql, every other file (and every later run) sees the stamp
 *    and skips the DDL entirely. Editing schema.sql changes the hash and
 *    triggers one clean re-apply. Reset by dropping/recreating the test DB. */
export async function ensureSchema() {
  const sql = await readFile(join(__dirname, "..", "schema.sql"), "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(727270)"); // arbitrary app-wide key
    try {
      await client.query(
        `create table if not exists test_schema_stamp (
           hash text primary key,
           applied_at timestamptz not null default now()
         )`
      );
      const seen = await client.query(`select 1 from test_schema_stamp where hash = $1`, [hash]);
      if (seen.rowCount === 0) {
        await client.query(sql);
        await client.query(`delete from test_schema_stamp`);
        await client.query(`insert into test_schema_stamp (hash) values ($1)`, [hash]);
      }
    } finally {
      await client.query("select pg_advisory_unlock(727270)").catch(() => {});
    }
  } finally {
    await client.end();
  }
}

/** One-off query against the test DB, for fixture setup/teardown/assertions. */
export async function testQuery(text, params) {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

/** Start `app` on an ephemeral port; returns { baseUrl, close }. */
export async function listenEphemeral(app) {
  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
