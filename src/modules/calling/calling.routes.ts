import type { FastifyPluginAsync } from "fastify";
import { callingService } from "./calling.service.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  updateCallingSettingsSchema,
  initiateCallInputSchema,
  callRejectInputSchema,
  callHistoryQuerySchema,
} from "./calling.schemas.js";

export const callingRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Public calling profile resolution
   * GET /api/v1/users/:address/profile
   */
  app.get<{ Params: { address: string } }>(
    "/users/:address/profile",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const profile = await callingService.getPublicProfile(request.params.address);
      return reply.status(200).send(profile);
    }
  );

  /**
   * Get authenticated user's calling settings
   * GET /api/v1/users/me/calling-settings
   */
  app.get("/users/me/calling-settings", { preHandler: [requireAuth] }, async (request, reply) => {
    const settings = await callingService.getSettings(request.user!.id);
    return reply.status(200).send(settings);
  });

  /**
   * Update authenticated user's incoming call availability
   * PATCH /api/v1/users/me/calling-settings
   */
  app.patch("/users/me/calling-settings", { preHandler: [requireAuth] }, async (request, reply) => {
    const input = updateCallingSettingsSchema.parse(request.body);
    const settings = await callingService.updateSettings(request.user!.id, input.isAcceptingCalls);
    return reply.status(200).send(settings);
  });

  /**
   * Dynamic ICE / STUN / TURN server configuration for WebRTC
   * GET /api/v1/webrtc/ice-servers
   */
  app.get(
    "/webrtc/ice-servers",
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (_request, reply) => {
      const iceConfig = callingService.getIceServers();
      return reply.status(200).send(iceConfig);
    }
  );

  /**
   * Paginated Call History for authenticated user
   * GET /api/v1/calls/history
   */
  app.get(
    "/calls/history",
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const query = callHistoryQuerySchema.parse(request.query);
      const history = await callingService.getCallHistory(request.user!, query);
      return reply.status(200).send(history);
    }
  );

  /**
   * Initiate an outgoing call session
   * POST /api/v1/calls
   */
  app.post(
    "/calls",
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const input = initiateCallInputSchema.parse(request.body);
      const session = await callingService.initiateCall(request.user!, input.recipientAddress);
      return reply.status(201).send(session);
    }
  );

  /**
   * Get active or recent call session details (caller or recipient only)
   * GET /api/v1/calls/:callId
   */
  app.get<{ Params: { callId: string } }>(
    "/calls/:callId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = await callingService.getCallSession(request.user!, request.params.callId);
      return reply.status(200).send(session);
    }
  );

  /**
   * Accept an incoming call (recipient only)
   * POST /api/v1/calls/:callId/accept
   */
  app.post<{ Params: { callId: string } }>(
    "/calls/:callId/accept",
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await callingService.acceptCall(request.user!, request.params.callId);
      return reply.status(200).send(session);
    }
  );

  /**
   * Confirm WebRTC media connection established (authoritative transition to connected)
   * POST /api/v1/calls/:callId/connected
   */
  app.post<{ Params: { callId: string } }>(
    "/calls/:callId/connected",
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await callingService.confirmCallConnected(request.user!, request.params.callId);
      return reply.status(200).send(session);
    }
  );

  /**
   * Reject an incoming call (recipient only)
   * POST /api/v1/calls/:callId/reject
   */
  app.post<{ Params: { callId: string } }>(
    "/calls/:callId/reject",
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const input = callRejectInputSchema.parse(request.body || {});
      const session = await callingService.rejectCall(request.user!, request.params.callId, input.reason);
      return reply.status(200).send(session);
    }
  );

  /**
   * Cancel an outgoing call (caller only)
   * POST /api/v1/calls/:callId/cancel
   */
  app.post<{ Params: { callId: string } }>(
    "/calls/:callId/cancel",
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await callingService.cancelCall(request.user!, request.params.callId);
      return reply.status(200).send(session);
    }
  );

  /**
   * Terminate an active call (caller or recipient)
   * POST /api/v1/calls/:callId/end
   */
  app.post<{ Params: { callId: string } }>(
    "/calls/:callId/end",
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await callingService.endCall(request.user!, request.params.callId);
      return reply.status(200).send(session);
    }
  );
};
