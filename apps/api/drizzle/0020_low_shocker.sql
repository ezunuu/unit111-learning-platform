CREATE TABLE "learning_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"icon" varchar(20) DEFAULT 'book' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "learning_subjects" ("id","title","icon","sort_order") VALUES
('11100000-0000-4000-8000-000000000001','Нисэхийн мэдлэг','plane',0),
('11100000-0000-4000-8000-000000000002','Улсын нисэхийн дүрэм','book',1),
('11100000-0000-4000-8000-000000000003','Цэргийн дүрэм','shield',2);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "subject_id" uuid DEFAULT '11100000-0000-4000-8000-000000000001' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_subjects_title_idx" ON "learning_subjects" USING btree (lower(trim("title")));--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_subject_id_learning_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."learning_subjects"("id") ON DELETE no action ON UPDATE no action;