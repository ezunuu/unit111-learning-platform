-- Keep existing course and lesson relationships while naming the two learner audiences.
-- The third seeded category is retained for historical integrity, but hidden from learners.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM courses
    WHERE subject_id = '11100000-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'Cannot deactivate legacy subject: courses are still assigned to it';
  END IF;
END $$;
--> statement-breakpoint
UPDATE learning_subjects
SET title = 'Инженер', icon = 'layers', sort_order = 1, is_active = true
WHERE id = '11100000-0000-4000-8000-000000000001';
--> statement-breakpoint
UPDATE learning_subjects
SET title = 'Нисгэгч', icon = 'plane', sort_order = 0, is_active = true
WHERE id = '11100000-0000-4000-8000-000000000002';
--> statement-breakpoint
UPDATE learning_subjects
SET is_active = false
WHERE id = '11100000-0000-4000-8000-000000000003';
