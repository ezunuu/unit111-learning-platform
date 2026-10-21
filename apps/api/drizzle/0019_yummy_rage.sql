ALTER TABLE "lesson_theory_progress" ADD COLUMN "current_block_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "lesson_theory_progress" SET "current_block_order" = GREATEST("max_viewed_order" + 1, 0);--> statement-breakpoint
ALTER TABLE "lesson_theory_progress" ADD CONSTRAINT "lesson_theory_progress_current_order_check" CHECK ("lesson_theory_progress"."current_block_order" >= 0);
