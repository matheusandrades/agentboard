CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" varchar(60) NOT NULL,
	"actor" varchar(200),
	"payload" jsonb NOT NULL,
	"prev_hash" varchar(64),
	"hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"agent_id" uuid,
	"task_id" uuid,
	"title" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(200) NOT NULL,
	"target_url" text NOT NULL,
	"kinds" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"template" varchar(30) DEFAULT 'slack' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" uuid,
	"task_id" uuid,
	"session_id" text,
	"model" varchar(60) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"succeeded" boolean DEFAULT true NOT NULL,
	"timed_out" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "daily_cost_cap_micro_usd" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "total_cost_cap_micro_usd" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decisions" ADD CONSTRAINT "decisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_kind" ON "audit_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_agent_recent" ON "usage_events" USING btree ("agent_id","ended_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_ended" ON "usage_events" USING btree ("ended_at");