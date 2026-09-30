ALTER TABLE "battle_creatures" ADD COLUMN "blocked_turns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battle_creatures" ADD COLUMN "paralyzed_turns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "player_poison_per_move" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "player_poison_turns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "rival_poison_per_move" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "rival_poison_turns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "player_move_penalty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "rival_move_penalty" integer DEFAULT 0 NOT NULL;