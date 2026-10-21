ALTER TABLE "lesson_content_blocks" ADD COLUMN "review_status" varchar(16) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD COLUMN "created_by" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD CONSTRAINT "lesson_content_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD CONSTRAINT "lesson_content_blocks_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD CONSTRAINT "lesson_content_block_status_check" CHECK ("lesson_content_blocks"."review_status" in ('draft','approved','rejected'));--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD CONSTRAINT "lesson_content_block_type_check" CHECK ("lesson_content_blocks"."block_type" in ('text','image','key_concept','terminology','technical_specification','knowledge_check','summary'));