ALTER TABLE "battle_creatures" ADD COLUMN "evolved_in_battle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "fruits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "rival_fruits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_fruits_non_negative" CHECK ("battles"."fruits" >= 0 and "battles"."rival_fruits" >= 0);