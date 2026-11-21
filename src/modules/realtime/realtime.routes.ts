import crypto from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { authService } from "../auth/auth.service.js";
import { authRepository } from "../auth/auth.repository.js";
import { extractSessionToken } from "../auth/auth.middleware.js";
import { presenceService } from "../presence/presence.service.js";
import { callingService } from "../calling/calling.service.js";
import { AppError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import type { User } from "../../db/schema/index.js";

const MAX_MESSAGE_SIZE_BYTES = 65536; // 64 KB limit

interface WsQuery {
  ticket?: string;
}

// Sliding window rate limiter per user across all their WebSocket connections
const userMessageRateLimits = new Map<string, { count: number; windowStart: number }>();
const WS_RATE_LIMIT_WINDOW_MS = 5000;
const WS_MAX_MESSAGES_PER_WINDOW = 50; // max 10 msgs/sec average

function checkWsRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = userMessageRateLimits.get(userId);
  if (!entry || now - entry.windowStart > WS_RATE_LIMIT_WINDOW_MS) {
    userMessageRateLimits.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= WS_MAX_MESSAGES_PER_WINDOW) {
    return false;
  }
  entry.count++;
  return true;
}

// Clean up stale rate limits and expired WS tickets periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of userMessageRateLimits.entries()) {
    if (now - entry.windowStart > WS_RATE_LIMIT_WINDOW_MS * 2) {
      userMessageRateLimits.delete(userId);
    }
  }
  authService.cleanExpiredWsTickets();
}, 30000).unref();

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  // Start presence background sweep
  presenceService.startSweep();

  app.get<{ Querystring: WsQuery }>(
    "/ws",
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest<{ Querystring: WsQuery }>) => {
      let user: User | null = null;

      try {
        // 1. Authenticate WebSocket upgrade handshake
        // Method A: Check short-lived ticket in query string
        const ticket = request.query?.ticket;
        if (ticket) {
          const userId = authService.consumeWsTicket(ticket);
          if (userId) {
            user = await authRepository.getUserById(userId);
          }
        }

        // Method B: Check session cookie or Authorization header
        if (!user) {
          const sessionToken = extractSessionToken(request);
          if (sessionToken) {
            const authResult = await authService.validateSession(sessionToken);
            user = authResult.user;
          }
        }

        // If authentication failed, reject connection
        if (!user) {
          logger.warn({ ip: request.ip }, "Rejected unauthenticated WebSocket connection");
          socket.send(
            JSON.stringify({
              type: "error",
              error: {
                code: "AUTH_REQUIRED",
                message: "Authentication required to connect to signaling hub",
              },
            })
          );
          socket.close(1008, "Authentication required");
          return;
        }

        const authenticatedUser = user;

        // 2. Register connection with PresenceService
        const connectionId = crypto.randomUUID();
        presenceService.registerConnection(authenticatedUser.id, connectionId, socket, request.ip);

        // Send welcome / connected event
        socket.send(
          JSON.stringify({
            type: "connected",
            payload: {
              userId: authenticatedUser.id,
              walletAddress: authenticatedUser.walletAddress,
              connectionId,
            },
            timestamp: new Date().toISOString(),
          })
        );

        // Check if user reconnected during active call disconnect grace period
        await callingService.handleUserReconnected(authenticatedUser.id);

        // 3. Handle incoming client messages
        socket.on("message", async (data: Buffer | string) => {
          try {
            // Check payload size
            const byteLength = typeof data === "string" ? Buffer.byteLength(data) : data.length;
            if (byteLength > MAX_MESSAGE_SIZE_BYTES) {
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: {
                    code: "MESSAGE_TOO_LARGE",
                    message: "Message exceeds maximum allowed size (64 KB)",
                  },
                })
              );
              return;
            }

            // Check WebSocket rate limit
            if (!checkWsRateLimit(authenticatedUser.id)) {
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: {
                    code: "RATE_LIMITED",
                    message: "Signaling message rate limit exceeded. Please slow down.",
                  },
                })
              );
              return;
            }

            const rawString = data.toString();
            let parsed: any;
            try {
              parsed = JSON.parse(rawString);
            } catch {
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: {
                    code: "MALFORMED_JSON",
                    message: "WebSocket message must be valid JSON",
                  },
                })
              );
              return;
            }

            if (!parsed || typeof parsed !== "object" || !parsed.type) {
              socket.send(
                JSON.stringify({
                  type: "error",
                  error: {
                    code: "INVALID_MESSAGE_FORMAT",
                    message: "Message must contain a valid 'type' property",
                  },
                })
              );
              return;
            }

            // Route events
            switch (parsed.type) {
              case "ping": {
                presenceService.recordHeartbeat(authenticatedUser.id, connectionId);
                socket.send(
                  JSON.stringify({
                    type: "pong",
                    timestamp: new Date().toISOString(),
                  })
                );
                break;
              }

              case "call.accept": {
                const callId = parsed.callId || parsed.payload?.callId;
                if (!callId) throw new AppError("callId is required", 400, "MISSING_CALL_ID");
                await callingService.acceptCall(authenticatedUser, callId);
                break;
              }

              case "call.connected": {
                const callId = parsed.callId || parsed.payload?.callId;
                if (!callId) throw new AppError("callId is required", 400, "MISSING_CALL_ID");
                await callingService.confirmCallConnected(authenticatedUser, callId);
                break;
              }

              case "call.reject": {
                const callId = parsed.callId || parsed.payload?.callId;
                const reason = parsed.reason || parsed.payload?.reason;
                if (!callId) throw new AppError("callId is required", 400, "MISSING_CALL_ID");
                await callingService.rejectCall(authenticatedUser, callId, reason);
                break;
              }

              case "call.cancel": {
                const callId = parsed.callId || parsed.payload?.callId;
                if (!callId) throw new AppError("callId is required", 400, "MISSING_CALL_ID");
                await callingService.cancelCall(authenticatedUser, callId);
                break;
              }

              case "call.end": {
                const callId = parsed.callId || parsed.payload?.callId;
                if (!callId) throw new AppError("callId is required", 400, "MISSING_CALL_ID");
                await callingService.endCall(authenticatedUser, callId);
                break;
              }

              case "webrtc.offer": {
                const callId = parsed.callId || parsed.payload?.callId;
                const sdp = parsed.sdp || parsed.payload?.sdp;
                if (!callId) throw new AppError("callId is required", 400, "MISSING_CALL_ID");
                if (!sdp) throw new AppError("sdp is required", 400, "MISSING_SDP");
                await callingService.relaySignaling(authenticatedUser, callId, "webrtc.offer", { sdp });
                break;
              }

              case "webrtc.answer": {
                const callId = parsed.callId || parsed.payload?.callId;
                const sdp = parsed.sdp || parsed.payload?.sdp;
                if (!callId) throw new AppError("callId is required", 400, "MISSING_CALL_ID");
                if (!sdp) throw new AppError("sdp is required", 400, "MISSING_SDP");
                await callingService.relaySignaling(authenticatedUser, callId, "webrtc.answer", { sdp });
                break;
              }

              case "webrtc.ice-candidate": {
                const callId = parsed.callId || parsed.payload?.callId;
                const candidate = parsed.candidate || parsed.payload?.candidate;
                if (!callId) throw new AppError("callId is required", 400, "MISSING_CALL_ID");
                if (!candidate) throw new AppError("candidate is required", 400, "MISSING_CANDIDATE");
                await callingService.relaySignaling(authenticatedUser, callId, "webrtc.ice-candidate", { candidate });
                break;
              }

              default: {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    error: {
                      code: "UNKNOWN_EVENT_TYPE",
                      message: `Event type '${parsed.type}' is not recognized`,
                    },
                  })
                );
              }
            }
          } catch (err) {
            const error = err instanceof AppError
              ? { code: err.code, message: err.message }
              : { code: "INTERNAL_ERROR", message: "Error processing signaling event" };

            socket.send(
              JSON.stringify({
                type: "error",
                error,
              })
            );
          }
        });

        // 4. Handle socket closure and cleanup
        socket.on("close", async () => {
          presenceService.removeConnection(authenticatedUser.id, connectionId);

          // If user has no more open connections, check if they were in an active call
          if (!presenceService.isUserOnline(authenticatedUser.id)) {
            await callingService.handleUserDisconnected(authenticatedUser.id);
          }
        });

        socket.on("error", (err) => {
          logger.warn({ err, userId: user?.id }, "WebSocket client connection error");
        });
      } catch (err) {
        logger.error({ err }, "Unhandled error during WebSocket connection lifecycle");
        try {
          socket.close(1011, "Internal server error");
        } catch {
          // Ignore
        }
      }
    }
  );
};
