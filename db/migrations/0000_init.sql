CREATE TYPE "public"."config_key" AS ENUM('stamina', 'play', 'evolution', 'combat', 'eggs');--> statement-breakpoint
CREATE TYPE "public"."egg_status" AS ENUM('incubating', 'hatched', 'spoiled');--> statement-breakpoint
CREATE TYPE "public"."element" AS ENUM('fire', 'water', 'plant', 'psychic', 'light', 'ice', 'poison', 'astral', 'rock');--> statement-breakpoint
CREATE TYPE "public"."objective_metric" AS ENUM('matches_played', 'matches_won', 'damage_dealt', 'enemies_defeated', 'element_gems_cleared', 'max_combo', 'days_cared', 'times_fed', 'evolutions_performed');--> statement-breakpoint
CREATE TYPE "public"."objective_scope" AS ENUM('creature', 'player');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('food', 'drakofruta', 'coins');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('player', 'admin');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"role" "user_role" DEFAULT 'player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"food" integer DEFAULT 0 NOT NULL,
	"drakofruta" integer DEFAULT 0 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"evolutions_performed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_food_non_negative" CHECK ("players"."food" >= 0),
	CONSTRAINT "players_drakofruta_non_negative" CHECK ("players"."drakofruta" >= 0),
	CONSTRAINT "players_coins_non_negative" CHECK ("players"."coins" >= 0),
	CONSTRAINT "players_evolutions_non_negative" CHECK ("players"."evolutions_performed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "species" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_element" "element" NOT NULL,
	"base_image_path" text,
	"base_hp" integer NOT NULL,
	"base_attack" integer NOT NULL,
	"base_defense" integer NOT NULL,
	"description" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "species_base_element_is_base" CHECK ("species"."base_element" in ('fire', 'water', 'plant', 'psychic')),
	CONSTRAINT "species_base_hp_positive" CHECK ("species"."base_hp" > 0),
	CONSTRAINT "species_base_attack_non_negative" CHECK ("species"."base_attack" >= 0),
	CONSTRAINT "species_base_defense_non_negative" CHECK ("species"."base_defense" >= 0),
	CONSTRAINT "species_effects_is_array" CHECK (jsonb_typeof("species"."effects") = 'array')
);
--> statement-breakpoint
CREATE TABLE "evolution_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"species_id" uuid NOT NULL,
	"target_element" "element" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_path" text,
	"hp_bonus" integer DEFAULT 0 NOT NULL,
	"attack_bonus" integer DEFAULT 0 NOT NULL,
	"defense_bonus" integer DEFAULT 0 NOT NULL,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evolution_paths_target_is_evolved" CHECK ("evolution_paths"."target_element" in ('light', 'ice', 'poison', 'astral', 'rock')),
	CONSTRAINT "evolution_paths_hp_bonus_non_negative" CHECK ("evolution_paths"."hp_bonus" >= 0),
	CONSTRAINT "evolution_paths_attack_bonus_non_negative" CHECK ("evolution_paths"."attack_bonus" >= 0),
	CONSTRAINT "evolution_paths_defense_bonus_non_negative" CHECK ("evolution_paths"."defense_bonus" >= 0),
	CONSTRAINT "evolution_paths_effects_is_array" CHECK (jsonb_typeof("evolution_paths"."effects") = 'array')
);
--> statement-breakpoint
CREATE TABLE "evolution_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evolution_path_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objective_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objective_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"creature_id" uuid,
	"current_value" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objective_progress_value_non_negative" CHECK ("objective_progress"."current_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metric" "objective_metric" NOT NULL,
	"scope" "objective_scope" DEFAULT 'creature' NOT NULL,
	"target_value" integer NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objectives_target_positive" CHECK ("objectives"."target_value" > 0),
	CONSTRAINT "objectives_params_is_object" CHECK (jsonb_typeof("objectives"."params") = 'object')
);
--> statement-breakpoint
CREATE TABLE "creatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"species_id" uuid NOT NULL,
	"nickname" text,
	"evolution_path_id" uuid,
	"evolution_chosen_at" timestamp with time zone,
	"is_evolved" boolean DEFAULT false NOT NULL,
	"evolved_at" timestamp with time zone,
	"last_fed" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creatures_evolved_state_consistent" CHECK (("creatures"."is_evolved" = false and "creatures"."evolved_at" is null)
          or ("creatures"."is_evolved" = true and "creatures"."evolved_at" is not null and "creatures"."evolution_path_id" is not null)),
	CONSTRAINT "creatures_path_choice_consistent" CHECK (("creatures"."evolution_path_id" is null) = ("creatures"."evolution_chosen_at" is null))
);
--> statement-breakpoint
CREATE TABLE "egg_care_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"egg_id" uuid NOT NULL,
	"care_date" date NOT NULL,
	"cared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "egg_type_species" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"egg_type_id" uuid NOT NULL,
	"species_id" uuid NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "egg_type_species_weight_positive" CHECK ("egg_type_species"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "egg_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_path" text,
	"price_amount" integer NOT NULL,
	"price_resource" "resource_kind" DEFAULT 'coins' NOT NULL,
	"care_days_required" integer NOT NULL,
	"max_missed_days" integer DEFAULT 1 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "egg_types_price_positive" CHECK ("egg_types"."price_amount" > 0),
	CONSTRAINT "egg_types_care_days_positive" CHECK ("egg_types"."care_days_required" > 0),
	CONSTRAINT "egg_types_max_missed_non_negative" CHECK ("egg_types"."max_missed_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "eggs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"egg_type_id" uuid NOT NULL,
	"species_id" uuid NOT NULL,
	"status" "egg_status" DEFAULT 'incubating' NOT NULL,
	"paid_amount" integer NOT NULL,
	"paid_resource" "resource_kind" NOT NULL,
	"care_days_completed" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"last_cared_at" timestamp with time zone,
	"hatched_at" timestamp with time zone,
	"spoiled_at" timestamp with time zone,
	"creature_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eggs_paid_amount_positive" CHECK ("eggs"."paid_amount" > 0),
	CONSTRAINT "eggs_care_days_non_negative" CHECK ("eggs"."care_days_completed" >= 0),
	CONSTRAINT "eggs_streak_non_negative" CHECK ("eggs"."current_streak" >= 0),
	CONSTRAINT "eggs_hatched_state_consistent" CHECK (("eggs"."status" <> 'hatched' and "eggs"."hatched_at" is null and "eggs"."creature_id" is null)
          or ("eggs"."status" = 'hatched' and "eggs"."hatched_at" is not null)),
	CONSTRAINT "eggs_spoiled_state_consistent" CHECK (("eggs"."status" <> 'spoiled' and "eggs"."spoiled_at" is null)
          or ("eggs"."status" = 'spoiled' and "eggs"."spoiled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "game_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"key" "config_key" NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evolution_paths" ADD CONSTRAINT "evolution_paths_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evolution_requirements" ADD CONSTRAINT "evolution_requirements_evolution_path_id_evolution_paths_id_fk" FOREIGN KEY ("evolution_path_id") REFERENCES "public"."evolution_paths"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evolution_requirements" ADD CONSTRAINT "evolution_requirements_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "objective_progress" ADD CONSTRAINT "objective_progress_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "objective_progress" ADD CONSTRAINT "objective_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "objective_progress" ADD CONSTRAINT "objective_progress_creature_id_creatures_id_fk" FOREIGN KEY ("creature_id") REFERENCES "public"."creatures"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "creatures" ADD CONSTRAINT "creatures_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "creatures" ADD CONSTRAINT "creatures_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "creatures" ADD CONSTRAINT "creatures_evolution_path_id_evolution_paths_id_fk" FOREIGN KEY ("evolution_path_id") REFERENCES "public"."evolution_paths"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "egg_care_log" ADD CONSTRAINT "egg_care_log_egg_id_eggs_id_fk" FOREIGN KEY ("egg_id") REFERENCES "public"."eggs"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "egg_type_species" ADD CONSTRAINT "egg_type_species_egg_type_id_egg_types_id_fk" FOREIGN KEY ("egg_type_id") REFERENCES "public"."egg_types"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "egg_type_species" ADD CONSTRAINT "egg_type_species_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "eggs" ADD CONSTRAINT "eggs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "eggs" ADD CONSTRAINT "eggs_egg_type_id_egg_types_id_fk" FOREIGN KEY ("egg_type_id") REFERENCES "public"."egg_types"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "eggs" ADD CONSTRAINT "eggs_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "eggs" ADD CONSTRAINT "eggs_creature_id_creatures_id_fk" FOREIGN KEY ("creature_id") REFERENCES "public"."creatures"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "game_configs" ADD CONSTRAINT "game_configs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "players_user_id_key" ON "players" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "species_slug_key" ON "species" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "species_base_element_idx" ON "species" USING btree ("base_element");--> statement-breakpoint
CREATE INDEX "species_is_published_idx" ON "species" USING btree ("is_published");--> statement-breakpoint
CREATE UNIQUE INDEX "evolution_paths_species_target_key" ON "evolution_paths" USING btree ("species_id","target_element");--> statement-breakpoint
CREATE INDEX "evolution_paths_species_idx" ON "evolution_paths" USING btree ("species_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evolution_paths_one_default_per_species" ON "evolution_paths" USING btree ("species_id") WHERE "evolution_paths"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "evolution_requirements_path_objective_key" ON "evolution_requirements" USING btree ("evolution_path_id","objective_id");--> statement-breakpoint
CREATE INDEX "evolution_requirements_objective_idx" ON "evolution_requirements" USING btree ("objective_id");--> statement-breakpoint
CREATE UNIQUE INDEX "objective_progress_creature_key" ON "objective_progress" USING btree ("objective_id","creature_id") WHERE "objective_progress"."creature_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "objective_progress_player_key" ON "objective_progress" USING btree ("objective_id","player_id") WHERE "objective_progress"."creature_id" is null;--> statement-breakpoint
CREATE INDEX "objective_progress_player_idx" ON "objective_progress" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "objectives_code_key" ON "objectives" USING btree ("code");--> statement-breakpoint
CREATE INDEX "objectives_metric_idx" ON "objectives" USING btree ("metric");--> statement-breakpoint
CREATE INDEX "creatures_player_id_idx" ON "creatures" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "creatures_species_id_idx" ON "creatures" USING btree ("species_id");--> statement-breakpoint
CREATE INDEX "creatures_evolution_path_idx" ON "creatures" USING btree ("evolution_path_id");--> statement-breakpoint
CREATE UNIQUE INDEX "egg_care_log_egg_date_key" ON "egg_care_log" USING btree ("egg_id","care_date");--> statement-breakpoint
CREATE INDEX "egg_care_log_egg_idx" ON "egg_care_log" USING btree ("egg_id");--> statement-breakpoint
CREATE UNIQUE INDEX "egg_type_species_key" ON "egg_type_species" USING btree ("egg_type_id","species_id");--> statement-breakpoint
CREATE INDEX "egg_type_species_species_idx" ON "egg_type_species" USING btree ("species_id");--> statement-breakpoint
CREATE UNIQUE INDEX "egg_types_slug_key" ON "egg_types" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "egg_types_is_published_idx" ON "egg_types" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "eggs_player_idx" ON "eggs" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "eggs_status_idx" ON "eggs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "eggs_creature_key" ON "eggs" USING btree ("creature_id") WHERE "eggs"."creature_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "game_configs_game_id_key_key" ON "game_configs" USING btree ("game_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "games_slug_key" ON "games" USING btree ("slug");