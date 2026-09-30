CREATE TABLE "battle_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"rule" text NOT NULL,
	"icon" text DEFAULT '🎲' NOT NULL,
	"image_path" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_fields_weight_positive" CHECK ("battle_fields"."weight" > 0),
	CONSTRAINT "battle_fields_kind_is_known" CHECK ("battle_fields"."kind" in ('remolino', 'minado', 'volcan', 'sequia', 'vergel', 'santuario', 'paramo', 'duelo', 'resonancia', 'vendaval'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "battle_fields_kind_key" ON "battle_fields" USING btree ("kind");