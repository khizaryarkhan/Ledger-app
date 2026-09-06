import type { Config } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

// Load DATABASE_URL from .env.local (Next's convention) so the CLI has it.
// Override per-command by exporting DATABASE_URL (e.g. a Neon branch URL).
loadEnv({ path: ".env.local", quiet: true });

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
