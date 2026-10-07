/**
 * Applies apps/api/src/db/migrations/*.sql in order and records each one in
 * schema_migrations. schema.sql is the baseline (there is no 001 file); every
 * migration is idempotent, so running this on a database that already had some
 * applied by hand is safe.
 *
 *   npm run migrate            # from apps/api
 */
import fs from "node:fs";
import path from "node:path";
import { pool } from "./pool";

function migrationsDir(): string {
  const candidates = [
    path.join(__dirname, "migrations"),
    path.join(__dirname, "..", "..", "src", "db", "migrations"), // when running from dist/
  ];
  const dir = candidates.find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith(".sql")));
  if (!dir) throw new Error(`No migrations directory found (looked in ${candidates.join(", ")})`);
  return dir;
}

export async function runMigrations(): Promise<string[]> {
  await pool.query(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await pool.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log(`[migrate] applying ${file}`);
    try {
      await pool.query(sql); // each file manages its own begin/commit
    } catch (e) {
      await pool.query("rollback").catch(() => undefined);
      throw new Error(`[migrate] ${file} failed: ${(e as Error).message}`);
    }
    await pool.query("insert into schema_migrations (name) values ($1) on conflict do nothing", [file]);
    applied.push(file);
  }
  console.log(applied.length ? `[migrate] applied ${applied.length} migration(s)` : "[migrate] already up to date");
  return applied;
}

/** Columns the scraping pipeline reads or writes. Missing ones make every scrape fail. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  scraping_sources: ["paused", "consecutive_failures", "last_failure_reason", "next_check_at", "compliance_status"],
  competitor_products: ["price_selector"],
  scraping_job_runs: ["organization_id", "created_at", "result_price_cents", "result_currency", "method"],
  organizations: ["default_currency", "scraping_credits_total", "scraping_credits_used"],
};

/** Logs (does not throw) when the database is behind the code. Called at API startup. */
export async function checkScrapingSchema(): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = current_schema() and table_name = any($1)`,
      [Object.keys(REQUIRED_COLUMNS)],
    );
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing = Object.entries(REQUIRED_COLUMNS).flatMap(([t, cols]) =>
      cols.map((c) => `${t}.${c}`).filter((tc) => !have.has(tc)),
    );
    if (missing.length) {
      console.error(
        `[schema] database is missing ${missing.length} column(s) the scraper needs: ${missing.join(", ")}. ` +
          "Scraping will fail until you run `npm run migrate` in apps/api.",
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("[schema] could not verify scraping columns:", (e as Error).message);
    return false;
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((e) => {
      console.error((e as Error).message);
      return pool.end().finally(() => process.exit(1));
    });
}
