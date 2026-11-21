import type { FastifyPluginAsync } from "fastify";
import { checkDbConnection } from "../../db/index.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness probe
  app.get("/health", async (_request, reply) => {
    return reply.status(200).send({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Readiness probe: verifies essential dependencies (PostgreSQL)
  app.get("/ready", async (_request, reply) => {
    const isDbConnected = await checkDbConnection();

    if (!isDbConnected) {
      return reply.status(503).send({
        status: "not_ready",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      });
    }

    return reply.status(200).send({
      status: "ready",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  });
};
