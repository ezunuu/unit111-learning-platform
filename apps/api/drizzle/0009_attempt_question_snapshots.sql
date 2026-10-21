CREATE TABLE "quiz_attempt_questions" (
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_order" integer NOT NULL,
	"points" integer NOT NULL,
	CONSTRAINT "quiz_attempt_questions_pkey" PRIMARY KEY("attempt_id", "question_id")
);
ALTER TABLE "quiz_attempt_questions" ADD CONSTRAINT "quiz_attempt_questions_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quiz_attempt_questions" ADD CONSTRAINT "quiz_attempt_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "quiz_attempt_question_order_idx" ON "quiz_attempt_questions" USING btree ("attempt_id", "question_order");
INSERT INTO "quiz_attempt_questions" ("attempt_id", "question_id", "question_order", "points")
SELECT attempt."id", link."question_id", link."question_order", link."points"
FROM "quiz_attempts" AS attempt
INNER JOIN "quiz_questions" AS link ON link."quiz_id" = attempt."quiz_id"
ON CONFLICT ("attempt_id", "question_id") DO NOTHING;
