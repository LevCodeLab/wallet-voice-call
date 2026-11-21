import type { FastifyPluginAsync } from "fastify";
import { authService } from "./auth.service.js";
import { requireAuth, extractSessionToken } from "./auth.middleware.js";
import { requestNonceSchema, verifySignatureSchema } from "./auth.schemas.js";
import { env } from "../../config/env.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Request an unpredictable, single-use server nonce
   * Public endpoint with rate limiting
   */
  app.post(
    "/nonce",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const input = requestNonceSchema.parse(request.body);
      const clientIp = request.ip;

      const challenge = await authService.requestNonce(input, clientIp);
      return reply.status(200).send(challenge);
    }
  );

  /**
   * Verify signature and establish an authenticated session
   */
  app.post(
    "/verify",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const input = verifySignatureSchema.parse(request.body);
      const result = await authService.verifyAndCreateSession(input, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });

      // Set secure HTTP-only session cookie
      reply.setCookie("session_token", result.sessionToken, {
        path: "/",
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: env.SESSION_TTL_HOURS * 3600,
      });

      return reply.status(200).send({
        user: {
          id: result.user.id,
          walletAddress: result.user.walletAddress,
          network: result.user.network,
          displayName: result.user.displayName,
          avatarUrl: result.user.avatarUrl,
          createdAt: result.user.createdAt.toISOString(),
        },
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt,
      });
    }
  );

  /**
   * Retrieve the current authenticated user identity
   */
  app.get("/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user!;
    return reply.status(200).send({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        network: user.network,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt.toISOString(),
      },
    });
  });

  /**
   * Revoke session and log out
   */
  app.post("/logout", { preHandler: [requireAuth] }, async (request, reply) => {
    const token = extractSessionToken(request);
    if (token) {
      await authService.revokeSession(token, request.ip);
    }

    reply.clearCookie("session_token", { path: "/" });

    return reply.status(200).send({
      success: true,
      message: "Session successfully revoked. You have been logged out.",
    });
  });

  /**
   * Issue a short-lived single-use ticket for WebSocket authentication
   */
  app.post("/ws-ticket", { preHandler: [requireAuth] }, async (request, reply) => {
    const ticket = authService.createWsTicket(request.user!.id);
    return reply.status(200).send(ticket);
  });
};
