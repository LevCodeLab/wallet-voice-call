import pino from "pino";
import type { FastifyServerOptions } from "fastify";
import { env } from "../config/env.js";

export function getLoggerConfig(): FastifyServerOptions["logger"] {
  if (env.NODE_ENV === "test") {
    return false;
  }

  const isDev = env.NODE_ENV === "development";

  return {
    level: env.LOG_LEVEL,
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['set-cookie']",
      "headers.authorization",
      "headers.cookie",
      "headers['set-cookie']",
      "password",
      "secret",
      "sessionToken",
      "signature",
    ],
    transport: isDev
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  };
}

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "password",
    "secret",
    "sessionToken",
    "signature",
  ],
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});
