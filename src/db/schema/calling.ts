import { pgTable, uuid, varchar, boolean, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

/**
 * User calling settings and incoming call preferences
 */
export const callSettings = pgTable(
  "call_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isAcceptingCalls: boolean("is_accepting_calls").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_call_settings_user_id").on(table.userId),
  ]
);

/**
 * Call sessions and lifecycle state tracking
 */
export const callSessions = pgTable(
  "call_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callerUserId: uuid("caller_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    callerWallet: varchar("caller_wallet", { length: 66 }).notNull(),
    recipientWallet: varchar("recipient_wallet", { length: 66 }).notNull(),
    state: varchar("state", { length: 20 }).notNull().default("initiated"),
    terminalReason: varchar("terminal_reason", { length: 64 }),
    durationSeconds: integer("duration_seconds").default(0).notNull(),
    ringingAt: timestamp("ringing_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    connectingAt: timestamp("connecting_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_call_sessions_caller_state").on(table.callerUserId, table.state),
    index("idx_call_sessions_recipient_state").on(table.recipientUserId, table.state),
    index("idx_call_sessions_state").on(table.state),
    index("idx_call_sessions_created_at").on(table.createdAt),
    index("idx_call_sessions_caller_history").on(table.callerUserId, table.createdAt),
    index("idx_call_sessions_recipient_history").on(table.recipientUserId, table.createdAt),
    index("idx_call_sessions_caller_wallet").on(table.callerWallet),
    index("idx_call_sessions_recipient_wallet").on(table.recipientWallet),
    uniqueIndex("idx_unique_active_call_caller")
      .on(table.callerUserId)
      .where(sql`state IN ('initiated', 'ringing', 'accepted', 'connecting', 'connected')`),
    uniqueIndex("idx_unique_active_call_recipient")
      .on(table.recipientUserId)
      .where(sql`state IN ('initiated', 'ringing', 'accepted', 'connecting', 'connected')`),
  ]
);

export type CallSetting = typeof callSettings.$inferSelect;
export type NewCallSetting = typeof callSettings.$inferInsert;

export type CallSession = typeof callSessions.$inferSelect;
export type NewCallSession = typeof callSessions.$inferInsert;

/**
 * Active call participant reservations
 * Enforces strictly 1 active call per user across ANY role (caller or recipient)
 * via userId PRIMARY KEY constraint at the database storage layer.
 */
export const activeCallParticipants = pgTable(
  "active_call_participants",
  {
    userId: uuid("user_id")
      .notNull()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    callId: uuid("call_id")
      .notNull()
      .references(() => callSessions.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).notNull(), // 'caller' | 'recipient'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_active_call_participants_call_id").on(table.callId),
  ]
);

export type ActiveCallParticipant = typeof activeCallParticipants.$inferSelect;
export type NewActiveCallParticipant = typeof activeCallParticipants.$inferInsert;

