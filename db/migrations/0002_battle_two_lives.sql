ALTER TABLE "battles" DROP CONSTRAINT "battles_enemy_index_non_negative";--> statement-breakpoint
ALTER TABLE "battles" DROP CONSTRAINT "battles_enemies_is_array";--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "opponent_max_hp" integer;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "opponent_hp" integer;--> statement-breakpoint
-- Backfill before tightening: both players share the same fixed life, so an
-- existing battle's opponent starts from the same maximum the player got.
UPDATE "battles" SET "opponent_max_hp" = "player_max_hp", "opponent_hp" = "player_max_hp"
  WHERE "opponent_max_hp" IS NULL;--> statement-breakpoint
ALTER TABLE "battles" ALTER COLUMN "opponent_max_hp" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ALTER COLUMN "opponent_hp" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_opponent_hp_in_range" CHECK ("battles"."opponent_hp" >= 0 and "battles"."opponent_hp" <= "battles"."opponent_max_hp");