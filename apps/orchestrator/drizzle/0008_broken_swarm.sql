ALTER TABLE "github_connections" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_connections" ADD COLUMN "installation_id" integer;