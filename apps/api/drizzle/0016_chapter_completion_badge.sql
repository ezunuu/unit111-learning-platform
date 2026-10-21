INSERT INTO "achievements" ("code", "title", "description", "rule_type", "threshold", "xp_reward")
VALUES ('chapter_complete', 'Бүлэг дуусгагч', 'Нэг бүлгийн бүх нийтлэгдсэн сургалтын шаардлагыг амжилттай дуусгав.', 'chapter_complete', 1, 0)
ON CONFLICT ("code") DO NOTHING;
