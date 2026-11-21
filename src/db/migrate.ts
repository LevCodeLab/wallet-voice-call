import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";
import { logger } from "../shared/logger.js";

export async function runMigrations() {
  logger.info("Applying database migrations from src/db/migrations...");
  try {
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    logger.info("Database migrations applied successfully.");
  } catch (error) {
    logger.error({ error }, "Failed to apply database migrations.");
    throw error;
  }
}

// If executed directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
