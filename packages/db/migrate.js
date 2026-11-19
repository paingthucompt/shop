// Applies packages/db/migrations/*.sql in order (each once). Usage: npm run db:migrate
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) continue;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(readFileSync(join(dir, file), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`✓ ${file}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`✖ ${file}: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
  }
}
console.log("migrations up to date");
await pool.end();
