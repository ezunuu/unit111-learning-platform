CREATE TABLE "practice_question_review_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"selected_option_ids" jsonb NOT NULL,
	"is_correct" boolean NOT NULL,
	"awarded_xp" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_review_answer_xp_check" CHECK ("practice_question_review_answers"."awarded_xp" = 0)
);
--> statement-breakpoint
CREATE TABLE "practice_question_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"miss_count" integer DEFAULT 1 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"first_missed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_missed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"mastered_at" timestamp with time zone,
	CONSTRAINT "practice_review_status_check" CHECK ("practice_question_review_queue"."status" in ('open','mastered'))
);
--> statement-breakpoint
ALTER TABLE "practice_question_review_answers" ADD CONSTRAINT "practice_question_review_answers_queue_id_practice_question_review_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."practice_question_review_queue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_question_review_queue" ADD CONSTRAINT "practice_question_review_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_question_review_queue" ADD CONSTRAINT "practice_question_review_queue_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_question_review_queue" ADD CONSTRAINT "practice_question_review_queue_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_review_answer_queue_idx" ON "practice_question_review_answers" USING btree ("queue_id","answered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_review_attempt_question_idx" ON "practice_question_review_queue" USING btree ("user_id","attempt_id","question_id");--> statement-breakpoint
CREATE INDEX "practice_review_user_status_idx" ON "practice_question_review_queue" USING btree ("user_id","status","last_missed_at");