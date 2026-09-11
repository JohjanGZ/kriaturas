CREATE TYPE "public"."battle_status" AS ENUM('active', 'won', 'lost', 'abandoned');--> statement-breakpoint
CREATE TABLE "battle_creatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"battle_id" uuid NOT NULL,
	"creature_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"mana" integer DEFAULT 0 NOT NULL,
	"mana_cost" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_creatures_mana_non_negative" CHECK ("battle_creatures"."mana" >= 0),
	CONSTRAINT "battle_creatures_mana_cost_positive" CHECK ("battle_creatures"."mana_cost" > 0),
	CONSTRAINT "battle_creatures_slot_non_negative" CHECK ("battle_creatures"."slot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"status" "battle_status" DEFAULT 'active' NOT NULL,
	"board" jsonb NOT NULL,
	"enemies" jsonb NOT NULL,
	"current_enemy_index" integer DEFAULT 0 NOT NULL,
	"player_max_hp" integer NOT NULL,
	"player_hp" integer NOT NULL,
	"shield" integer DEFAULT 0 NOT NULL,
	"shield_turns" integer DEFAULT 0 NOT NULL,
	"turn" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battles_hp_in_range" CHECK ("battles"."player_hp" >= 0 and "battles"."player_hp" <= "battles"."player_max_hp"),
	CONSTRAINT "battles_shield_non_negative" CHECK ("battles"."shield" >= 0),
	CONSTRAINT "battles_turn_non_negative" CHECK ("battles"."turn" >= 0),
	CONSTRAINT "battles_enemy_index_non_negative" CHECK ("battles"."current_enemy_index" >= 0),
	CONSTRAINT "battles_finished_has_ended_at" CHECK (("battles"."status" = 'active' and "battles"."ended_at" is null) or ("battles"."status" <> 'active' and "battles"."ended_at" is not null)),
	CONSTRAINT "battles_board_is_object" CHECK (jsonb_typeof("battles"."board") = 'object'),
	CONSTRAINT "battles_enemies_is_array" CHECK (jsonb_typeof("battles"."enemies") = 'array')
);
--> statement-breakpoint
ALTER TABLE "species" ADD COLUMN "mana_cost" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "battle_creatures" ADD CONSTRAINT "battle_creatures_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "battle_creatures" ADD CONSTRAINT "battle_creatures_creature_id_creatures_id_fk" FOREIGN KEY ("creature_id") REFERENCES "public"."creatures"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "battle_creatures_battle_creature_key" ON "battle_creatures" USING btree ("battle_id","creature_id");--> statement-breakpoint
CREATE UNIQUE INDEX "battle_creatures_battle_slot_key" ON "battle_creatures" USING btree ("battle_id","slot");--> statement-breakpoint
CREATE INDEX "battles_player_idx" ON "battles" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "battles_one_active_per_player" ON "battles" USING btree ("player_id") WHERE "battles"."status" = 'active';--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_mana_cost_positive" CHECK ("species"."mana_cost" > 0);