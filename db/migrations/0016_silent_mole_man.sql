CREATE TABLE "species_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"species_id" uuid NOT NULL,
	"element" "element" NOT NULL,
	"name" text,
	"image_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "species_forms_element_is_base" CHECK ("species_forms"."element" in ('fire', 'water', 'plant', 'psychic'))
);
--> statement-breakpoint
ALTER TABLE "species" DROP CONSTRAINT "species_base_element_is_base";--> statement-breakpoint
ALTER TABLE "species" ALTER COLUMN "base_element" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "creatures" ADD COLUMN "element" "element";--> statement-breakpoint
ALTER TABLE "creatures" ADD COLUMN "awakened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "species_forms" ADD CONSTRAINT "species_forms_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "species_forms_species_element_key" ON "species_forms" USING btree ("species_id","element");--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_base_element_is_base" CHECK ("species"."base_element" is null or "species"."base_element" in ('fire', 'water', 'plant', 'psychic'));--> statement-breakpoint
ALTER TABLE "creatures" ADD CONSTRAINT "creatures_awakened_state_consistent" CHECK (("creatures"."element" is null and "creatures"."awakened_at" is null)
          or ("creatures"."element" is not null and "creatures"."awakened_at" is not null
              and "creatures"."element" in ('fire', 'water', 'plant', 'psychic')));