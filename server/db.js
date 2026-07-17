// Single shared pg connection pool. All DB creds stay server-side (DATABASE_URL).
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  // Not fatal at import time in every context, but warn loudly — nothing works without it.
  console.warn("[db] DATABASE_URL is not set; database calls will fail.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Convenience helper for one-off queries.
export function query(text, params) {
  return pool.query(text, params);
}
