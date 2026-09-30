-- The permanent evolution is gone: drakofruta exists only as a board tile now.
-- These two rows/values must go BEFORE the enums are narrowed, or the cast that
-- follows fails on data the new type cannot hold.
DELETE FROM "game_configs" WHERE "key" = 'evolution';--> statement-breakpoint
UPDATE "egg_types" SET "price_resource" = 'coins' WHERE "price_resource" = 'drakofruta';--> statement-breakpoint
UPDATE "eggs" SET "paid_resource" = 'coins' WHERE "paid_resource" = 'drakofruta';--> statement-breakpoint
ALTER TABLE "players" DROP CONSTRAINT "players_drakofruta_non_negative";--> statement-breakpoint
ALTER TABLE "players" DROP CONSTRAINT "players_evolutions_non_negative";--> statement-breakpoint
ALTER TABLE "game_configs" ALTER COLUMN "key" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."config_key";--> statement-breakpoint
CREATE TYPE "public"."config_key" AS ENUM('stamina', 'play', 'combat', 'eggs');--> statement-breakpoint
ALTER TABLE "game_configs" ALTER COLUMN "key" SET DATA TYPE "public"."config_key" USING "key"::"public"."config_key";--> statement-breakpoint
ALTER TABLE "egg_types" ALTER COLUMN "price_resource" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "egg_types" ALTER COLUMN "price_resource" SET DEFAULT 'coins'::text;--> statement-breakpoint
ALTER TABLE "eggs" ALTER COLUMN "paid_resource" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."resource_kind";--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('food', 'coins');--> statement-breakpoint
ALTER TABLE "egg_types" ALTER COLUMN "price_resource" SET DEFAULT 'coins'::"public"."resource_kind";--> statement-breakpoint
ALTER TABLE "egg_types" ALTER COLUMN "price_resource" SET DATA TYPE "public"."resource_kind" USING "price_resource"::"public"."resource_kind";--> statement-breakpoint
ALTER TABLE "eggs" ALTER COLUMN "paid_resource" SET DATA TYPE "public"."resource_kind" USING "paid_resource"::"public"."resource_kind";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "drakofruta";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "evolutions_performed";