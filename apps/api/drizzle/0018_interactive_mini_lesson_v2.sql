ALTER TABLE "lessons" ADD COLUMN "theory_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" DROP CONSTRAINT "lesson_content_block_status_check";--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD CONSTRAINT "lesson_content_block_status_check" CHECK ("lesson_content_blocks"."review_status" in ('draft','pending_review','approved','rejected'));--> statement-breakpoint
CREATE TABLE "lesson_theory_progress" (
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"content_version" varchar(64) NOT NULL,
	"max_viewed_order" integer DEFAULT -1 NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_theory_progress_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id")
);--> statement-breakpoint
ALTER TABLE "lesson_theory_progress" ADD CONSTRAINT "lesson_theory_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_theory_progress" ADD CONSTRAINT "lesson_theory_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_theory_progress_lesson_idx" ON "lesson_theory_progress" USING btree ("lesson_id");
