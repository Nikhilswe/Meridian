import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { createPool } from "./pool";

dotenv.config();

/**
 * Idempotent migration runner: tracks applied files in a `schema_migrations`
 * table and only runs files it hasn't seen before, in filename order (hence
 * the numeric prefixes on each .sql file).
 */
async function migrate(): Promise<void> {
  const pool = createPool();
  const migrationsDir = path.join(__dirname, "migrations");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      "fileName" TEXT PRIMARY KEY,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedResult = await pool.query(`SELECT "fileName" FROM schema_migrations`);
  const applied = new Set<string>(appliedResult.rows.map((r) => r.fileName));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping already-applied migration: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`Applying migration: ${file}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations ("fileName") VALUES ($1)`, [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log("Migrations complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", (err as Error).message);
  process.exit(1);
});
