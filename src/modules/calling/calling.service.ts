import { isAddress, getAddress } from "viem";
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from "../../shared/errors.js";
import { callingRepository, CallingRepository, ACTIVE_CALL_STATES } from "./calling.repository.js";
import { presenceService, PresenceService } from "../presence/presence.service.js";
import { signalingBroadcaster, SignalingBroadcaster } from "../realtime/signaling.broadcaster.js";
import type { User, CallSession } from "../../db/schema/index.js";
import type {
  CallingProfileResponse,
  CallSessionView,
  CallHistoryQuery,
  CallHistoryResponse,
  CallHistoryItem,
  IceServersResponse,
} from "./calling.schemas.js";
import { logger } from "../../shared/logger.js";
import { env } from "../../config/env.js";

export class CallingService {
  private readonly ringingTimers = new Map<string, NodeJS.Timeout>();
  private readonly disconnectTimers = new Map<string, { timer: NodeJS.Timeout; callId: string }>();
  private recoveryInterval?: NodeJS.Timeout;
  private isSweepRunning = false;
  private readonly ringingTimeoutMs: number;
  private readonly gracePeriodMs: number;

  constructor(
    private readonly repo: CallingRepository = callingRepository,
    private readonly presence: PresenceService = presenceService,
    private readonly broadcaster: SignalingBroadcaster = signalingBroadcaster,
    ringingTimeoutSeconds = 30,
    gracePeriodSeconds = env.DISCONNECT_GRACE_PERIOD_SECONDS || 20
  ) {
    this.ringingTimeoutMs = ringingTimeoutSeconds * 1000;
    this.gracePeriodMs = gracePeriodSeconds * 1000;
  }

  /**
   * Helper to serialize CallSession model to API view
   */
  public toCallSessionView(session: CallSession): CallSessionView {
    return {
      id: session.id,
      callerWallet: session.callerWallet,
      recipientWallet: session.recipientWallet,
      state: session.state,
      terminalReason: session.terminalReason || null,
      durationSeconds: session.durationSeconds ?? 0,
      ringingAt: session.ringingAt ? session.ringingAt.toISOString() : null,
      acceptedAt: session.acceptedAt ? session.acceptedAt.toISOString() : null,
      connectingAt: session.connectingAt ? session.connectingAt.toISOString() : null,
      connectedAt: session.connectedAt ? session.connectedAt.toISOString() : null,
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  /**
   * Return configured STUN and TURN relay servers
   */
  public getIceServers(): IceServersResponse {
    const stunUrls = env.STUN_URLS.split(",").map((s) => s.trim()).filter(Boolean);
    const iceServers: IceServersResponse["iceServers"] = [
      { urls: stunUrls },
    ];

    if (env.TURN_URLS) {
      const turnUrls = env.TURN_URLS.split(",").map((t) => t.trim()).filter(Boolean);
      iceServers.push({
        urls: turnUrls,
        username: env.TURN_USERNAME,
        credential: env.TURN_CREDENTIAL,
      });
    }

    return { iceServers };
  }

  /**
   * Resolve public calling profile for a given wallet address
   */
  async getPublicProfile(walletAddress: string): Promise<CallingProfileResponse> {
    if (!isAddress(walletAddress)) {
      throw new BadRequestError("Invalid EVM wallet address format", "INVALID_WALLET_ADDRESS");
    }

    const normalizedAddress = getAddress(walletAddress).toLowerCase();
    const user = await this.repo.findUserByWalletAddress(normalizedAddress);

    if (!user) {
      throw new NotFoundError(
        "User with specified wallet address has never authenticated with wallet-voice-call",
        "USER_NOT_FOUND"
      );
    }

    const settings = await this.repo.getOrCreateCallingSettings(user.id);
    const isOnline = this.presence.isUserOnline(user.id);
    const activeCall = await this.repo.findActiveCallForUser(user.id);
    const isBusy = activeCall !== null;

    let presenceStatus: "online" | "busy" | "unavailable" | "offline" = "offline";
    if (!isOnline) {
      presenceStatus = "offline";
    } else if (isBusy) {
      presenceStatus = "busy";
    } else if (!settings.isAcceptingCalls) {
      presenceStatus = "unavailable";
    } else {
      presenceStatus = "online";
    }

    const isCallable = isOnline && settings.isAcceptingCalls && !isBusy;

    return {
      walletAddress: user.walletAddress,
      network: user.network,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isOnline,
      isAcceptingCalls: settings.isAcceptingCalls,
      isCallable,
      presenceStatus,
    };
  }

  /**
   * Get calling settings for an authenticated user
   */
  async getSettings(userId: string) {
    const settings = await this.repo.getOrCreateCallingSettings(userId);
    return {
      isAcceptingCalls: settings.isAcceptingCalls,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  /**
   * Update calling settings for an authenticated user
   */
  async updateSettings(userId: string, isAcceptingCalls: boolean) {
    const updated = await this.repo.updateCallingSettings(userId, isAcceptingCalls);
    return {
      isAcceptingCalls: updated.isAcceptingCalls,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Initiate an outgoing call from caller to recipient
   */
  async initiateCall(callerUser: User, rawRecipientAddress: string): Promise<CallSessionView> {
    if (!isAddress(rawRecipientAddress)) {
      throw new BadRequestError("Invalid recipient wallet address format", "INVALID_WALLET_ADDRESS");
    }

    const normalizedRecipient = getAddress(rawRecipientAddress).toLowerCase();
    if (normalizedRecipient === callerUser.walletAddress.toLowerCase()) {
      throw new BadRequestError("Cannot initiate a call to your own wallet address", "CALL_SELF_CALL_PROHIBITED");
    }

    // 1. Ensure caller is not already in an active call
    const callerActive = await this.repo.findActiveCallForUser(callerUser.id);
    if (callerActive) {
      throw new ConflictError(
        "You already have an active call session in progress",
        "CALL_CALLER_BUSY"
      );
    }

    // 2. Resolve recipient user
    const recipientUser = await this.repo.findUserByWalletAddress(normalizedRecipient);
    if (!recipientUser) {
      throw new NotFoundError(
        "Recipient wallet has not registered or authenticated with wallet-voice-call",
        "CALL_RECIPIENT_NOT_FOUND"
      );
    }

    // 3. Verify recipient availability
    const recipientActive = await this.repo.findActiveCallForUser(recipientUser.id);
    if (recipientActive) {
      throw new ConflictError(
        "Recipient is currently busy in another call",
        "CALL_RECIPIENT_BUSY"
      );
    }

    const recipientSettings = await this.repo.getOrCreateCallingSettings(recipientUser.id);
    if (!recipientSettings.isAcceptingCalls) {
      throw new ConflictError(
        "Recipient is currently not accepting incoming calls",
        "CALL_RECIPIENT_UNAVAILABLE"
      );
    }

    const isRecipientOnline = this.presence.isUserOnline(recipientUser.id);
    if (!isRecipientOnline) {
      throw new ConflictError(
        "Recipient is currently offline",
        "CALL_RECIPIENT_OFFLINE"
      );
    }

    // 4. Create call session in 'initiated' state
    const callSession = await this.repo.createCallSession({
      callerUserId: callerUser.id,
      recipientUserId: recipientUser.id,
      callerWallet: callerUser.walletAddress,
      recipientWallet: recipientUser.walletAddress,
      state: "initiated",
    });

    // 5. Alert recipient over WebSocket
    const delivered = this.broadcaster.sendToUser(recipientUser.id, {
      type: "call.incoming",
      callId: callSession.id,
      payload: {
        callId: callSession.id,
        caller: {
          walletAddress: callerUser.walletAddress,
          displayName: callerUser.displayName,
          avatarUrl: callerUser.avatarUrl,
        },
      },
    });

    if (!delivered) {
      // Failed to alert recipient; mark failed immediately
      const failed = await this.repo.updateCallToTerminalState(
        callSession.id,
        ["initiated"],
        "failed",
        "recipient_signaling_unreachable"
      );
      throw new ConflictError(
        "Recipient could not be alerted via realtime signaling",
        "CALL_RECIPIENT_UNREACHABLE"
      );
    }

    // 6. Transition call to 'ringing'
    const ringingSession = await this.repo.updateCallState(
      callSession.id,
      "initiated",
      "ringing",
      { ringingAt: new Date() }
    );

    const activeSession = ringingSession || callSession;

    // 7. Schedule server-authoritative 30s ringing timeout
    this.scheduleRingingTimeout(activeSession.id, callerUser.id, recipientUser.id);

    return this.toCallSessionView(activeSession);
  }

  /**
   * Schedule server-authoritative timeout for ringing calls
   */
  private scheduleRingingTimeout(callId: string, callerId: string, recipientId: string): void {
    this.clearRingingTimer(callId);

    const timer = setTimeout(async () => {
      try {
        const missedSession = await this.repo.updateCallToTerminalState(
          callId,
          ["ringing"],
          "missed",
          "ringing_timeout"
        );

        if (missedSession) {
          logger.info({ callId }, "Call ringing timeout reached; transitioned to missed");
          const stateMessage = {
            type: "call.state",
            callId,
            payload: {
              state: "missed",
              terminalReason: "ringing_timeout",
            },
          };
          this.broadcaster.sendToUser(callerId, stateMessage);
          this.broadcaster.sendToUser(recipientId, stateMessage);
        }
      } catch (err) {
        logger.error({ err, callId }, "Error processing ringing timeout");
      } finally {
        this.ringingTimers.delete(callId);
      }
    }, this.ringingTimeoutMs);

    if (timer.unref) {
      timer.unref();
    }

    this.ringingTimers.set(callId, timer);
  }

  private clearRingingTimer(callId: string): void {
    const timer = this.ringingTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.ringingTimers.delete(callId);
    }
  }

  /**
   * Recipient accepts incoming call
   */
  async acceptCall(recipientUser: User, callId: string): Promise<CallSessionView> {
    const session = await this.repo.getCallSessionById(callId);
    if (!session) {
      throw new NotFoundError("Call session not found", "CALL_NOT_FOUND");
    }

    if (session.recipientUserId !== recipientUser.id) {
      throw new ForbiddenError("Only the recipient can accept an incoming call", "CALL_NOT_RECIPIENT");
    }

    this.clearRingingTimer(callId);

    // Atomically transition from 'ringing' to 'connecting'
    const now = new Date();
    const updated = await this.repo.updateCallState(callId, "ringing", "connecting", {
      acceptedAt: now,
      connectingAt: now,
    });

    if (!updated) {
      throw new ConflictError(
        `Cannot accept call in current state (${session.state})`,
        "CALL_STATE_CONFLICT"
      );
    }

    // Broadcast state update to both parties
    const stateMessage = {
      type: "call.state",
      callId,
      payload: {
        state: "connecting",
        acceptedAt: now.toISOString(),
      },
    };
    this.broadcaster.sendToUser(session.callerUserId, stateMessage);
    this.broadcaster.sendToUser(session.recipientUserId, stateMessage);

    return this.toCallSessionView(updated);
  }

  /**
   * Recipient rejects incoming call
   */
  async rejectCall(recipientUser: User, callId: string, reason?: string): Promise<CallSessionView> {
    const session = await this.repo.getCallSessionById(callId);
    if (!session) {
      throw new NotFoundError("Call session not found", "CALL_NOT_FOUND");
    }

    if (session.recipientUserId !== recipientUser.id) {
      throw new ForbiddenError("Only the recipient can reject an incoming call", "CALL_NOT_RECIPIENT");
    }

    this.clearRingingTimer(callId);

    const terminalReason = reason || "rejected_by_recipient";
    const updated = await this.repo.updateCallToTerminalState(
      callId,
      ["ringing", "initiated"],
      "rejected",
      terminalReason
    );

    if (!updated) {
      throw new ConflictError(
        `Cannot reject call in current state (${session.state})`,
        "CALL_STATE_CONFLICT"
      );
    }

    const stateMessage = {
      type: "call.state",
      callId,
      payload: {
        state: "rejected",
        terminalReason,
      },
    };
    this.broadcaster.sendToUser(session.callerUserId, stateMessage);
    this.broadcaster.sendToUser(session.recipientUserId, stateMessage);

    return this.toCallSessionView(updated);
  }

  /**
   * Caller cancels outgoing call before it has connected
   */
  async cancelCall(callerUser: User, callId: string): Promise<CallSessionView> {
    const session = await this.repo.getCallSessionById(callId);
    if (!session) {
      throw new NotFoundError("Call session not found", "CALL_NOT_FOUND");
    }

    if (session.callerUserId !== callerUser.id) {
      throw new ForbiddenError("Only the caller can cancel an outgoing call", "CALL_NOT_CALLER");
    }

    this.clearRingingTimer(callId);

    const terminalReason = "cancelled_by_caller";
    const updated = await this.repo.updateCallToTerminalState(
      callId,
      ["initiated", "ringing", "accepted", "connecting"],
      "cancelled",
      terminalReason
    );

    if (!updated) {
      throw new ConflictError(
        `Cannot cancel call in current state (${session.state})`,
        "CALL_STATE_CONFLICT"
      );
    }

    const stateMessage = {
      type: "call.state",
      callId,
      payload: {
        state: "cancelled",
        terminalReason,
      },
    };
    this.broadcaster.sendToUser(session.callerUserId, stateMessage);
    this.broadcaster.sendToUser(session.recipientUserId, stateMessage);

    return this.toCallSessionView(updated);
  }

  /**
   * Either participant ends an active call
   */
  async endCall(user: User, callId: string): Promise<CallSessionView> {
    const session = await this.repo.getCallSessionById(callId);
    if (!session) {
      throw new NotFoundError("Call session not found", "CALL_NOT_FOUND");
    }

    if (session.callerUserId !== user.id && session.recipientUserId !== user.id) {
      throw new ForbiddenError("Only call participants can end a call", "CALL_NOT_PARTICIPANT");
    }

    this.clearRingingTimer(callId);

    const terminalReason = "normal_clearing";
    const updated = await this.repo.updateCallToTerminalState(
      callId,
      [...ACTIVE_CALL_STATES],
      "ended",
      terminalReason
    );

    if (!updated) {
      throw new ConflictError(
        `Call is already in terminal state (${session.state})`,
        "CALL_STATE_TERMINAL"
      );
    }

    const stateMessage = {
      type: "call.state",
      callId,
      payload: {
        state: "ended",
        terminalReason,
      },
    };
    this.broadcaster.sendToUser(session.callerUserId, stateMessage);
    this.broadcaster.sendToUser(session.recipientUserId, stateMessage);

    return this.toCallSessionView(updated);
  }

  /**
   * Relay WebRTC signaling (SDP offer/answer, ICE candidates) between authorized participants
   */
  async relaySignaling(
    user: User,
    callId: string,
    eventType: "webrtc.offer" | "webrtc.answer" | "webrtc.ice-candidate",
    payload: unknown
  ): Promise<boolean> {
    const session = await this.repo.getCallSessionById(callId);
    if (!session) {
      throw new NotFoundError("Call session not found", "CALL_NOT_FOUND");
    }

    if (session.callerUserId !== user.id && session.recipientUserId !== user.id) {
      throw new ForbiddenError("Not authorized to send signaling for this call", "CALL_NOT_PARTICIPANT");
    }

    // Only allow signaling during connecting or connected states
    if (session.state !== "connecting" && session.state !== "connected") {
      throw new ConflictError(
        `Cannot relay signaling when call is in ${session.state} state`,
        "CALL_STATE_NOT_SIGNALING"
      );
    }

    const counterpartyUserId = session.callerUserId === user.id ? session.recipientUserId : session.callerUserId;

    return this.broadcaster.sendToUser(counterpartyUserId, {
      type: eventType,
      callId,
      payload,
    });
  }

  /**
   * Retrieve state of a call for an authorized participant
   */
  async getCallSession(user: User, callId: string): Promise<CallSessionView> {
    const session = await this.repo.getCallSessionById(callId);
    if (!session) {
      throw new NotFoundError("Call session not found", "CALL_NOT_FOUND");
    }

    if (session.callerUserId !== user.id && session.recipientUserId !== user.id) {
      throw new ForbiddenError("You are not an authorized participant in this call", "CALL_NOT_PARTICIPANT");
    }

    return this.toCallSessionView(session);
  }

  /**
   * Authoritative client-to-server confirmation of successful WebRTC connection
   */
  async confirmCallConnected(user: User, callId: string): Promise<CallSessionView> {
    const session = await this.repo.getCallSessionById(callId);
    if (!session) {
      throw new NotFoundError("Call session not found", "CALL_NOT_FOUND");
    }

    if (session.callerUserId !== user.id && session.recipientUserId !== user.id) {
      throw new ForbiddenError("Not authorized to confirm connection for this call", "CALL_NOT_PARTICIPANT");
    }

    // Idempotent if already connected
    if (session.state === "connected") {
      return this.toCallSessionView(session);
    }

    if (session.state !== "connecting") {
      throw new ConflictError(
        `Cannot confirm connection for call in ${session.state} state`,
        "CALL_STATE_NOT_CONNECTING"
      );
    }

    this.clearRingingTimer(callId);
    this.clearDisconnectTimer(user.id);

    const updated = await this.repo.markCallConnected(callId);
    if (!updated) {
      throw new ConflictError("Call could not be transitioned to connected", "CALL_STATE_CONFLICT");
    }

    logger.info({ callId, userId: user.id }, "Authoritative call connection established");

    const stateMessage = {
      type: "call.state",
      callId,
      payload: {
        state: "connected",
        connectedAt: updated.connectedAt!.toISOString(),
      },
    };

    this.broadcaster.sendToUser(session.callerUserId, stateMessage);
    this.broadcaster.sendToUser(session.recipientUserId, stateMessage);

    return this.toCallSessionView(updated);
  }

  /**
   * Paginated call history with direction, counterparty details, and duration
   */
  async getCallHistory(user: User, query: CallHistoryQuery): Promise<CallHistoryResponse> {
    const result = await this.repo.findCallHistory(user.id, query);

    const formattedCalls: CallHistoryItem[] = await Promise.all(
      result.calls.map(async (call) => {
        const isIncoming = call.recipientUserId === user.id;
        const counterpartyWallet = isIncoming ? call.callerWallet : call.recipientWallet;

        let counterpartyDisplayName: string | null = null;
        let counterpartyAvatarUrl: string | null = null;

        try {
          const counterpartyUser = await this.repo.findUserByWalletAddress(counterpartyWallet);
          if (counterpartyUser) {
            counterpartyDisplayName = counterpartyUser.displayName;
            counterpartyAvatarUrl = counterpartyUser.avatarUrl;
          }
        } catch {}

        return {
          id: call.id,
          callerWallet: call.callerWallet,
          recipientWallet: call.recipientWallet,
          direction: isIncoming ? ("incoming" as const) : ("outgoing" as const),
          counterpartyWallet,
          counterpartyDisplayName,
          counterpartyAvatarUrl,
          state: call.state,
          terminalReason: call.terminalReason || null,
          durationSeconds: call.durationSeconds ?? 0,
          createdAt: call.createdAt.toISOString(),
          ringingAt: call.ringingAt ? call.ringingAt.toISOString() : null,
          acceptedAt: call.acceptedAt ? call.acceptedAt.toISOString() : null,
          connectingAt: call.connectingAt ? call.connectingAt.toISOString() : null,
          connectedAt: call.connectedAt ? call.connectedAt.toISOString() : null,
          endedAt: call.endedAt ? call.endedAt.toISOString() : null,
        };
      })
    );

    return {
      calls: formattedCalls,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + query.limit < result.total,
    };
  }

  /**
   * Sweep stale calls across all nonterminal states (initiated, ringing, accepted, connecting, connected)
   * to release active_call_participants reservations and transition sessions cleanly.
   */
  public async recoverStaleCalls(options?: { isStartup?: boolean; serverBootTime?: Date }): Promise<number> {
    if (this.isSweepRunning) return 0;
    this.isSweepRunning = true;

    try {
      const staleCalls = await this.repo.findStaleCalls(options);
      if (staleCalls.length === 0) return 0;

      let recovered = 0;
      const isStartup = options?.isStartup ?? false;

      for (const call of staleCalls) {
        if (call.state === "initiated" || call.state === "ringing") {
          const reason = isStartup ? "server_restart_recovery" : "ringing_timeout";
          const updated = await this.repo.updateCallToTerminalState(
            call.id,
            ["initiated", "ringing"],
            "missed",
            reason
          );
          if (updated) {
            this.clearRingingTimer(call.id);
            const stateMessage = {
              type: "call.state",
              callId: call.id,
              payload: { state: "missed", terminalReason: reason },
            };
            this.broadcaster.sendToUser(call.callerUserId, stateMessage);
            this.broadcaster.sendToUser(call.recipientUserId, stateMessage);
            recovered++;
          }
        } else if (call.state === "accepted" || call.state === "connecting") {
          const reason = isStartup ? "server_restart_recovery" : "connecting_timeout";
          const updated = await this.repo.updateCallToTerminalState(
            call.id,
            ["accepted", "connecting"],
            "failed",
            reason
          );
          if (updated) {
            const stateMessage = {
              type: "call.state",
              callId: call.id,
              payload: { state: "failed", terminalReason: reason },
            };
            this.broadcaster.sendToUser(call.callerUserId, stateMessage);
            this.broadcaster.sendToUser(call.recipientUserId, stateMessage);
            recovered++;
          }
        } else if (call.state === "connected") {
          const reason = isStartup ? "server_restart_recovery" : "peer_disconnected";
          const updated = await this.repo.updateCallToTerminalState(
            call.id,
            ["connected"],
            "ended",
            reason
          );
          if (updated) {
            const stateMessage = {
              type: "call.state",
              callId: call.id,
              payload: { state: "ended", terminalReason: reason },
            };
            this.broadcaster.sendToUser(call.callerUserId, stateMessage);
            this.broadcaster.sendToUser(call.recipientUserId, stateMessage);
            recovered++;
          }
        }
      }

      if (recovered > 0) {
        logger.info({ count: recovered, isStartup }, "Recovered stale active calls to terminal states");
      }
      return recovered;
    } catch (err) {
      logger.error({ err }, "Error running stale call recovery sweep");
      return 0;
    } finally {
      this.isSweepRunning = false;
    }
  }

  public startRecoverySweep(intervalMs = 15000): void {
    if (this.recoveryInterval) return;
    this.recoveryInterval = setInterval(() => {
      this.recoverStaleCalls();
    }, intervalMs);
    if (this.recoveryInterval.unref) {
      this.recoveryInterval.unref();
    }
  }

  public stopRecoverySweep(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = undefined;
    }
  }

  /**
   * Handle user disconnection with grace period before terminating calls
   */
  async handleUserDisconnected(userId: string): Promise<void> {
    const active = await this.repo.findActiveCallForUser(userId);
    if (!active) return;

    logger.info({ userId, callId: active.id, state: active.state }, "Active call participant disconnected");

    if (active.state === "ringing" || active.state === "initiated") {
      this.clearRingingTimer(active.id);
      const terminalState = active.callerUserId === userId ? "cancelled" : "failed";
      const terminalReason = "peer_disconnected";
      const updated = await this.repo.updateCallToTerminalState(
        active.id,
        ["initiated", "ringing"],
        terminalState,
        terminalReason
      );

      if (updated) {
        const counterparty = active.callerUserId === userId ? active.recipientUserId : active.callerUserId;
        this.broadcaster.sendToUser(counterparty, {
          type: "call.state",
          callId: active.id,
          payload: { state: terminalState, terminalReason },
        });
      }
    } else if (active.state === "connecting" || active.state === "connected") {
      const counterparty = active.callerUserId === userId ? active.recipientUserId : active.callerUserId;

      // Notify counterparty that user is reconnecting
      this.broadcaster.sendToUser(counterparty, {
        type: "call.reconnecting",
        callId: active.id,
        payload: {
          disconnectedUserId: userId,
          gracePeriodSeconds: Math.floor(this.gracePeriodMs / 1000),
        },
      });

      this.clearDisconnectTimer(userId);

      const timer = setTimeout(async () => {
        try {
          if (!this.presence.isUserOnline(userId)) {
            logger.info({ userId, callId: active.id }, "Disconnection grace period expired; terminating call");
            const updated = await this.repo.updateCallToTerminalState(
              active.id,
              ["connecting", "connected"],
              "ended",
              "peer_disconnected"
            );

            if (updated) {
              this.broadcaster.sendToUser(counterparty, {
                type: "call.state",
                callId: active.id,
                payload: { state: "ended", terminalReason: "peer_disconnected" },
              });
            }
          }
        } catch (err) {
          logger.error({ err, userId, callId: active.id }, "Error terminating call on disconnect grace timeout");
        } finally {
          this.disconnectTimers.delete(userId);
        }
      }, this.gracePeriodMs);

      if (timer.unref) {
        timer.unref();
      }

      this.disconnectTimers.set(userId, { timer, callId: active.id });
    }
  }

  /**
   * Handle user reconnection during grace period
   */
  async handleUserReconnected(userId: string): Promise<void> {
    const entry = this.disconnectTimers.get(userId);
    if (entry) {
      clearTimeout(entry.timer);
      this.disconnectTimers.delete(userId);

      const active = await this.repo.getCallSessionById(entry.callId);
      if (active && (active.state === "connecting" || active.state === "connected")) {
        const counterparty = active.callerUserId === userId ? active.recipientUserId : active.callerUserId;
        logger.info({ userId, callId: active.id }, "User reconnected within grace period; active call restored");
        this.broadcaster.sendToUser(counterparty, {
          type: "call.reconnected",
          callId: active.id,
          payload: { reconnectedUserId: userId },
        });
      }
    }
  }

  private clearDisconnectTimer(userId: string): void {
    const entry = this.disconnectTimers.get(userId);
    if (entry) {
      clearTimeout(entry.timer);
      this.disconnectTimers.delete(userId);
    }
  }
}

export const callingService = new CallingService();
