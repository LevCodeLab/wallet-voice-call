import { eq, and, gt, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users, authNonces, sessions, auditEvents } from "../../db/schema/index.js";
import type { User, NewUser, AuthNonce, NewAuthNonce, Session, NewSession, NewAuditEvent } from "../../db/schema/index.js";

export class AuthRepository {
  /**
   * Insert a newly generated authentication challenge nonce
   */
  async createNonce(data: NewAuthNonce): Promise<AuthNonce> {
    const [created] = await db.insert(authNonces).values(data).returning();
    return created;
  }

  /**
   * Find a valid, unconsumed, non-expired nonce
   */
  async findValidNonce(walletAddress: string, nonce: string): Promise<AuthNonce | null> {
    const now = new Date();
    const [found] = await db
      .select()
      .from(authNonces)
      .where(
        and(
          eq(authNonces.walletAddress, walletAddress.toLowerCase()),
          eq(authNonces.nonce, nonce),
          isNull(authNonces.consumedAt),
          gt(authNonces.expiresAt, now)
        )
      )
      .limit(1);

    return found || null;
  }

  /**
   * Atomically mark a nonce as consumed to prevent replay attacks
   */
  async consumeNonce(nonceId: string): Promise<boolean> {
    const result = await db
      .update(authNonces)
      .set({ consumedAt: new Date() })
      .where(and(eq(authNonces.id, nonceId), isNull(authNonces.consumedAt)))
      .returning();

    return result.length > 0;
  }

  /**
   * Find or atomically create user by wallet address and network
   */
  async findOrCreateUser(walletAddress: string, network: string): Promise<User> {
    const normalizedAddress = walletAddress.toLowerCase();
    const [user] = await db
      .insert(users)
      .values({
        walletAddress: normalizedAddress,
        network,
      })
      .onConflictDoUpdate({
        target: [users.walletAddress, users.network],
        set: { updatedAt: new Date() },
      })
      .returning();

    return user;
  }

  /**
   * Retrieve user by primary ID
   */
  async getUserById(id: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user || null;
  }

  /**
   * Create an authenticated session record
   */
  async createSession(data: NewSession): Promise<Session> {
    const [session] = await db.insert(sessions).values(data).returning();
    return session;
  }

  /**
   * Retrieve an active session by SHA-256 token hash (must not be revoked or expired)
   */
  async findValidSessionByTokenHash(tokenHash: string): Promise<{ session: Session; user: User } | null> {
    const now = new Date();
    const rows = await db
      .select({
        session: sessions,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.sessionTokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  }

  /**
   * Revoke an active session
   */
  async revokeSession(sessionId: string): Promise<boolean> {
    const result = await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning();

    return result.length > 0;
  }

  /**
   * Record security/audit event
   */
  async recordAuditEvent(data: NewAuditEvent): Promise<void> {
    await db.insert(auditEvents).values(data);
  }
}

export const authRepository = new AuthRepository();
