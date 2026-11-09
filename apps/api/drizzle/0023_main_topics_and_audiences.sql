ALTER TABLE learning_subjects
  ADD COLUMN parent_id uuid;
--> statement-breakpoint
ALTER TABLE learning_subjects
  ADD CONSTRAINT learning_subjects_parent_id_fk
  FOREIGN KEY (parent_id) REFERENCES learning_subjects(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX learning_subjects_parent_idx ON learning_subjects(parent_id);
--> statement-breakpoint
UPDATE learning_subjects SET title='Цэргийн дүрэм',icon='shield',sort_order=0,is_active=true,parent_id=NULL
WHERE id='11100000-0000-4000-8000-000000000003';
--> statement-breakpoint
UPDATE learning_subjects SET title='Улсийн нисэхийн хууль',icon='book',sort_order=1,is_active=true,parent_id=NULL
WHERE id='11100000-0000-4000-8000-000000000002';
--> statement-breakpoint
UPDATE learning_subjects SET title='Нисэхийн мэдлэг',icon='plane',sort_order=2,is_active=true,parent_id=NULL
WHERE id='11100000-0000-4000-8000-000000000001';
--> statement-breakpoint
INSERT INTO learning_subjects(id,parent_id,title,icon,sort_order,is_active)
VALUES
('11100000-0000-4000-8000-000000000004','11100000-0000-4000-8000-000000000001','Нисгэгч','plane',0,true),
('11100000-0000-4000-8000-000000000005','11100000-0000-4000-8000-000000000001','Инженер','layers',1,true);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM courses
    WHERE id='23f00a20-d045-4cc4-b2ae-ea89f3ccfa2c' AND title <> 'BK117 C-2'
  ) THEN
    RAISE EXCEPTION 'The expected BK117 C-2 course ID is assigned to a different course';
  END IF;
END $$;
--> statement-breakpoint
UPDATE courses
SET subject_id='11100000-0000-4000-8000-000000000005',updated_at=now()
WHERE id='23f00a20-d045-4cc4-b2ae-ea89f3ccfa2c' AND subject_id='11100000-0000-4000-8000-000000000001';
