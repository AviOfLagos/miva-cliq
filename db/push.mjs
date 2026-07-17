/**
 * Applies db/schema.sql to the connected Neon database. Idempotent — the schema
 * is all `CREATE ... IF NOT EXISTS`, so re-running is safe.
 *
 *   npm run db:push
 *
 * Reads the connection string the same way lib/store/db.ts does, from whichever
 * alias Neon's Vercel integration injected. Pull it locally with `vercel env pull`.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

// Load .env.local if present (Next does this at runtime; a plain script doesn't).
try {
  const env = await readFile(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env.local — rely on the ambient environment */
}

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!url) {
  console.error(
    "No connection string. Set DATABASE_URL (or run `vercel env pull .env.local`).",
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = await readFile(join(here, "schema.sql"), "utf8");

const sql = neon(url);
// Strip whole-line SQL comments first, THEN split on ';'. (Splitting first and
// dropping chunks that start with '--' would swallow the CREATE that follows a
// comment block.) The schema has no functions or dollar-quoted bodies, so a
// naive split on ';' is safe.
const statements = schema
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Applying ${statements.length} statements…`);
for (const stmt of statements) {
  await sql.query(stmt);
}
console.log("Schema applied.");