import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, code = "INTERNAL_SERVER_ERROR", details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = "BAD_REQUEST", details?: unknown) {
    super(message, 400, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", code = "UNAUTHORIZED") {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access forbidden", code = "FORBIDDEN") {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", code = "NOT_FOUND") {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(message, 409, code);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "VALIDATION_ERROR", details);
  }
}

export function globalErrorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Handle Zod validation errors from fastify-type-provider-zod or manual validation
  if (error instanceof ZodError) {
    request.log.warn({ issues: error.issues, url: request.url }, "Validation failure");
    return reply.status(400).send({
      statusCode: 400,
      error: "Bad Request",
      code: "VALIDATION_FAILED",
      message: "Request validation failed",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  // Handle known AppError instances
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      request.log.error({ err: error, url: request.url }, "Internal application error");
    } else {
      request.log.warn({ code: error.code, message: error.message, url: request.url }, "Client error");
    }

    return reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      error: error.name,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  // Handle Fastify built-in errors (e.g. 404, 400 bad JSON, 429 rate limit)
  if ("statusCode" in error && typeof error.statusCode === "number") {
    request.log.warn({ statusCode: error.statusCode, message: error.message }, "Fastify lifecycle error");
    return reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      error: error.name || "Error",
      code: (error as FastifyError).code || "FASTIFY_ERROR",
      message: error.message,
    });
  }

  // Unexpected errors: Log full error internally, return generic non-leaking message to client
  request.log.error({ err: error, url: request.url }, "Unhandled server exception");
  return reply.status(500).send({
    statusCode: 500,
    error: "Internal Server Error",
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected internal server error occurred",
  });
}
