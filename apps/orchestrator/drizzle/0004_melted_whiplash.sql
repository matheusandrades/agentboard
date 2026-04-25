CREATE TABLE IF NOT EXISTS "github_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" varchar(20) NOT NULL,
	"login" varchar(200) NOT NULL,
	"access_token" text,
	"scopes" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"repo_owner" varchar(100) NOT NULL,
	"repo_name" varchar(100) NOT NULL,
	"default_branch" varchar(120) DEFAULT 'main' NOT NULL,
	"clone_path" text,
	"visibility" varchar(20) DEFAULT 'private' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "branch" varchar(200);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "pr_url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "pr_number" integer;