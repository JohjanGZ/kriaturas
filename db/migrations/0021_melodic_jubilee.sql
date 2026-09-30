ALTER TYPE "public"."config_key" ADD VALUE 'health';--> statement-breakpoint
ALTER TABLE "creatures" ADD COLUMN "sick_since" timestamp with time zone;