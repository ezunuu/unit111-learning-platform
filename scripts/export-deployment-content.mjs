import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/api/package.json'));
const dotenv = require('dotenv');
const pg = require('pg');
dotenv.config({ path: resolve(root, '.env') });
const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL тохируулаагүй байна.');
const target = new URL(connectionString);
const database = target.pathname.replace(/^\//, '');
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname) || database !== 'unit111_admin_test') {
  throw new Error('Экспорт зөвхөн локал unit111_admin_test сангаас ажиллана.');
}

const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
const tables = {
  learningSubjects: `select id,parent_id,title,icon,sort_order,is_active,created_at from learning_subjects order by parent_id nulls first,sort_order,title`,
  categories: `select id,name,description,sort_order,is_active from categories order by sort_order,name`,
  courses: `select id,subject_id,title,description,status,course_order,free_learning_mode,default_lesson_pass_percentage,chapter_quiz_pass_percentage,lesson_completion_xp,lesson_pass_xp,perfect_practice_xp,chapter_quiz_xp,created_at,updated_at from courses order by course_order,title`,
  chapters: `select id,course_id,title,description,status,chapter_order,required_lessons_completed,created_at,updated_at from chapters order by course_id,chapter_order`,
  questions: `select id,category_id,question_text,question_type,difficulty,explanation,xp,source_reference,status,approved_at,source_document,source_revision,source_section,source_location,last_reviewed_at,created_at,updated_at,archived_at,duplicate_of from questions order by created_at,id`,
  questionOptions: `select id,question_id,option_text,option_order from question_options order by question_id,option_order`,
  questionCorrectOptions: `select question_id,option_id from question_correct_options order by question_id,option_id`,
  lessons: `select id,title,category_id,chapter_id,description,content,status,theory_required,lesson_order,pass_percentage,completion_xp,pass_xp,perfect_xp,estimated_minutes,learning_objectives,created_at,updated_at from lessons order by chapter_id nulls first,lesson_order,title`,
  lessonQuestions: `select lesson_id,question_id,question_order from lesson_questions order by lesson_id,question_order`,
  lessonContentBlocks: `select id,lesson_id,block_order,block_type,content,source_document,source_revision,source_page,review_status,reviewed_at,created_at,updated_at from lesson_content_blocks order by lesson_id,block_order`,
  quizzes: `select id,title,description,quiz_type,lesson_id,chapter_id,is_test,category_id,question_count,time_limit_seconds,passing_percentage,attempts_allowed,scoring_config,show_explanations,immediate_feedback,status,created_at,updated_at from quizzes order by title`,
  quizQuestions: `select id,quiz_id,question_id,question_order,points from quiz_questions order by quiz_id,question_order`,
};

await client.connect();
try {
  await client.query('begin read only');
  const content = { formatVersion: 1, exportedAt: new Date().toISOString(), sourceDatabase: 'unit111_admin_test', tables: {} };
  for (const [name, query] of Object.entries(tables)) {
    const result = await client.query(query);
    content.tables[name] = result.rows;
  }
  await client.query('commit');
  const outDir = resolve(root, 'apps/api/data');
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, 'deployment-content.json');
  await writeFile(outFile, `${JSON.stringify(content)}\n`, 'utf8');
  for (const [name, rows] of Object.entries(content.tables)) console.log(`${name}: ${rows.length}`);
  console.log(`Агуулгын snapshot бэлэн: ${outFile}`);
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  await client.end();
}
