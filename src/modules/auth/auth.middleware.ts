import type { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../../shared/errors.js";
import { authService } from "./auth.service.js";
import type { User, Session } from "../../db/schema/index.js";

// Augment FastifyRequest to include authenticated user and session
declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    session?: Session;
    rawSessionToken?: string;
  }
}

export function extractSessionToken(request: FastifyRequest): string | null {
  // Check Authorization Bearer header first
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  // Check secure session cookie
  if (request.cookies && request.cookies.session_token) {
    return request.cookies.session_token;
  }

  return null;
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const token = extractSessionToken(request);

  if (!token) {
    throw new UnauthorizedError("Authentication required. Please sign in with your wallet.", "AUTH_REQUIRED");
  }

  const { session, user } = await authService.validateSession(token);

  request.user = user;
  request.session = session;
  request.rawSessionToken = token;
}
