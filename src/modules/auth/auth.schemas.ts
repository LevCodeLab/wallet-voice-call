import { z } from "zod";

// Nonce generation request
export const requestNonceSchema = z.object({
  walletAddress: z
    .string()
    .min(32, "Wallet address must be at least 32 characters")
    .max(66, "Wallet address cannot exceed 66 characters")
    .regex(/^[a-zA-Z0-9xX]+$/, "Wallet address must be alphanumeric"),
  network: z.enum(["evm", "solana"]).default("evm"),
});

export type RequestNonceInput = z.infer<typeof requestNonceSchema>;

// Nonce generation response
export const nonceResponseSchema = z.object({
  nonce: z.string(),
  domain: z.string(),
  expiresAt: z.string(),
  statement: z.string(),
});

// Signature verification request
export const verifySignatureSchema = z.object({
  walletAddress: z
    .string()
    .min(32, "Wallet address must be at least 32 characters")
    .max(66, "Wallet address cannot exceed 66 characters"),
  network: z.enum(["evm", "solana"]).default("evm"),
  message: z.string().min(1, "Signed message cannot be empty"),
  signature: z.string().min(1, "Signature cannot be empty"),
});

export type VerifySignatureInput = z.infer<typeof verifySignatureSchema>;

// User view schema
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  walletAddress: z.string(),
  network: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string(),
});

// Auth verify response schema
export const authVerifyResponseSchema = z.object({
  user: userResponseSchema,
  sessionToken: z.string(),
  expiresAt: z.string(),
});

// Logout response
export const logoutResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
