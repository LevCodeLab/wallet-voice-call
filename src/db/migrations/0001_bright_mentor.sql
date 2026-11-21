CREATE TABLE "call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_user_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"caller_wallet" varchar(66) NOT NULL,
	"recipient_wallet" varchar(66) NOT NULL,
	"state" varchar(20) DEFAULT 'initiated' NOT NULL,
	"terminal_reason" varchar(64),
	"ringing_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"connecting_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"is_accepting_calls" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_caller_user_id_users_id_fk" FOREIGN KEY ("caller_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_settings" ADD CONSTRAINT "call_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_call_sessions_caller_state" ON "call_sessions" USING btree ("caller_user_id","state");--> statement-breakpoint
CREATE INDEX "idx_call_sessions_recipient_state" ON "call_sessions" USING btree ("recipient_user_id","state");--> statement-breakpoint
CREATE INDEX "idx_call_sessions_state" ON "call_sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_call_sessions_created_at" ON "call_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_call_settings_user_id" ON "call_settings" USING btree ("user_id");