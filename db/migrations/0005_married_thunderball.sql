ALTER TABLE "battles" ADD COLUMN "moves_left" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "extra_move_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_moves_left_non_negative" CHECK ("battles"."moves_left" >= 0);