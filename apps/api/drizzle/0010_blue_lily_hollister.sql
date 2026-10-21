CREATE TYPE "public"."learning_attempt_mode" AS ENUM('lesson', 'review');--> statement-breakpoint
CREATE TYPE "public"."learning_attempt_status" AS ENUM('in_progress', 'passed', 'failed', 'review_completed');--> statement-breakpoint
CREATE TABLE "learning_attempt_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_option_ids" jsonb NOT NULL,
	"is_correct" boolean NOT NULL,
	"awarded_xp" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_attempt_questions" (
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_order" integer NOT NULL,
	"xp" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "learning_attempt_questions_attempt_id_question_id_pk" PRIMARY KEY("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "learning_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"mode" "learning_attempt_mode" DEFAULT 'lesson' NOT NULL,
	"status" "learning_attempt_status" DEFAULT 'in_progress' NOT NULL,
	"current_question_order" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"earned_xp" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"xp_earned" integer DEFAULT 0 NOT NULL,
	"correct_count" integer NOT NULL,
	"accuracy" real NOT NULL,
	CONSTRAINT "lesson_progress_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "is_test" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "lesson_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "xp" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_attempt_answers" ADD CONSTRAINT "learning_attempt_answers_attempt_id_learning_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."learning_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempt_answers" ADD CONSTRAINT "learning_attempt_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempt_questions" ADD CONSTRAINT "learning_attempt_questions_attempt_id_learning_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."learning_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempt_questions" ADD CONSTRAINT "learning_attempt_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_attempt_answer_idx" ON "learning_attempt_answers" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_attempt_question_order_idx" ON "learning_attempt_questions" USING btree ("attempt_id","question_order");--> statement-breakpoint
CREATE INDEX "learning_attempt_user_lesson_idx" ON "learning_attempts" USING btree ("user_id","lesson_id","status");--> statement-breakpoint
CREATE INDEX "lessons_status_order_idx" ON "lessons" USING btree ("status","lesson_order");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_xp_nonnegative_check" CHECK ("questions"."xp" >= 0);
