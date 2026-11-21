import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./shared/logger.js";
import { checkDbConnection, closeDb } from "./db/index.js";
import { callingService } from "./modules/calling/calling.service.js";

async function main() {
  const app = buildApp();

  // Verify database connectivity prior to accepting traffic
  logger.info("Checking database connectivity...");
  const isDbReady = await checkDbConnection();
  if (!isDbReady) {
    logger.error("Failed to connect to PostgreSQL database. Exiting...");
    process.exit(1);
  }
  logger.info("Database connection established.");

  // Recover any stale calls lingering from previous server crashes or restarts
  try {
    logger.info("Recovering stale calls from previous server instances...");
    const recoveredCount = await callingService.recoverStaleCalls({ isStartup: true, serverBootTime: new Date() });
    logger.info({ recoveredCount }, "Stale call recovery completed on startup.");
  } catch (err) {
    logger.error({ err }, "Error running startup stale call recovery");
  }

  // Check STUN / TURN configuration diagnostics (Phase 5.2 Priority 4)
  if (!env.TURN_URLS) {
    logger.warn(
      "WebRTC Warning: TURN_URLS is not configured. Cross-NAT and cellular peer-to-peer audio connections will rely solely on STUN and may fail on symmetric NATs or carrier-grade NAT mobile networks."
    );
  } else {
    logger.info(
      { turnUrls: env.TURN_URLS.split(",").map((s) => s.trim()) },
      "WebRTC TURN relay configured successfully."
    );
  }

  // Start periodic background recovery sweep for ringing/connecting timeouts
  callingService.startRecoverySweep(15000);

  // Graceful shutdown listener
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info(`Received ${signal}. Initiating graceful shutdown...`);
      try {
        callingService.stopRecoverySweep();
        await app.close();
        await closeDb();
        logger.info("Graceful shutdown completed successfully.");
        process.exit(0);
      } catch (err) {
        logger.error({ err }, "Error during graceful shutdown.");
        process.exit(1);
      }
    });
  }

  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "Unhandled Promise Rejection detected.");
    process.exit(1);
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught Exception detected.");
    process.exit(1);
  });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info(`Server listening at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    logger.error({ err }, "Error starting HTTP server.");
    process.exit(1);
  }
}

main();
