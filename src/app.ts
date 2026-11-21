import fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import { env } from "./config/env.js";
import { getLoggerConfig } from "./shared/logger.js";
import { globalErrorHandler } from "./shared/errors.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { callingRoutes } from "./modules/calling/calling.routes.js";
import { realtimeRoutes } from "./modules/realtime/realtime.routes.js";

export function buildApp() {
  const app = fastify({
    logger: getLoggerConfig(),
    trustProxy: true,
  });

  // Global error handler
  app.setErrorHandler(globalErrorHandler);

  // CORS plugin
  const allowedOrigins = env.CORS_ORIGINS.split(",").map((origin) => origin.trim());
  app.register(cors, {
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    credentials: true,
  });

  // Cookie plugin
  app.register(cookie, {
    secret: env.SESSION_SECRET,
    hook: "onRequest",
  });

  // WebSocket plugin for realtime signaling
  app.register(websocket);

  // Rate limit plugin
  app.register(rateLimit, {
    global: false, // Per-route opt-in or custom thresholds
    max: 100,
    timeWindow: "1 minute",
  });

  // Health and Readiness probes (root level)
  app.register(healthRoutes);

  // Realtime WebSocket signaling route (/ws)
  app.register(realtimeRoutes);

  // API v1 routes
  app.register(
    async (v1) => {
      v1.register(authRoutes, { prefix: "/auth" });
      v1.register(callingRoutes);
    },
    { prefix: "/api/v1" }
  );

  // Serve Frontend SPA if built
  const clientDist = path.resolve(process.cwd(), "client/dist");
  if (fs.existsSync(clientDist)) {
    app.register(fastifyStatic, {
      root: clientDist,
      prefix: "/",
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        return reply.status(404).send({
          statusCode: 404,
          error: "NotFoundError",
          code: "NOT_FOUND",
          message: `Route ${req.method}:${req.url} not found`,
        });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
