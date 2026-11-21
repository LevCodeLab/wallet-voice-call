import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { BadRequestError, UnauthorizedError } from "../../shared/errors.js";
import { authRepository, AuthRepository } from "./auth.repository.js";
import type { RequestNonceInput, VerifySignatureInput } from "./auth.schemas.js";
import type { User, Session } from "../../db/schema/index.js";

import { verifyEvmSignature } from "./verifiers/evm.verifier.js";

export interface WalletVerificationResult {
  isValid: boolean;
  walletAddress: string;
  error?: string;
}

export type WalletVerifierFn = (params: {
  walletAddress: string;
  message: string;
  signature: string;
  nonce: string;
}) => Promise<WalletVerificationResult>;

export class AuthService {
  private verifier: WalletVerifierFn;
  private readonly wsTickets = new Map<string, { userId: string; expiresAt: number }>();

  constructor(
    private readonly repo: AuthRepository = authRepository,
    customVerifier?: WalletVerifierFn
  ) {
    this.verifier = customVerifier || verifyEvmSignature;
  }

  /**
   * Issue a short-lived single-use ticket for authenticating a WebSocket upgrade handshake
   */
  public createWsTicket(userId: string, ttlSeconds = 60): { ticket: string; expiresAt: string } {
    const ticket = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.wsTickets.set(ticket, { userId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * Validate and atomically consume a single-use WebSocket ticket
   */
  public consumeWsTicket(ticket: string): string | null {
    const record = this.wsTickets.get(ticket);
    if (!record) return null;

    this.wsTickets.delete(ticket); // single use

    if (Date.now() > record.expiresAt) {
      return null;
    }

    return record.userId;
  }

  /**
   * Periodic garbage collection of unconsumed expired WebSocket tickets
   */
  public cleanExpiredWsTickets(): void {
    const now = Date.now();
    for (const [ticket, record] of this.wsTickets.entries()) {
      if (now > record.expiresAt) {
        this.wsTickets.delete(ticket);
      }
    }
  }

  /**
   * Inject or register a custom signature verifier (e.g. for testing)
   */
  public setVerifier(verifier: WalletVerifierFn): void {
    this.verifier = verifier;
  }

  /**
   * Generate an unpredictable, server-bound authentication nonce with expiration
   */
  async requestNonce(input: RequestNonceInput, clientIp?: string) {
    const normalizedAddress = input.walletAddress.toLowerCase();
    const nonce = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + env.AUTH_NONCE_TTL_SECONDS * 1000);

    const createdNonce = await this.repo.createNonce({
      walletAddress: normalizedAddress,
      nonce,
      network: input.network,
      domain: env.AUTH_DOMAIN,
      expiresAt,
    });

    await this.repo.recordAuditEvent({
      walletAddress: normalizedAddress,
      eventType: "AUTH_NONCE_REQUESTED",
      metadata: { nonceId: createdNonce.id, network: input.network },
      ipAddress: clientIp,
    });

    return {
      nonce: createdNonce.nonce,
      domain: createdNonce.domain,
      expiresAt: createdNonce.expiresAt.toISOString(),
      statement: `Sign in to wallet-voice-call (${env.AUTH_DOMAIN}) to authenticate your wallet identity.`,
    };
  }

  /**
   * Verify signature and issue an authenticated session
   */
  async verifyAndCreateSession(
    input: VerifySignatureInput,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): Promise<{ user: User; sessionToken: string; expiresAt: string }> {
    const normalizedAddress = input.walletAddress.toLowerCase();

    // 1. Look for a valid nonce referenced in the message
    // A standard authentication message must contain the issued nonce
    const nonceMatch = input.message.match(/nonce:\s*([a-zA-Z0-9]+)/i) || 
                       input.message.match(/([a-f0-9]{32})/i);

    const nonceString = nonceMatch ? nonceMatch[1] : null;

    if (!nonceString) {
      throw new BadRequestError("Authentication message must contain a valid server-issued nonce", "AUTH_NONCE_MISSING");
    }

    const nonceRecord = await this.repo.findValidNonce(normalizedAddress, nonceString);
    if (!nonceRecord) {
      throw new BadRequestError("Authentication nonce is invalid, already consumed, or expired", "AUTH_NONCE_INVALID");
    }

    // 2. Verify signature via registered chain verifier
    const verification = await this.verifier({
      walletAddress: normalizedAddress,
      message: input.message,
      signature: input.signature,
      nonce: nonceRecord.nonce,
    });

    if (!verification.isValid) {
      await this.repo.recordAuditEvent({
        walletAddress: normalizedAddress,
        eventType: "AUTH_SIGNATURE_FAILED",
        metadata: { reason: verification.error },
        ipAddress: metadata?.ipAddress,
      });
      throw new BadRequestError(verification.error || "Invalid signature for wallet address", "AUTH_SIGNATURE_INVALID");
    }

    // 3. Atomically consume the nonce to prevent replay attacks
    const consumed = await this.repo.consumeNonce(nonceRecord.id);
    if (!consumed) {
      throw new BadRequestError("Nonce was already consumed by another request", "AUTH_NONCE_REPLAY");
    }

    // 4. Find or create the user record
    const user = await this.repo.findOrCreateUser(normalizedAddress, input.network);

    // 5. Generate secure 256-bit session token
    const rawSessionToken = crypto.randomBytes(32).toString("hex");
    const sessionTokenHash = crypto.createHash("sha256").update(rawSessionToken).digest("hex");
    const sessionExpiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000);

    await this.repo.createSession({
      userId: user.id,
      sessionTokenHash,
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      expiresAt: sessionExpiresAt,
    });

    await this.repo.recordAuditEvent({
      userId: user.id,
      walletAddress: normalizedAddress,
      eventType: "AUTH_LOGIN_SUCCESS",
      metadata: { network: input.network },
      ipAddress: metadata?.ipAddress,
    });

    return {
      user,
      sessionToken: rawSessionToken,
      expiresAt: sessionExpiresAt.toISOString(),
    };
  }

  /**
   * Validate session token from cookie or Authorization header
   */
  async validateSession(rawToken: string): Promise<{ session: Session; user: User }> {
    if (!rawToken || typeof rawToken !== "string" || rawToken.trim() === "") {
      throw new UnauthorizedError("Session token missing", "AUTH_TOKEN_MISSING");
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
    const sessionData = await this.repo.findValidSessionByTokenHash(tokenHash);

    if (!sessionData) {
      throw new UnauthorizedError("Session is invalid, expired, or revoked", "AUTH_SESSION_INVALID");
    }

    return sessionData;
  }

  /**
   * Revoke an active session (logout)
   */
  async revokeSession(rawToken: string, clientIp?: string): Promise<boolean> {
    const { session, user } = await this.validateSession(rawToken);
    const revoked = await this.repo.revokeSession(session.id);

    if (revoked) {
      await this.repo.recordAuditEvent({
        userId: user.id,
        walletAddress: user.walletAddress,
        eventType: "AUTH_LOGOUT",
        metadata: { sessionId: session.id },
        ipAddress: clientIp,
      });
    }

    return revoked;
  }
}

export const authService = new AuthService();
