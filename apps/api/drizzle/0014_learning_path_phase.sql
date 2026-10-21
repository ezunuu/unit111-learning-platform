CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"rule_type" varchar(40) NOT NULL,
	"threshold" integer DEFAULT 1 NOT NULL,
	"xp_reward" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievements_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"chapter_order" integer DEFAULT 0 NOT NULL,
	"required_lessons_completed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"course_order" integer DEFAULT 0 NOT NULL,
	"free_learning_mode" boolean DEFAULT false NOT NULL,
	"default_lesson_pass_percentage" integer DEFAULT 80 NOT NULL,
	"chapter_quiz_pass_percentage" integer DEFAULT 70 NOT NULL,
	"lesson_completion_xp" integer DEFAULT 10 NOT NULL,
	"lesson_pass_xp" integer DEFAULT 15 NOT NULL,
	"perfect_practice_xp" integer DEFAULT 10 NOT NULL,
	"chapter_quiz_xp" integer DEFAULT 30 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_lesson_threshold_check" CHECK ("courses"."default_lesson_pass_percentage" between 0 and 100),
	CONSTRAINT "courses_chapter_threshold_check" CHECK ("courses"."chapter_quiz_pass_percentage" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "learning_activity_days" (
	"user_id" uuid NOT NULL,
	"activity_date" date NOT NULL,
	"activity_count" integer DEFAULT 0 NOT NULL,
	"xp_earned" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_activity_days_user_id_activity_date_pk" PRIMARY KEY("user_id","activity_date")
);
--> statement-breakpoint
CREATE TABLE "lesson_content_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"block_order" integer NOT NULL,
	"block_type" varchar(32) NOT NULL,
	"content" jsonb NOT NULL,
	"source_document" text,
	"source_revision" text,
	"source_page" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"source_attempt_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"miss_count" integer DEFAULT 1 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"first_missed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_missed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mastered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"achievement_id" uuid NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "xp_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_key" varchar(200) NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"amount" integer NOT NULL,
	"lesson_id" uuid,
	"chapter_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_transaction_positive_check" CHECK ("xp_transactions"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "pass_percentage" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "completion_xp" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "pass_xp" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "perfect_xp" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "estimated_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "learning_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" varchar(80) DEFAULT 'Asia/Ulaanbaatar' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_activity_days" ADD CONSTRAINT "learning_activity_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD CONSTRAINT "lesson_content_blocks_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_review_queue" ADD CONSTRAINT "question_review_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_review_queue" ADD CONSTRAINT "question_review_queue_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_review_queue" ADD CONSTRAINT "question_review_queue_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_review_queue" ADD CONSTRAINT "question_review_queue_source_attempt_id_learning_attempts_id_fk" FOREIGN KEY ("source_attempt_id") REFERENCES "public"."learning_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_course_order_idx" ON "chapters" USING btree ("course_id","chapter_order");--> statement-breakpoint
CREATE INDEX "chapters_course_status_idx" ON "chapters" USING btree ("course_id","status");--> statement-breakpoint
CREATE INDEX "courses_status_order_idx" ON "courses" USING btree ("status","course_order");--> statement-breakpoint
CREATE INDEX "learning_activity_user_date_idx" ON "learning_activity_days" USING btree ("user_id","activity_date");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_content_block_order_idx" ON "lesson_content_blocks" USING btree ("lesson_id","block_order");--> statement-breakpoint
CREATE INDEX "lesson_content_block_lesson_idx" ON "lesson_content_blocks" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_review_open_idx" ON "question_review_queue" USING btree ("user_id","question_id") WHERE "question_review_queue"."status" = 'open';--> statement-breakpoint
CREATE INDEX "question_review_user_status_idx" ON "question_review_queue" USING btree ("user_id","status","last_missed_at");--> statement-breakpoint
CREATE INDEX "user_achievement_earned_idx" ON "user_achievements" USING btree ("user_id","earned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_transaction_user_source_idx" ON "xp_transactions" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE INDEX "xp_transaction_user_date_idx" ON "xp_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lessons_chapter_order_idx" ON "lessons" USING btree ("chapter_id","lesson_order");--> statement-breakpoint
CREATE UNIQUE INDEX "quizzes_chapter_id_unique_idx" ON "quizzes" USING btree ("chapter_id") WHERE "quizzes"."chapter_id" is not null;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_pass_percentage_check" CHECK ("lessons"."pass_percentage" between 0 and 100);
--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_xp_nonnegative_check" CHECK ("lessons"."completion_xp" >= 0 and "lessons"."pass_xp" >= 0 and "lessons"."perfect_xp" >= 0 and "lessons"."estimated_minutes" > 0);
--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_xp_nonnegative_check" CHECK ("courses"."lesson_completion_xp" >= 0 and "courses"."lesson_pass_xp" >= 0 and "courses"."perfect_practice_xp" >= 0 and "courses"."chapter_quiz_xp" >= 0);
--> statement-breakpoint
ALTER TABLE "lesson_content_blocks" ADD CONSTRAINT "lesson_content_blocks_array_check" CHECK (jsonb_typeof("content") = 'object');
--> statement-breakpoint
INSERT INTO "achievements" ("code", "title", "description", "rule_type", "threshold", "xp_reward") VALUES
('first_lesson', 'Эхний хичээл', 'Анхны хичээлээ амжилттай дуусгав.', 'lessons_completed', 1, 0),
('lessons_5', 'Тууштай суралцагч', 'Таван хичээл амжилттай дуусгав.', 'lessons_completed', 5, 0),
('perfect_practice', 'Нарийвчлал', 'Нэг хичээлийг 100 хувийн нарийвчлалтай дуусгав.', 'perfect_lessons', 1, 0),
('streak_3', 'Гурван өдрийн хэмнэл', 'Гурван өдөр дараалан суралцав.', 'streak_days', 3, 0),
('streak_7', 'Долоо хоногийн тууштай байдал', 'Долоон өдөр дараалан суралцав.', 'streak_days', 7, 0),
('course_complete', 'Хөтөлбөр дуусгагч', 'Нэг нийтлэгдсэн хөтөлбөрийн бүх хичээлийг амжилттай дуусгав.', 'course_complete', 1, 0)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "xp_transactions" ("user_id", "source_key", "source_type", "amount", "lesson_id", "created_at", "metadata")
SELECT lp."user_id", 'legacy_lesson_progress:' || lp."lesson_id"::text, 'legacy_lesson_progress', lp."xp_earned", lp."lesson_id", lp."completed_at", jsonb_build_object('backfilled', true)
FROM "lesson_progress" lp WHERE lp."xp_earned" > 0
ON CONFLICT ("user_id", "source_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "learning_activity_days" ("user_id", "activity_date", "activity_count", "xp_earned")
SELECT lp."user_id", (lp."completed_at" AT TIME ZONE u."timezone")::date, count(*)::int, sum(lp."xp_earned")::int
FROM "lesson_progress" lp JOIN "users" u ON u."id" = lp."user_id"
GROUP BY lp."user_id", (lp."completed_at" AT TIME ZONE u."timezone")::date
ON CONFLICT ("user_id", "activity_date") DO NOTHING;
