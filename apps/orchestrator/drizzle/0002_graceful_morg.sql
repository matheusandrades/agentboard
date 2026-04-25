CREATE TABLE IF NOT EXISTS "previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"task_id" uuid,
	"name" varchar(200) NOT NULL,
	"service" varchar(100),
	"workdir" text NOT NULL,
	"url" text NOT NULL,
	"host_port" integer NOT NULL,
	"internal_port" integer,
	"container_id" varchar(128),
	"project_name" varchar(100),
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "previews" ADD CONSTRAINT "previews_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "previews" ADD CONSTRAINT "previews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
