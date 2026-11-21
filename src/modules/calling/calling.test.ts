import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import WebSocket from "ws";
import { buildApp } from "../../app.js";
import { closeDb, db, checkDbConnection } from "../../db/index.js";
import { users, authNonces, callSettings, callSessions, activeCallParticipants } from "../../db/schema/index.js";
import { authService } from "../auth/auth.service.js";
import { presenceService } from "../presence/presence.service.js";
import { callingService } from "./calling.service.js";
import { eq, or } from "drizzle-orm";

const hasDb = await checkDbConnection();

describe.skipIf(!hasDb)("Phase 2: Calling Identity, Availability & Lifecycle Tests", () => {
  let app: FastifyInstance;
  let serverPort: number;

  // Alice (Caller)
  const aliceKey = generatePrivateKey();
  const aliceAccount = privateKeyToAccount(aliceKey);
  const aliceWallet = aliceAccount.address;
  let aliceSessionToken: string;
  let aliceUser: any;

  // Bob (Recipient)
  const bobKey = generatePrivateKey();
  const bobAccount = privateKeyToAccount(bobKey);
  const bobWallet = bobAccount.address;
  let bobSessionToken: string;
  let bobUser: any;

  // Charlie (Third Party for Cross-Role Tests)
  const charlieKey = generatePrivateKey();
  const charlieAccount = privateKeyToAccount(charlieKey);
  const charlieWallet = charlieAccount.address;
  let charlieSessionToken: string;
  let charlieUser: any;

  // Helper to authenticate an account
  async function authenticateWallet(account: any) {
    const nonceRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/nonce",
      payload: { walletAddress: account.address, network: "evm" },
    });
    const { nonce, domain } = JSON.parse(nonceRes.body);

    const message = `Sign in to wallet-voice-call (${domain}) to authenticate your wallet identity. nonce: ${nonce}`;
    const signature = await account.signMessage({ message });

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: {
        walletAddress: account.address,
        network: "evm",
        message,
        signature,
      },
    });

    return JSON.parse(verifyRes.body);
  }

  beforeAll(async () => {
    app = buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as any;
    serverPort = address.port;

    // Clean up
    await db.delete(activeCallParticipants);
    await db.delete(callSessions);
    await db.delete(callSettings);
    await db.delete(authNonces);
    await db.delete(users);

    // Authenticate Alice, Bob, and Charlie
    const aliceAuth = await authenticateWallet(aliceAccount);
    aliceSessionToken = aliceAuth.sessionToken;
    aliceUser = aliceAuth.user;

    const bobAuth = await authenticateWallet(bobAccount);
    bobSessionToken = bobAuth.sessionToken;
    bobUser = bobAuth.user;

    const charlieAuth = await authenticateWallet(charlieAccount);
    charlieSessionToken = charlieAuth.sessionToken;
    charlieUser = charlieAuth.user;
  });

  afterAll(async () => {
    presenceService.stopSweep();
    presenceService.clearAll();
    await app.close();
  });

  beforeEach(async () => {
    presenceService.clearAll();
    await db.delete(activeCallParticipants);
    await db.delete(callSessions);
  });

  describe("1. Calling Identity Resolution & Settings", () => {
    it("GET /api/v1/users/:address/profile should return 404 for an unregistered wallet", async () => {
      const randomWallet = "0x000000000000000000000000000000000000dEaD";
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/users/${randomWallet}/profile`,
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("USER_NOT_FOUND");
    });

    it("GET /api/v1/users/:address/profile should resolve profile with offline/unavailable status initially", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/users/${bobWallet}/profile`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.walletAddress).toBe(bobWallet.toLowerCase());
      expect(body.isOnline).toBe(false);
      expect(body.isAcceptingCalls).toBe(false); // Default is false
      expect(body.isCallable).toBe(false);
      expect(body.presenceStatus).toBe("offline");
    });

    it("PATCH /api/v1/users/me/calling-settings should reject unauthenticated requests", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        payload: { isAcceptingCalls: true },
      });

      expect(res.statusCode).toBe(401);
    });

    it("PATCH /api/v1/users/me/calling-settings should toggle incoming call availability", async () => {
      // Bob enables incoming calls
      const patchRes = await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });

      expect(patchRes.statusCode).toBe(200);
      const patchBody = JSON.parse(patchRes.body);
      expect(patchBody.isAcceptingCalls).toBe(true);

      // Verify settings GET endpoint
      const getRes = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.body).isAcceptingCalls).toBe(true);
    });

    it("Profile should accurately reflect presence states (offline, unavailable, online, busy)", async () => {
      // 1. Bob is offline, accepting calls = true -> presenceStatus = 'offline'
      let profileRes = await app.inject({
        method: "GET",
        url: `/api/v1/users/${bobWallet}/profile`,
      });
      expect(JSON.parse(profileRes.body).presenceStatus).toBe("offline");

      // 2. Mock Bob connected -> isOnline = true, isCallable = true -> presenceStatus = 'online'
      const mockWs = { send: () => {}, readyState: 1, terminate: () => {} } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob-1", mockWs);

      profileRes = await app.inject({
        method: "GET",
        url: `/api/v1/users/${bobWallet}/profile`,
      });
      let body = JSON.parse(profileRes.body);
      expect(body.isOnline).toBe(true);
      expect(body.isAcceptingCalls).toBe(true);
      expect(body.isCallable).toBe(true);
      expect(body.presenceStatus).toBe("online");

      // 3. Bob disables incoming calls -> presenceStatus = 'unavailable'
      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: false },
      });

      profileRes = await app.inject({
        method: "GET",
        url: `/api/v1/users/${bobWallet}/profile`,
      });
      body = JSON.parse(profileRes.body);
      expect(body.isOnline).toBe(true);
      expect(body.isAcceptingCalls).toBe(false);
      expect(body.isCallable).toBe(false);
      expect(body.presenceStatus).toBe("unavailable");

      // Reset Bob accepting calls = true
      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });
    });
  });

  describe("2. Call Lifecycle State Machine & Protection", () => {
    beforeEach(async () => {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });
    });
    it("POST /api/v1/calls should reject self-calling", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: aliceWallet },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).code).toBe("CALL_SELF_CALL_PROHIBITED");
    });

    it("POST /api/v1/calls should reject call if recipient is offline", async () => {
      presenceService.clearAll(); // Ensure offline

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).code).toBe("CALL_RECIPIENT_OFFLINE");
    });

    it("POST /api/v1/calls should initiate call, notify recipient, and set state to ringing", async () => {
      // Bob is online and connected
      const receivedMessages: any[] = [];
      const mockBobWs = {
        send: (msg: string) => { receivedMessages.push(JSON.parse(msg)); },
        readyState: 1,
        terminate: () => {},
      } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob", mockBobWs);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });

      expect(res.statusCode).toBe(201);
      const call = JSON.parse(res.body);
      expect(call.state).toBe("ringing");
      expect(call.callerWallet).toBe(aliceWallet.toLowerCase());
      expect(call.recipientWallet).toBe(bobWallet.toLowerCase());

      // Verify Bob received call.incoming event
      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
      const incomingEvent = receivedMessages.find((m) => m.type === "call.incoming");
      expect(incomingEvent).toBeDefined();
      expect(incomingEvent.callId).toBe(call.id);
      expect(incomingEvent.payload.caller.walletAddress).toBe(aliceWallet.toLowerCase());
    });

    it("One active call per user policy: should reject concurrent outgoing or incoming call attempts", async () => {
      // Bob is online
      const mockBobWs = { send: () => {}, readyState: 1, terminate: () => {} } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob", mockBobWs);

      // 1. Alice calls Bob -> call is ringing
      const callRes1 = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      expect(callRes1.statusCode).toBe(201);
      const call1 = JSON.parse(callRes1.body);

      // 2. Alice attempts to initiate a second call while call1 is active -> CALL_CALLER_BUSY
      const callRes2 = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      expect(callRes2.statusCode).toBe(409);
      expect(JSON.parse(callRes2.body).code).toBe("CALL_CALLER_BUSY");

      // 3. Clean up call1
      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call1.id}/cancel`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
    });

    it("Accept Call: Only recipient can accept; transitions to connecting", async () => {
      const mockBobWs = { send: () => {}, readyState: 1, terminate: () => {} } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob", mockBobWs);

      // 1. Alice calls Bob
      const initRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      const call = JSON.parse(initRes.body);

      // 2. Caller (Alice) attempts to accept her own call -> 403 Forbidden
      const aliceAcceptRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/accept`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      expect(aliceAcceptRes.statusCode).toBe(403);
      expect(JSON.parse(aliceAcceptRes.body).code).toBe("CALL_NOT_RECIPIENT");

      // 3. Recipient (Bob) accepts call -> 200 OK, transitions to connecting
      const bobAcceptRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/accept`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      expect(bobAcceptRes.statusCode).toBe(200);
      const acceptedCall = JSON.parse(bobAcceptRes.body);
      expect(acceptedCall.state).toBe("connecting");
      expect(acceptedCall.acceptedAt).toBeDefined();
    });

    it("Reject Call: Only recipient can reject; sets state to rejected", async () => {
      const mockBobWs = { send: () => {}, readyState: 1, terminate: () => {} } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob", mockBobWs);

      const initRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      const call = JSON.parse(initRes.body);

      // Bob rejects call
      const rejectRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/reject`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { reason: "busy_in_meeting" },
      });
      expect(rejectRes.statusCode).toBe(200);
      const rejectedCall = JSON.parse(rejectRes.body);
      expect(rejectedCall.state).toBe("rejected");
      expect(rejectedCall.terminalReason).toBe("busy_in_meeting");

      // Attempting to accept a rejected call must fail
      const reAcceptRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/accept`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      expect(reAcceptRes.statusCode).toBe(409);
    });

    it("Cancel Call: Only caller can cancel; sets state to cancelled", async () => {
      const mockBobWs = { send: () => {}, readyState: 1, terminate: () => {} } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob", mockBobWs);

      const initRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      const call = JSON.parse(initRes.body);

      // Bob attempts to cancel -> 403 Forbidden
      const bobCancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/cancel`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      expect(bobCancelRes.statusCode).toBe(403);

      // Alice cancels
      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/cancel`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      expect(cancelRes.statusCode).toBe(200);
      const cancelledCall = JSON.parse(cancelRes.body);
      expect(cancelledCall.state).toBe("cancelled");
      expect(cancelledCall.terminalReason).toBe("cancelled_by_caller");
    });

    it("End Call: Active call can be terminated by either party", async () => {
      const mockBobWs = { send: () => {}, readyState: 1, terminate: () => {} } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob", mockBobWs);

      const initRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      const call = JSON.parse(initRes.body);

      // Recipient accepts
      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/accept`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });

      // Alice ends call
      const endRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/end`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      expect(endRes.statusCode).toBe(200);
      const endedCall = JSON.parse(endRes.body);
      expect(endedCall.state).toBe("ended");
      expect(endedCall.terminalReason).toBe("normal_clearing");
    });
  });

  describe("3. Realtime WebSocket Transport & Ticket Auth", () => {
    beforeEach(async () => {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });
    });
    it("WebSocket upgrade should reject unauthenticated connection", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);

      const [closeCode, closeReason] = await new Promise<[number, string]>((resolve) => {
        ws.on("close", (code, reason) => {
          resolve([code, reason.toString()]);
        });
      });

      expect(closeCode).toBe(1008);
      expect(closeReason).toContain("Authentication required");
    });

    it("WebSocket upgrade should succeed using single-use ws-ticket", async () => {
      // 1. Get ticket
      const ticketRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/ws-ticket",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      expect(ticketRes.statusCode).toBe(200);
      const { ticket } = JSON.parse(ticketRes.body);

      // 2. Connect with ticket
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${ticket}`);

      const firstMessage = await new Promise<any>((resolve) => {
        ws.on("message", (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(firstMessage.type).toBe("connected");
      expect(firstMessage.payload.walletAddress).toBe(aliceWallet.toLowerCase());

      // 3. Reusing the same single-use ticket must fail
      const reusedWs = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${ticket}`);
      const [reusedCode] = await new Promise<[number, string]>((resolve) => {
        reusedWs.on("close", (code, reason) => {
          resolve([code, reason.toString()]);
        });
      });
      expect(reusedCode).toBe(1008);

      ws.close();
    });

    it("WebSocket should reply to ping with pong", async () => {
      const ticketRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/ws-ticket",
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      const { ticket } = JSON.parse(ticketRes.body);

      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${ticket}`);

      await new Promise<void>((resolve) => {
        ws.once("message", () => resolve()); // Skip connected event
      });

      ws.send(JSON.stringify({ type: "ping" }));

      const pongMessage = await new Promise<any>((resolve) => {
        ws.once("message", (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(pongMessage.type).toBe("pong");
      expect(pongMessage.timestamp).toBeDefined();

      ws.close();
    });

    it("WebSocket WebRTC signaling relay should forward SDP/ICE only to counterparty", async () => {
      // Connect Bob via WebSocket
      const bobTicketRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/ws-ticket",
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      const { ticket: bobTicket } = JSON.parse(bobTicketRes.body);
      const bobWs = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${bobTicket}`);
      await new Promise<void>((resolve) => bobWs.once("message", () => resolve()));

      // Connect Alice via WebSocket
      const aliceTicketRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/ws-ticket",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      const { ticket: aliceTicket } = JSON.parse(aliceTicketRes.body);
      const aliceWs = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${aliceTicket}`);
      await new Promise<void>((resolve) => aliceWs.once("message", () => resolve()));

      // Alice initiates call to Bob
      const initRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      const call = JSON.parse(initRes.body);

      // Bob accepts call via WebSocket
      bobWs.send(JSON.stringify({ type: "call.accept", callId: call.id }));

      // Wait for call.state connecting event on Alice's socket
      const aliceReceivedEvent = await new Promise<any>((resolve) => {
        aliceWs.on("message", (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "call.state" && parsed.payload?.state === "connecting") {
            resolve(parsed);
          }
        });
      });
      expect(aliceReceivedEvent.payload.state).toBe("connecting");

      // Alice sends webrtc.offer over WebSocket
      aliceWs.send(
        JSON.stringify({
          type: "webrtc.offer",
          callId: call.id,
          sdp: "v=0\r\no=alice 12345 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n",
        })
      );

      // Bob should receive the relayed webrtc.offer
      const bobOffer = await new Promise<any>((resolve) => {
        bobWs.on("message", (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "webrtc.offer") {
            resolve(parsed);
          }
        });
      });

      expect(bobOffer.callId).toBe(call.id);
      expect(bobOffer.payload.sdp).toContain("alice");

      aliceWs.close();
      bobWs.close();
    });
  });

  describe("Phase 5 — Authoritative Lifecycle, Duration, History & Recovery", () => {
    it("should return dynamic ICE servers for authenticated users", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/webrtc/ice-servers",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(Array.isArray(data.iceServers)).toBe(true);
      expect(data.iceServers.length).toBeGreaterThan(0);
      expect(data.iceServers[0].urls).toBeDefined();
    });

    it("should support authoritative connection confirmation and accurate duration calculation", async () => {
      // 1. Ensure Bob is online and accepting calls
      const mockBobWs = {
        send: () => {},
        readyState: 1,
        terminate: () => {},
      } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob-test-1", mockBobWs);

      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });

      // 2. Alice calls Bob
      const initRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      expect(initRes.statusCode).toBe(201);
      const call = JSON.parse(initRes.body);

      // 3. Bob accepts call
      const acceptRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/accept`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      expect(acceptRes.statusCode).toBe(200);
      const acceptedCall = JSON.parse(acceptRes.body);
      expect(acceptedCall.state).toBe("connecting");
      expect(acceptedCall.connectedAt).toBeNull();

      // 4. Client confirms WebRTC connection established
      const confirmRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/connected`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      expect(confirmRes.statusCode).toBe(200);
      const connectedCall = JSON.parse(confirmRes.body);
      expect(connectedCall.state).toBe("connected");
      expect(connectedCall.connectedAt).not.toBeNull();

      // 5. Ending the call sets durationSeconds accurately
      const endRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/end`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      expect(endRes.statusCode).toBe(200);
      const endedCall = JSON.parse(endRes.body);
      expect(endedCall.state).toBe("ended");
      expect(typeof endedCall.durationSeconds).toBe("number");
      expect(endedCall.durationSeconds).toBeGreaterThanOrEqual(0);
    });

    it("should reject unauthorized users attempting to access or manipulate another call", async () => {
      // Bob is online and accepting calls
      const mockBobWs = {
        send: () => {},
        readyState: 1,
        terminate: () => {},
      } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob-test-2", mockBobWs);

      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });

      // Charlie (unauthorized third party)
      const charlieKey = generatePrivateKey();
      const charlieAccount = privateKeyToAccount(charlieKey);
      const charlieAuth = await authenticateWallet(charlieAccount);

      // Alice calls Bob
      const initRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      expect(initRes.statusCode).toBe(201);
      const call = JSON.parse(initRes.body);

      // Charlie attempts to view Alice & Bob's call session
      const getRes = await app.inject({
        method: "GET",
        url: `/api/v1/calls/${call.id}`,
        headers: { authorization: `Bearer ${charlieAuth.sessionToken}` },
      });
      expect(getRes.statusCode).toBe(403);

      // Charlie attempts to confirm connected on Alice's call
      const confirmRes = await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/connected`,
        headers: { authorization: `Bearer ${charlieAuth.sessionToken}` },
      });
      expect(confirmRes.statusCode).toBe(403);

      // Clean up call
      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/cancel`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
    });

    it("should return paginated call history with direction and counterparty identity", async () => {
      // Set up a completed call between Alice and Bob
      const mockBobWs = {
        send: () => {},
        readyState: 1,
        terminate: () => {},
      } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob-test-3", mockBobWs);

      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });

      const initRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      expect(initRes.statusCode).toBe(201);
      const call = JSON.parse(initRes.body);

      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/accept`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/connected`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call.id}/end`,
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });

      // Alice retrieves her call history
      const historyRes = await app.inject({
        method: "GET",
        url: "/api/v1/calls/history?limit=10&offset=0",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });

      expect(historyRes.statusCode).toBe(200);
      const history = JSON.parse(historyRes.body);
      expect(history.calls).toBeDefined();
      expect(Array.isArray(history.calls)).toBe(true);
      expect(history.total).toBeGreaterThan(0);

      // Find the completed call in history
      const firstCall = history.calls[0];
      expect(firstCall.callerWallet).toBe(aliceWallet.toLowerCase());
      expect(firstCall.counterpartyWallet).toBe(bobWallet.toLowerCase());
      expect(firstCall.direction).toBe("outgoing");
      expect(typeof firstCall.durationSeconds).toBe("number");

      // Bob retrieves his call history filtering by incoming
      const bobHistoryRes = await app.inject({
        method: "GET",
        url: "/api/v1/calls/history?direction=incoming",
        headers: { authorization: `Bearer ${bobSessionToken}` },
      });
      expect(bobHistoryRes.statusCode).toBe(200);
      const bobHistory = JSON.parse(bobHistoryRes.body);
      expect(bobHistory.calls.length).toBeGreaterThan(0);
      expect(bobHistory.calls[0].direction).toBe("incoming");
      expect(bobHistory.calls[0].counterpartyWallet).toBe(aliceWallet.toLowerCase());
    });

    it("should recover stale ringing or connecting calls and unblock participants", async () => {
      // Ensure Bob is online and accepting calls
      const mockBobWs = {
        send: () => {},
        readyState: 1,
        terminate: () => {},
      } as any;
      presenceService.registerConnection(bobUser.id, "conn-bob-test-4", mockBobWs);

      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });

      // Insert an artificially stale ringing call into PostgreSQL
      const staleTime = new Date(Date.now() - 60000); // 60 seconds ago
      const [staleCall] = await db.insert(callSessions).values({
        callerUserId: aliceUser.id,
        recipientUserId: bobUser.id,
        callerWallet: aliceWallet.toLowerCase(),
        recipientWallet: bobWallet.toLowerCase(),
        state: "ringing",
        ringingAt: staleTime,
        createdAt: staleTime,
      }).returning();

      // Calling recoverStaleCalls should transition it to missed
      const recovered = await callingService.recoverStaleCalls();
      expect(recovered).toBeGreaterThanOrEqual(1);

      // Verify in DB that the call is now missed
      const [updated] = await db.select().from(callSessions).where(eq(callSessions.id, staleCall.id));
      expect(updated.state).toBe("missed");
      expect(updated.terminalReason).toBe("ringing_timeout");

      // Alice should now be free to initiate another call without active call conflict
      const newCallRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      expect(newCallRes.statusCode).toBe(201);

      // Clean up
      const newCall = JSON.parse(newCallRes.body);
      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${newCall.id}/cancel`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
    });
  });

  describe("Phase 5.2 — Reliability Hardening Regressions", () => {
    it("Priority 1: should enforce strictly one active call per wallet across BOTH roles", async () => {
      // 1. Mark Alice, Bob and Charlie online and accepting calls
      const mockWs = { send: () => {}, readyState: 1, terminate: () => {} } as any;
      presenceService.registerConnection(aliceUser.id, "conn-alice-52", mockWs);
      presenceService.registerConnection(bobUser.id, "conn-bob-52", mockWs);
      presenceService.registerConnection(charlieUser.id, "conn-charlie-52", mockWs);

      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { isAcceptingCalls: true },
      });
      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { isAcceptingCalls: true },
      });
      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me/calling-settings",
        headers: { authorization: `Bearer ${charlieSessionToken}` },
        payload: { isAcceptingCalls: true },
      });

      // 2. Alice calls Bob (Alice = caller, Bob = recipient)
      const call1Res = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
        payload: { recipientAddress: bobWallet },
      });
      expect(call1Res.statusCode).toBe(201);
      const call1 = JSON.parse(call1Res.body);

      // Verify active_call_participants has both Alice and Bob reserved
      const reserved = await db.select().from(activeCallParticipants);
      expect(reserved.length).toBe(2);
      expect(reserved.map((r) => r.userId)).toContain(aliceUser.id);
      expect(reserved.map((r) => r.userId)).toContain(bobUser.id);

      // 3. Charlie tries to call Alice (who is caller in Call 1) -> must fail with 409 CALL_RECIPIENT_BUSY
      const charlieToAliceRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${charlieSessionToken}` },
        payload: { recipientAddress: aliceWallet },
      });
      expect(charlieToAliceRes.statusCode).toBe(409);
      const charlieToAliceBody = JSON.parse(charlieToAliceRes.body);
      expect(charlieToAliceBody.code).toBe("CALL_RECIPIENT_BUSY");

      // 4. Bob (who is recipient in Call 1) tries to call Charlie -> must fail with 409 CALL_CALLER_BUSY
      const bobToCharlieRes = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${bobSessionToken}` },
        payload: { recipientAddress: charlieWallet },
      });
      expect(bobToCharlieRes.statusCode).toBe(409);
      const bobToCharlieBody = JSON.parse(bobToCharlieRes.body);
      expect(bobToCharlieBody.code).toBe("CALL_CALLER_BUSY");

      // 5. Alice cancels Call 1 -> reservations must be deleted from active_call_participants
      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call1.id}/cancel`,
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });

      const reservedAfterCancel = await db.select().from(activeCallParticipants);
      expect(reservedAfterCancel.length).toBe(0);

      // 6. Now Charlie can call Alice without error
      const charlieToAliceSuccess = await app.inject({
        method: "POST",
        url: "/api/v1/calls",
        headers: { authorization: `Bearer ${charlieSessionToken}` },
        payload: { recipientAddress: aliceWallet },
      });
      expect(charlieToAliceSuccess.statusCode).toBe(201);
      const call2 = JSON.parse(charlieToAliceSuccess.body);

      // Clean up call 2
      await app.inject({
        method: "POST",
        url: `/api/v1/calls/${call2.id}/cancel`,
        headers: { authorization: `Bearer ${charlieSessionToken}` },
      });
    });

    it("Priority 2: should recover connected and accepted calls on startup recovery sweep", async () => {
      // 1. Artificially create a call that was connected before server reboot
      const pastTime = new Date(Date.now() - 100000);
      const [staleConnected] = await db.insert(callSessions).values({
        callerUserId: aliceUser.id,
        recipientUserId: bobUser.id,
        callerWallet: aliceWallet.toLowerCase(),
        recipientWallet: bobWallet.toLowerCase(),
        state: "connected",
        connectedAt: pastTime,
        createdAt: pastTime,
      }).returning();

      // Reserve participants in active_call_participants
      await db.insert(activeCallParticipants).values([
        { userId: aliceUser.id, callId: staleConnected.id, role: "caller" },
        { userId: bobUser.id, callId: staleConnected.id, role: "recipient" },
      ]);

      // 2. Artificially create an accepted call with Charlie and Alice
      const [staleAccepted] = await db.insert(callSessions).values({
        callerUserId: charlieUser.id,
        recipientUserId: aliceUser.id,
        callerWallet: charlieWallet.toLowerCase(),
        recipientWallet: aliceWallet.toLowerCase(),
        state: "accepted",
        acceptedAt: pastTime,
        createdAt: pastTime,
      }).returning();

      // 3. Trigger startup recovery
      const recovered = await callingService.recoverStaleCalls({
        isStartup: true,
        serverBootTime: new Date(),
      });
      expect(recovered).toBeGreaterThanOrEqual(2);

      // 4. Verify connected call transitioned to ended with server_restart_recovery
      const [updatedConnected] = await db.select().from(callSessions).where(eq(callSessions.id, staleConnected.id));
      expect(updatedConnected.state).toBe("ended");
      expect(updatedConnected.terminalReason).toBe("server_restart_recovery");

      // 5. Verify accepted call transitioned to failed with server_restart_recovery
      const [updatedAccepted] = await db.select().from(callSessions).where(eq(callSessions.id, staleAccepted.id));
      expect(updatedAccepted.state).toBe("failed");
      expect(updatedAccepted.terminalReason).toBe("server_restart_recovery");

      // 6. Verify activeCallParticipants table is completely clear
      const remainingParticipants = await db.select().from(activeCallParticipants);
      expect(remainingParticipants.length).toBe(0);
    });

    it("Priority 5: should deterministically paginate call history with timestamp collisions", async () => {
      // Create 3 call sessions with identical createdAt timestamp
      const fixedTimestamp = new Date("2026-06-01T12:00:00.000Z");
      const callsToInsert = [
        {
          callerUserId: aliceUser.id,
          recipientUserId: bobUser.id,
          callerWallet: aliceWallet.toLowerCase(),
          recipientWallet: bobWallet.toLowerCase(),
          state: "ended" as const,
          terminalReason: "ended_by_user",
          durationSeconds: 30,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
        },
        {
          callerUserId: aliceUser.id,
          recipientUserId: bobUser.id,
          callerWallet: aliceWallet.toLowerCase(),
          recipientWallet: bobWallet.toLowerCase(),
          state: "ended" as const,
          terminalReason: "ended_by_user",
          durationSeconds: 45,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
        },
        {
          callerUserId: aliceUser.id,
          recipientUserId: bobUser.id,
          callerWallet: aliceWallet.toLowerCase(),
          recipientWallet: bobWallet.toLowerCase(),
          state: "ended" as const,
          terminalReason: "ended_by_user",
          durationSeconds: 60,
          createdAt: fixedTimestamp,
          updatedAt: fixedTimestamp,
        },
      ];

      const inserted = await db.insert(callSessions).values(callsToInsert).returning();
      expect(inserted.length).toBe(3);

      // Fetch page 1 (limit 2, offset 0)
      const page1Res = await app.inject({
        method: "GET",
        url: "/api/v1/calls/history?limit=2&offset=0",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      expect(page1Res.statusCode).toBe(200);
      const page1 = JSON.parse(page1Res.body);
      expect(page1.calls.length).toBe(2);

      // Fetch page 2 (limit 2, offset 2)
      const page2Res = await app.inject({
        method: "GET",
        url: "/api/v1/calls/history?limit=2&offset=2",
        headers: { authorization: `Bearer ${aliceSessionToken}` },
      });
      expect(page2Res.statusCode).toBe(200);
      const page2 = JSON.parse(page2Res.body);

      // Assert that page 1 and page 2 contain NO overlapping call IDs
      const page1Ids = page1.calls.map((c: any) => c.id);
      const page2Ids = page2.calls.map((c: any) => c.id);
      for (const id of page1Ids) {
        expect(page2Ids).not.toContain(id);
      }
    });
  });
});
