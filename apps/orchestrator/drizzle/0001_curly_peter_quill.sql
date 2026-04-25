ALTER TABLE "agents" ADD COLUMN "model" varchar(60);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "max_turns" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "extended_thinking" varchar(20);