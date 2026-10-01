ALTER TYPE "public"."config_key" ADD VALUE 'affinity';--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "last_nest_check" date;--> statement-breakpoint
ALTER TABLE "creatures" ADD COLUMN "affinity_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creatures" ADD COLUMN "affinity_at" timestamp with time zone DEFAULT now() NOT NULL;