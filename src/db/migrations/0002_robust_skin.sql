ALTER TABLE "call_sessions" ADD COLUMN "duration_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_call_sessions_caller_history" ON "call_sessions" USING btree ("caller_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_call_sessions_recipient_history" ON "call_sessions" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_call_sessions_caller_wallet" ON "call_sessions" USING btree ("caller_wallet");--> statement-breakpoint
CREATE INDEX "idx_call_sessions_recipient_wallet" ON "call_sessions" USING btree ("recipient_wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_active_call_caller" ON "call_sessions" USING btree ("caller_user_id") WHERE state IN ('initiated', 'ringing', 'accepted', 'connecting', 'connected');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_active_call_recipient" ON "call_sessions" USING btree ("recipient_user_id") WHERE state IN ('initiated', 'ringing', 'accepted', 'connecting', 'connected');