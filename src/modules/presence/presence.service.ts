import type { WebSocket } from "ws";
import { logger } from "../../shared/logger.js";

export interface ActiveConnection {
  connectionId: string;
  ws: WebSocket;
  lastSeen: number;
  clientIp?: string;
}

export class PresenceService {
  // Map of userId -> Map of connectionId -> ActiveConnection
  private readonly userConnections = new Map<string, Map<string, ActiveConnection>>();
  private readonly heartbeatTtlMs: number;
  private sweepInterval?: NodeJS.Timeout;

  constructor(heartbeatTtlSeconds = 30) {
    this.heartbeatTtlMs = heartbeatTtlSeconds * 1000;
  }

  /**
   * Start periodic stale connection sweep
   */
  public startSweep(intervalMs = 10000): void {
    if (this.sweepInterval) return;

    this.sweepInterval = setInterval(() => {
      this.sweepStaleConnections();
    }, intervalMs);

    // Unref so timer doesn't prevent Node from exiting in tests
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  /**
   * Stop background sweep timer
   */
  public stopSweep(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
  }

  /**
   * Register a new WebSocket connection for an authenticated user
   */
  public registerConnection(
    userId: string,
    connectionId: string,
    ws: WebSocket,
    clientIp?: string
  ): void {
    let connections = this.userConnections.get(userId);
    if (!connections) {
      connections = new Map<string, ActiveConnection>();
      this.userConnections.set(userId, connections);
    }

    connections.set(connectionId, {
      connectionId,
      ws,
      lastSeen: Date.now(),
      clientIp,
    });

    logger.debug({ userId, connectionId }, "User WebSocket connection registered");
  }

  /**
   * Remove a connection (e.g. on socket close)
   */
  public removeConnection(userId: string, connectionId: string): void {
    const connections = this.userConnections.get(userId);
    if (!connections) return;

    connections.delete(connectionId);
    if (connections.size === 0) {
      this.userConnections.delete(userId);
      logger.debug({ userId }, "All user connections closed; user marked offline");
    } else {
      logger.debug({ userId, remainingTabs: connections.size }, "User closed one connection, other tabs remain active");
    }
  }

  /**
   * Update heartbeat timestamp for a specific connection
   */
  public recordHeartbeat(userId: string, connectionId: string): boolean {
    const connections = this.userConnections.get(userId);
    if (!connections) return false;

    const conn = connections.get(connectionId);
    if (!conn) return false;

    conn.lastSeen = Date.now();
    return true;
  }

  /**
   * Check whether a user is currently considered online
   */
  public isUserOnline(userId: string): boolean {
    const connections = this.userConnections.get(userId);
    if (!connections || connections.size === 0) {
      return false;
    }

    const now = Date.now();
    for (const conn of connections.values()) {
      if (now - conn.lastSeen < this.heartbeatTtlMs) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all live WebSocket instances for a user
   */
  public getUserSockets(userId: string): WebSocket[] {
    const connections = this.userConnections.get(userId);
    if (!connections) return [];

    const now = Date.now();
    const liveSockets: WebSocket[] = [];

    for (const conn of connections.values()) {
      if (now - conn.lastSeen < this.heartbeatTtlMs && conn.ws.readyState === 1) {
        liveSockets.push(conn.ws);
      }
    }

    return liveSockets;
  }

  /**
   * Prune stale connections exceeding heartbeat TTL
   */
  public sweepStaleConnections(): number {
    const now = Date.now();
    let prunedCount = 0;

    for (const [userId, connections] of this.userConnections.entries()) {
      for (const [connectionId, conn] of connections.entries()) {
        if (now - conn.lastSeen >= this.heartbeatTtlMs) {
          logger.warn({ userId, connectionId }, "Closing stale WebSocket connection exceeding TTL");
          try {
            conn.ws.terminate();
          } catch {
            // Ignore termination error
          }
          connections.delete(connectionId);
          prunedCount++;
        }
      }

      if (connections.size === 0) {
        this.userConnections.delete(userId);
      }
    }

    return prunedCount;
  }

  /**
   * Clear all connections (useful for tests)
   */
  public clearAll(): void {
    for (const connections of this.userConnections.values()) {
      for (const conn of connections.values()) {
        try {
          conn.ws.terminate();
        } catch {
          // Ignore
        }
      }
    }
    this.userConnections.clear();
  }
}

export const presenceService = new PresenceService();
