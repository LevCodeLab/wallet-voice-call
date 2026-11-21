import { presenceService, PresenceService } from "../presence/presence.service.js";
import { logger } from "../../shared/logger.js";

export interface OutboundSignalingMessage {
  type: string;
  callId?: string;
  payload?: unknown;
  timestamp?: string;
  error?: {
    code: string;
    message: string;
  };
}

export class SignalingBroadcaster {
  constructor(private readonly presence: PresenceService = presenceService) {}

  /**
   * Send a realtime signaling event to all active connections for a given user
   */
  public sendToUser(userId: string, message: OutboundSignalingMessage): boolean {
    const sockets = this.presence.getUserSockets(userId);
    if (sockets.length === 0) {
      logger.debug({ userId, event: message.type }, "No live sockets to deliver signaling message");
      return false;
    }

    const payload = JSON.stringify({
      ...message,
      timestamp: message.timestamp || new Date().toISOString(),
    });

    let deliveredCount = 0;
    for (const ws of sockets) {
      try {
        ws.send(payload);
        deliveredCount++;
      } catch (err) {
        logger.warn({ err, userId }, "Failed to send WebSocket message to connection");
      }
    }

    logger.debug({ userId, event: message.type, deliveredCount }, "Realtime event broadcast to user connections");
    return deliveredCount > 0;
  }
}

export const signalingBroadcaster = new SignalingBroadcaster();
