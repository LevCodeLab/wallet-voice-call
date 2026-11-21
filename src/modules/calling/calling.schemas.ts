import { z } from "zod";

export const callingProfileResponseSchema = z.object({
  walletAddress: z.string(),
  network: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isOnline: z.boolean(),
  isAcceptingCalls: z.boolean(),
  isCallable: z.boolean(),
  presenceStatus: z.enum(["online", "busy", "unavailable", "offline"]),
});

export type CallingProfileResponse = z.infer<typeof callingProfileResponseSchema>;

export const updateCallingSettingsSchema = z.object({
  isAcceptingCalls: z.boolean(),
});

export type UpdateCallingSettingsInput = z.infer<typeof updateCallingSettingsSchema>;

export const callingSettingsResponseSchema = z.object({
  isAcceptingCalls: z.boolean(),
  updatedAt: z.string(),
});

export const initiateCallInputSchema = z.object({
  recipientAddress: z
    .string()
    .min(32, "Wallet address must be at least 32 characters")
    .max(66, "Wallet address cannot exceed 66 characters"),
});

export type InitiateCallInput = z.infer<typeof initiateCallInputSchema>;

export const callRejectInputSchema = z.object({
  reason: z.string().max(64).optional(),
});

export type CallRejectInput = z.infer<typeof callRejectInputSchema>;

export const callSessionViewSchema = z.object({
  id: z.string().uuid(),
  callerWallet: z.string(),
  recipientWallet: z.string(),
  state: z.string(),
  terminalReason: z.string().nullable(),
  durationSeconds: z.number().default(0),
  ringingAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  connectingAt: z.string().nullable(),
  connectedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CallSessionView = z.infer<typeof callSessionViewSchema>;

export const callHistoryQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
  direction: z.enum(["all", "incoming", "outgoing"]).default("all"),
});

export type CallHistoryQuery = z.infer<typeof callHistoryQuerySchema>;

export const callHistoryItemSchema = z.object({
  id: z.string().uuid(),
  callerWallet: z.string(),
  recipientWallet: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  counterpartyWallet: z.string(),
  counterpartyDisplayName: z.string().nullable().optional(),
  counterpartyAvatarUrl: z.string().nullable().optional(),
  state: z.string(),
  terminalReason: z.string().nullable(),
  durationSeconds: z.number(),
  createdAt: z.string(),
  ringingAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  connectingAt: z.string().nullable(),
  connectedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

export type CallHistoryItem = z.infer<typeof callHistoryItemSchema>;

export const callHistoryResponseSchema = z.object({
  calls: z.array(callHistoryItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

export type CallHistoryResponse = z.infer<typeof callHistoryResponseSchema>;

export const iceServersResponseSchema = z.object({
  iceServers: z.array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    })
  ),
});

export type IceServersResponse = z.infer<typeof iceServersResponseSchema>;
