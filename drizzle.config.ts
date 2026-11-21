import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./dist/db/schema/index.js",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/wallet_voice_call",
  },
  strict: true,
  verbose: true,
});
