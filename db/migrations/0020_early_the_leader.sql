ALTER TYPE "public"."config_key" ADD VALUE 'corrals';--> statement-breakpoint
CREATE TABLE "corrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 6 NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corrals_capacity_positive" CHECK ("corrals"."capacity" > 0),
	CONSTRAINT "corrals_paid_non_negative" CHECK ("corrals"."paid_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "creatures" ADD COLUMN "corral_id" uuid;--> statement-breakpoint
ALTER TABLE "corrals" ADD CONSTRAINT "corrals_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "corrals_player_idx" ON "corrals" USING btree ("player_id");--> statement-breakpoint
ALTER TABLE "creatures" ADD CONSTRAINT "creatures_corral_id_corrals_id_fk" FOREIGN KEY ("corral_id") REFERENCES "public"."corrals"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "creatures_corral_idx" ON "creatures" USING btree ("corral_id");