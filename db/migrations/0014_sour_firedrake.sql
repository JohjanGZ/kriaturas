ALTER TABLE "battles" ADD COLUMN "opponent_shield" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "opponent_shield_turns" integer DEFAULT 0 NOT NULL;