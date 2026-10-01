ALTER TABLE "players" ADD COLUMN "free_stones" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creatures" ADD COLUMN "evolution_unlocked_at" timestamp with time zone;