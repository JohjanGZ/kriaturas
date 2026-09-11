-- The model changed under them: creatures no longer have health, so a battle
-- started before this cannot be carried over. End them rather than leave rows
-- that describe a game that no longer exists.
UPDATE "battles" SET status = 'abandoned', ended_at = now() WHERE status = 'active';--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "rivals" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "battles" ALTER COLUMN "rivals" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_rivals_is_array" CHECK (jsonb_typeof("battles"."rivals") = 'array');