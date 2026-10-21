CREATE TYPE "public"."lesson_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "lesson_questions" (
	"lesson_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_order" integer NOT NULL,
	CONSTRAINT "lesson_questions_lesson_id_question_id_pk" PRIMARY KEY("lesson_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"status" "lesson_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_question_order_idx" ON "lesson_questions" USING btree ("lesson_id","question_order");--> statement-breakpoint
CREATE INDEX "lessons_status_category_idx" ON "lessons" USING btree ("status","category_id");