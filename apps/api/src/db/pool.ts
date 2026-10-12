import { Pool } from "pg";
import "dotenv/config";

const url = process.env.DATABASE_URL ?? "";

// Supabase requires TLS but its certificate chain isn't in Node's trust store, and pg treats
// `sslmode=require` as verify-full. Drop the URL param and ask for an encrypted, unverified connection.
const useSsl = /supabase\.(co|com)/.test(url) || process.env.DATABASE_SSL === "true";

export const pool = new Pool({
  connectionString: useSsl ? url.replace(/[?&]sslmode=[^&]*/g, "") : url,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

/** Thin query helper so routes don't import `pool` directly everywhere. */
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
