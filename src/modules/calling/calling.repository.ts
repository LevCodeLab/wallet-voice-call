import { eq, or, and, inArray, desc, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { callSettings, callSessions, users, activeCallParticipants } from "../../db/schema/index.js";
import type { CallSetting, CallSession, NewCallSession, User } from "../../db/schema/index.js";
import { ConflictError } from "../../shared/errors.js";

export const ACTIVE_CALL_STATES = ["initiated", "ringing", "accepted", "connecting", "connected"] as const;
export type ActiveCallState = (typeof ACTIVE_CALL_STATES)[number];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return typeof id === "string" && UUID_REGEX.test(id);
}

export class CallingRepository {
  /**
   * Find a user by normalized wallet address
   */
  async findUserByWalletAddress(walletAddress: string, network = "evm"): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.walletAddress, walletAddress.toLowerCase()), eq(users.network, network)))
      .limit(1);

    return user || null;
  }

  /**
   * Retrieve calling settings for a user or initialize default (default isAcceptingCalls = false)
   */
  async getOrCreateCallingSettings(userId: string): Promise<CallSetting> {
    const [existing] = await db
      .select()
      .from(callSettings)
      .where(eq(callSettings.userId, userId))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [created] = await db
      .insert(callSettings)
      .values({
        userId,
        isAcceptingCalls: false,
      })
      .onConflictDoNothing()
      .returning();

    if (created) return created;

    // In case of concurrent insert, fetch existing
    const [fallback] = await db
      .select()
      .from(callSettings)
      .where(eq(callSettings.userId, userId))
      .limit(1);

    return fallback;
  }

  /**
   * Update calling settings (toggle isAcceptingCalls)
   */
  async updateCallingSettings(userId: string, isAcceptingCalls: boolean): Promise<CallSetting> {
    // Ensure row exists first
    await this.getOrCreateCallingSettings(userId);

    const [updated] = await db
      .update(callSettings)
      .set({
        isAcceptingCalls,
        updatedAt: new Date(),
      })
      .where(eq(callSettings.userId, userId))
      .returning();

    return updated;
  }

  /**
   * Find any active call involving this user (either as caller or recipient)
   * Guaranteed across both roles via active_call_participants table.
   */
  async findActiveCallForUser(userId: string): Promise<CallSession | null> {
    // 1. Check active_call_participants reservation (O(1) PK lookup)
    const [participant] = await db
      .select()
      .from(activeCallParticipants)
      .where(eq(activeCallParticipants.userId, userId))
      .limit(1);

    if (participant) {
      const session = await this.getCallSessionById(participant.callId);
      if (session && ACTIVE_CALL_STATES.includes(session.state as any)) {
        return session;
      }
      // If session is already terminal, clean up orphaned participant record
      await db.delete(activeCallParticipants).where(eq(activeCallParticipants.userId, userId));
    }

    // 2. Fallback query on callSessions table
    const [active] = await db
      .select()
      .from(callSessions)
      .where(
        and(
          or(eq(callSessions.callerUserId, userId), eq(callSessions.recipientUserId, userId)),
          inArray(callSessions.state, [...ACTIVE_CALL_STATES])
        )
      )
      .limit(1);

    return active || null;
  }

  /**
   * Atomically create a new call session and reserve BOTH participants in active_call_participants.
   * Enforces strictly 1 active call per user across ANY role (caller or recipient) at the DB level.
   */
  async createCallSession(data: NewCallSession): Promise<CallSession> {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(callSessions).values(data).returning();

      try {
        // Reserve both caller and recipient atomically
        await tx.insert(activeCallParticipants).values([
          {
            userId: data.callerUserId,
            callId: created.id,
            role: "caller",
          },
          {
            userId: data.recipientUserId,
            callId: created.id,
            role: "recipient",
          },
        ]);
      } catch (err: any) {
        if (err.code === "23505") {
          // Identify which user is already busy
          const [callerInUse] = await db
            .select({ userId: activeCallParticipants.userId })
            .from(activeCallParticipants)
            .where(eq(activeCallParticipants.userId, data.callerUserId))
            .limit(1);

          const isCaller = Boolean(callerInUse);
          throw new ConflictError(
            isCaller ? "You already have an active call session in progress" : "Recipient is currently busy in another call",
            isCaller ? "CALL_CALLER_BUSY" : "CALL_RECIPIENT_BUSY"
          );
        }
        throw err;
      }

      return created;
    });
  }

  /**
   * Retrieve call session by ID
   */
  async getCallSessionById(callId: string): Promise<CallSession | null> {
    if (!isValidUuid(callId)) return null;

    const [session] = await db
      .select()
      .from(callSessions)
      .where(eq(callSessions.id, callId))
      .limit(1);

    return session || null;
  }

  /**
   * Atomically transition call state from expectedState to newState
   */
  async updateCallState(
    callId: string,
    expectedState: string,
    newState: string,
    updates: Partial<CallSession> = {}
  ): Promise<CallSession | null> {
    if (!isValidUuid(callId)) return null;

    const [updated] = await db
      .update(callSessions)
      .set({
        ...updates,
        state: newState,
        updatedAt: new Date(),
      })
      .where(and(eq(callSessions.id, callId), eq(callSessions.state, expectedState)))
      .returning();

    return updated || null;
  }

  /**
   * Authoritative transition from connecting to connected
   */
  async markCallConnected(callId: string): Promise<CallSession | null> {
    if (!isValidUuid(callId)) return null;

    const now = new Date();
    const [updated] = await db
      .update(callSessions)
      .set({
        state: "connected",
        connectedAt: now,
        updatedAt: now,
      })
      .where(and(eq(callSessions.id, callId), eq(callSessions.state, "connecting")))
      .returning();

    return updated || null;
  }

  /**
   * Atomically transition call state from any of allowedPreviousStates to a terminal state.
   * Accurately calculates elapsed duration if the call was connected.
   * Atomically releases active call participant reservations strictly for this call.
   */
  async updateCallToTerminalState(
    callId: string,
    allowedPreviousStates: string[],
    terminalState: string,
    terminalReason: string
  ): Promise<CallSession | null> {
    const existing = await this.getCallSessionById(callId);
    if (!existing || !allowedPreviousStates.includes(existing.state)) {
      return null;
    }

    const endedAt = new Date();
    let durationSeconds = 0;
    if (existing.connectedAt) {
      durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - existing.connectedAt.getTime()) / 1000));
    }

    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(callSessions)
        .set({
          state: terminalState,
          terminalReason,
          durationSeconds,
          endedAt,
          updatedAt: new Date(),
        })
        .where(and(eq(callSessions.id, callId), inArray(callSessions.state, allowedPreviousStates)))
        .returning();

      if (updated) {
        // Atomically release active call reservations strictly for this callId
        await tx.delete(activeCallParticipants).where(eq(activeCallParticipants.callId, callId));
      }

      return updated || null;
    });
  }

  /**
   * Explicitly release active reservations for a call
   */
  async deleteActiveParticipantsForCall(callId: string): Promise<void> {
    if (!isValidUuid(callId)) return;
    await db.delete(activeCallParticipants).where(eq(activeCallParticipants.callId, callId));
  }

  /**
   * Query paginated call history for a user with deterministic sorting
   */
  async findCallHistory(
    userId: string,
    options: { limit: number; offset: number; direction: "all" | "incoming" | "outgoing" }
  ): Promise<{ calls: CallSession[]; total: number }> {
    const { limit, offset, direction } = options;

    let condition = or(
      eq(callSessions.callerUserId, userId),
      eq(callSessions.recipientUserId, userId)
    );

    if (direction === "incoming") {
      condition = eq(callSessions.recipientUserId, userId);
    } else if (direction === "outgoing") {
      condition = eq(callSessions.callerUserId, userId);
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(callSessions)
      .where(condition);

    // Deterministic sorting with (created_at DESC, id DESC) to prevent page boundary duplication
    const calls = await db
      .select()
      .from(callSessions)
      .where(condition)
      .orderBy(desc(callSessions.createdAt), desc(callSessions.id))
      .limit(limit)
      .offset(offset);

    return {
      calls,
      total: countResult?.count || 0,
    };
  }

  /**
   * Find stale active calls that need recovery sweep
   * Covers all active states: initiated, ringing, accepted, connecting, connected
   */
  async findStaleCalls(options?: { isStartup?: boolean; serverBootTime?: Date }): Promise<CallSession[]> {
    // Startup recovery sweep: recover all calls left active before the current server process started
    if (options?.isStartup && options.serverBootTime) {
      return db
        .select()
        .from(callSessions)
        .where(
          and(
            inArray(callSessions.state, [...ACTIVE_CALL_STATES]),
            lt(callSessions.createdAt, options.serverBootTime)
          )
        );
    }

    // Periodic sweep for ongoing server
    const now = new Date();
    const ringingCutoff = new Date(now.getTime() - 45000); // 45s
    const connectingCutoff = new Date(now.getTime() - 60000); // 60s
    const connectedAbandonedCutoff = new Date(now.getTime() - 120000); // 120s

    return db
      .select()
      .from(callSessions)
      .where(
        or(
          and(
            inArray(callSessions.state, ["initiated", "ringing"]),
            lt(callSessions.createdAt, ringingCutoff)
          ),
          and(
            inArray(callSessions.state, ["accepted", "connecting"]),
            lt(callSessions.updatedAt, connectingCutoff)
          ),
          and(
            eq(callSessions.state, "connected"),
            lt(callSessions.updatedAt, connectedAbandonedCutoff)
          )
        )
      );
  }
}

export const callingRepository = new CallingRepository();

