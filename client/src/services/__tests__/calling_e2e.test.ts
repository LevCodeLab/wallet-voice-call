import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../../../src/app.js";
import { checkDbConnection } from "../../../../src/db/index.js";
import { TEST_ACCOUNTS } from "../auth.service.js";
import { privateKeyToAccount } from "viem/accounts";
import WebSocket from "ws";

const hasDb = await checkDbConnection();

describe.skipIf(!hasDb)("2-Party Voice Calling End-to-End Test", () => {
  let app: any;
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    app = buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    serverPort = app.server.address().port;
    baseUrl = `http://127.0.0.1:${serverPort}`;
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper to authenticate a test wallet against the test server
  async function authenticateTestWallet(privateKey: `0x${string}`) {
    const account = privateKeyToAccount(privateKey);

    // 1. Request nonce
    const nonceRes = await fetch(`${baseUrl}/api/v1/auth/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: account.address, network: "evm" }),
    });
    const { nonce, statement } = await nonceRes.json();
    const challengeMessage = `${statement} nonce: ${nonce}`;

    // 2. Sign message
    const signature = await account.signMessage({ message: challengeMessage });

    // 3. Verify
    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: account.address,
        network: "evm",
        message: challengeMessage,
        signature,
      }),
    });
    return await verifyRes.json();
  }

  it("coordinates full call lifecycle and WebRTC signaling between Alice and Bob", async () => {
    // 1. Authenticate Alice and Bob
    const aliceAuth = await authenticateTestWallet(TEST_ACCOUNTS.ALICE.privateKey);
    const bobAuth = await authenticateTestWallet(TEST_ACCOUNTS.BOB.privateKey);

    expect(aliceAuth.user.walletAddress.toLowerCase()).toBe(TEST_ACCOUNTS.ALICE.address.toLowerCase());
    expect(bobAuth.user.walletAddress.toLowerCase()).toBe(TEST_ACCOUNTS.BOB.address.toLowerCase());

    // 2. Bob enables incoming calls
    const settingsRes = await fetch(`${baseUrl}/api/v1/users/me/calling-settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bobAuth.sessionToken}`,
      },
      body: JSON.stringify({ isAcceptingCalls: true }),
    });
    const bobSettings = await settingsRes.json();
    expect(bobSettings.isAcceptingCalls).toBe(true);

    // 3. Alice requests Bob's public calling profile
    const profileRes = await fetch(`${baseUrl}/api/v1/users/${bobAuth.user.walletAddress}/profile`);
    const bobProfile = await profileRes.json();
    expect(bobProfile.isAcceptingCalls).toBe(true);
    expect(bobProfile.isCallable).toBe(false); // Bob not connected to WS yet

    // 4. Bob connects to WebSocket
    const bobTicketRes = await fetch(`${baseUrl}/api/v1/auth/ws-ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bobAuth.sessionToken}` },
    });
    const { ticket: bobTicket } = await bobTicketRes.json();
    const bobWs = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${bobTicket}`);

    await new Promise((resolve) => bobWs.on("open", resolve));

    // Bob is now online and callable
    const bobProfileOnline = await (await fetch(`${baseUrl}/api/v1/users/${bobAuth.user.walletAddress}/profile`)).json();
    expect(bobProfileOnline.isOnline).toBe(true);
    expect(bobProfileOnline.isCallable).toBe(true);

    // 5. Alice connects to WebSocket
    const aliceTicketRes = await fetch(`${baseUrl}/api/v1/auth/ws-ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${aliceAuth.sessionToken}` },
    });
    const { ticket: aliceTicket } = await aliceTicketRes.json();
    const aliceWs = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${aliceTicket}`);
    await new Promise((resolve) => aliceWs.on("open", resolve));

    // Prepare Bob message listener for incoming call
    const bobIncomingCallPromise = new Promise<any>((resolve) => {
      bobWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "call.incoming") {
          resolve(msg.payload);
        }
      });
    });

    // 6. Alice initiates call to Bob
    const callRes = await fetch(`${baseUrl}/api/v1/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceAuth.sessionToken}`,
      },
      body: JSON.stringify({ recipientAddress: bobAuth.user.walletAddress }),
    });
    const callData = await callRes.json();
    const callId = callData.id || callData.callId;
    expect(callData.state || callData.status).toBe("ringing");

    // Bob receives call.incoming
    const incomingPayload = await bobIncomingCallPromise;
    expect(incomingPayload.callId).toBe(callId);
    const callerAddress = incomingPayload.callerAddress || incomingPayload.caller?.walletAddress;
    expect(callerAddress.toLowerCase()).toBe(aliceAuth.user.walletAddress.toLowerCase());

    // 7. Bob accepts the call
    const bobStatePromise = new Promise<any>((resolve) => {
      bobWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        const state = msg.payload?.state || msg.payload?.status;
        if (msg.type === "call.state" && state === "connecting") {
          resolve(msg.payload);
        }
      });
    });

    bobWs.send(JSON.stringify({ type: "call.accept", payload: { callId } }));
    const connectingState = await bobStatePromise;
    expect(connectingState.state || connectingState.status).toBe("connecting");

    // 8. Alice sends WebRTC SDP Offer
    const bobOfferPromise = new Promise<any>((resolve) => {
      bobWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "webrtc.offer") {
          resolve(msg.payload);
        }
      });
    });

    aliceWs.send(JSON.stringify({
      type: "webrtc.offer",
      payload: { callId, sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 54321 RTP/SAVPF 111" }
    }));

    const receivedOffer = await bobOfferPromise;
    expect(receivedOffer.sdp).toContain("m=audio");

    // 9. Bob replies with WebRTC SDP Answer
    const aliceAnswerPromise = new Promise<any>((resolve) => {
      aliceWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "webrtc.answer") {
          resolve(msg.payload);
        }
      });
    });

    bobWs.send(JSON.stringify({
      type: "webrtc.answer",
      payload: { callId, sdp: "v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 54321 RTP/SAVPF 111" }
    }));

    const receivedAnswer = await aliceAnswerPromise;
    expect(receivedAnswer.sdp).toContain("m=audio");

    // 10. Authoritative connection confirmation via WebSocket
    const bobConnectedPromise = new Promise<any>((resolve) => {
      bobWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        const state = msg.payload?.state || msg.payload?.status;
        if (msg.type === "call.state" && state === "connected") {
          resolve(msg.payload);
        }
      });
    });

    aliceWs.send(JSON.stringify({
      type: "call.connected",
      payload: { callId },
    }));

    const connectedPayload = await bobConnectedPromise;
    expect(connectedPayload.state || connectedPayload.status).toBe("connected");

    // 11. Alice sends ICE candidate to Bob
    const bobIcePromise = new Promise<any>((resolve) => {
      bobWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "webrtc.ice-candidate") {
          resolve(msg.payload);
        }
      });
    });

    aliceWs.send(JSON.stringify({
      type: "webrtc.ice-candidate",
      payload: {
        callId,
        candidate: { candidate: "candidate:1 1 UDP 2122260223 127.0.0.1 54321 typ host", sdpMid: "0", sdpMLineIndex: 0 }
      }
    }));

    const receivedIce = await bobIcePromise;
    expect(receivedIce.candidate.candidate).toContain("candidate:1 1 UDP");

    // 12. Alice ends the call
    const bobEndPromise = new Promise<any>((resolve) => {
      bobWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        const state = msg.payload?.state || msg.payload?.status;
        if (msg.type === "call.state" && state === "ended") {
          resolve(msg.payload);
        }
      });
    });

    aliceWs.send(JSON.stringify({ type: "call.end", payload: { callId } }));
    const endedState = await bobEndPromise;
    expect(endedState.state || endedState.status).toBe("ended");

    // 13. Verify call history persistence on backend
    const historyRes = await fetch(`${baseUrl}/api/v1/calls/history`, {
      headers: { Authorization: `Bearer ${aliceAuth.sessionToken}` },
    });
    expect(historyRes.status).toBe(200);
    const historyData = await historyRes.json();
    expect(historyData.calls.length).toBeGreaterThan(0);
    expect(historyData.calls[0].id).toBe(callId);
    expect(historyData.calls[0].direction).toBe("outgoing");
    expect(historyData.calls[0].counterpartyWallet.toLowerCase()).toBe(bobAuth.user.walletAddress.toLowerCase());
    expect(typeof historyData.calls[0].durationSeconds).toBe("number");

    aliceWs.close();
    bobWs.close();
  });
});
