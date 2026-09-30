CREATE TABLE "season_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"species_id" uuid NOT NULL,
	"attack_delta" integer DEFAULT 0 NOT NULL,
	"mana_cost_delta" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_adjustments" ADD CONSTRAINT "season_adjustments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "season_adjustments" ADD CONSTRAINT "season_adjustments_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "season_adjustments_season_species_key" ON "season_adjustments" USING btree ("season_id","species_id");--> statement-breakpoint
CREATE INDEX "season_adjustments_season_idx" ON "season_adjustments" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_one_active" ON "seasons" USING btree ("is_active") WHERE "seasons"."is_active";