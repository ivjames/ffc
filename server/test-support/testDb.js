// Shared helpers for DB-backed integration tests.
//
// A test file that touches the DB must set `process.env.DATABASE_URL =
// TEST_DATABASE_URL` BEFORE importing app.js/db.js (directly or transitively) —
// db.js builds its pg Pool from DATABASE_URL at import time, so setting it
// later has no effect on that pool.
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/ffc_test";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Apply schema.sql (idempotent DDL + seed) to the test DB. */
export async function ensureSchema() {
  const sql = await readFile(join(__dirname, "..", "schema.sql"), "utf8");
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
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
