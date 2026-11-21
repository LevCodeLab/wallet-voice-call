import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../../app.js";
import { closeDb, db, checkDbConnection } from "../../db/index.js";
import { authNonces, users } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";

const hasDb = await checkDbConnection();

describe.skipIf(!hasDb)("Auth Module Integration Tests (EVM / SIWE)", () => {
  let app: FastifyInstance;

  // Generate real ephemeral EVM account for testing
  const privateKey = generatePrivateKey();
  const testAccount = privateKeyToAccount(privateKey);
  const testWallet = testAccount.address;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Clean up test records
    await db.delete(authNonces).where(eq(authNonces.walletAddress, testWallet.toLowerCase()));
    await db.delete(users).where(eq(users.walletAddress, testWallet.toLowerCase()));
  });

  afterAll(async () => {
    // Clean up
    await db.delete(authNonces).where(eq(authNonces.walletAddress, testWallet.toLowerCase()));
    await db.delete(users).where(eq(users.walletAddress, testWallet.toLowerCase()));
    await app.close();
  });

  describe("POST /api/v1/auth/nonce", () => {
    it("should issue a single-use unpredictable nonce with 5-minute expiry for a valid EVM wallet", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/nonce",
        payload: {
          walletAddress: testWallet,
          network: "evm",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.nonce).toBeDefined();
      expect(body.nonce.length).toBe(32); // 16 bytes hex
      expect(body.domain).toBe("localhost:3001");
      expect(body.statement).toContain("wallet-voice-call");
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("should reject an invalid wallet address with 400 Bad Request", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/nonce",
        payload: {
          walletAddress: "invalid-short-addr",
          network: "evm",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("POST /api/v1/auth/verify with Real Cryptographic EVM Signatures", () => {
    it("should authenticate real EVM signature, issue session, set cookie, and allow /me access", async () => {
      // 1. Request nonce
      const nonceRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/nonce",
        payload: { walletAddress: testWallet, network: "evm" },
      });
      const { nonce, domain } = JSON.parse(nonceRes.body);

      // 2. Sign authentic message with private key
      const messageToSign = `Sign in to wallet-voice-call (${domain}) to authenticate your wallet identity. nonce: ${nonce}`;
      const realSignature = await testAccount.signMessage({ message: messageToSign });

      // 3. Verify signature and establish session
      const verifyRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify",
        payload: {
          walletAddress: testWallet,
          network: "evm",
          message: messageToSign,
          signature: realSignature,
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const verifyBody = JSON.parse(verifyRes.body);
      expect(verifyBody.user.walletAddress).toBe(testWallet.toLowerCase());
      expect(verifyBody.sessionToken).toBeDefined();

      // Check Set-Cookie header
      const setCookie = verifyRes.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("session_token=");

      const sessionToken = verifyBody.sessionToken;

      // 4. Access protected GET /api/v1/auth/me with Bearer token
      const meRes = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {
          authorization: `Bearer ${sessionToken}`,
        },
      });

      expect(meRes.statusCode).toBe(200);
      const meBody = JSON.parse(meRes.body);
      expect(meBody.user.walletAddress).toBe(testWallet.toLowerCase());

      // 5. Access protected GET /api/v1/auth/me with Cookie
      const meCookieRes = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {
          cookie: `session_token=${sessionToken}`,
        },
      });
      expect(meCookieRes.statusCode).toBe(200);

      // 6. Replay attack prevention: reusing the same consumed nonce must fail
      const replayRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify",
        payload: {
          walletAddress: testWallet,
          network: "evm",
          message: messageToSign,
          signature: realSignature,
        },
      });
      expect(replayRes.statusCode).toBe(400);
      const replayBody = JSON.parse(replayRes.body);
      expect(replayBody.code).toBe("AUTH_NONCE_INVALID");

      // 7. Logout and verify session revocation
      const logoutRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: {
          authorization: `Bearer ${sessionToken}`,
        },
      });
      expect(logoutRes.statusCode).toBe(200);

      // 8. Subsequent request to /me with the revoked session must return 401
      const meAfterLogout = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: {
          authorization: `Bearer ${sessionToken}`,
        },
      });
      expect(meAfterLogout.statusCode).toBe(401);
      const logoutCheckBody = JSON.parse(meAfterLogout.body);
      expect(logoutCheckBody.code).toBe("AUTH_SESSION_INVALID");
    });

    it("should reject forged or mismatched signatures with 400 Bad Request", async () => {
      // 1. Get nonce
      const nonceRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/nonce",
        payload: { walletAddress: testWallet, network: "evm" },
      });
      const { nonce, domain } = JSON.parse(nonceRes.body);

      // 2. Sign with a DIFFERENT wallet account
      const attackerAccount = privateKeyToAccount(generatePrivateKey());
      const messageToSign = `Sign in to wallet-voice-call (${domain}) to authenticate your wallet identity. nonce: ${nonce}`;
      const forgedSignature = await attackerAccount.signMessage({ message: messageToSign });

      // 3. Attempt to authenticate as testWallet using attacker's signature
      const verifyRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify",
        payload: {
          walletAddress: testWallet,
          network: "evm",
          message: messageToSign,
          signature: forgedSignature,
        },
      });

      expect(verifyRes.statusCode).toBe(400);
      const body = JSON.parse(verifyRes.body);
      expect(body.code).toBe("AUTH_SIGNATURE_INVALID");
    });

    it("GET /api/v1/auth/me should return 401 Unauthorized when no credentials provided", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("AUTH_REQUIRED");
    });
  });
});
