ALTER TYPE "public"."question_status" ADD VALUE 'rejected' BEFORE 'archived';--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "duplicate_of" uuid;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "passing_percentage" integer DEFAULT 70 NOT NULL;