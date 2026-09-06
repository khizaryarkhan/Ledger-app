/**
 * Apply pending Drizzle migrations from ./db/migrations.
 * Usage:
 *   npm run db:migrate                 # uses DATABASE_URL from .env.local
 *   DATABASE_URL="<neon-branch-url>" npm run db:migrate   # target a branch first
 *
 * Always run against a Neon BRANCH before production.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(url));
  console.log("Applying migrations from ./db/migrations …");
  await migrate(db, { migrationsFolder: "./db/migrations" });
  console.log("✓ Migrations applied.");
}

main().catch((e) => { console.error("Migration failed:", e); process.exit(1); });
