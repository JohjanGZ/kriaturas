CREATE TABLE "incubators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity_days" integer DEFAULT 1 NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incubators_capacity_positive" CHECK ("incubators"."capacity_days" > 0),
	CONSTRAINT "incubators_paid_non_negative" CHECK ("incubators"."paid_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "egg_types" ADD COLUMN "electricity_cost" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "eggs" ADD COLUMN "incubator_id" uuid;--> statement-breakpoint
ALTER TABLE "incubators" ADD CONSTRAINT "incubators_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "incubators_player_idx" ON "incubators" USING btree ("player_id");--> statement-breakpoint
ALTER TABLE "eggs" ADD CONSTRAINT "eggs_incubator_id_incubators_id_fk" FOREIGN KEY ("incubator_id") REFERENCES "public"."incubators"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "eggs_incubator_idx" ON "eggs" USING btree ("incubator_id");