CREATE TABLE "active_call_participants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"call_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "active_call_participants" ADD CONSTRAINT "active_call_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_call_participants" ADD CONSTRAINT "active_call_participants_call_id_call_sessions_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_active_call_participants_call_id" ON "active_call_participants" USING btree ("call_id");--> statement-breakpoint
INSERT INTO "active_call_participants" ("user_id", "call_id", "role", "created_at")
SELECT "caller_user_id", "id", 'caller', "created_at"
FROM "call_sessions"
WHERE "state" IN ('initiated', 'ringing', 'accepted', 'connecting', 'connected')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "active_call_participants" ("user_id", "call_id", "role", "created_at")
SELECT "recipient_user_id", "id", 'recipient', "created_at"
FROM "call_sessions"
WHERE "state" IN ('initiated', 'ringing', 'accepted', 'connecting', 'connected')
ON CONFLICT DO NOTHING;