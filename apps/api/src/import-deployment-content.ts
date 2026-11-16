import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { pool } from './db.js';

type Row = Record<string, unknown>;
type Snapshot = { formatVersion: number; tables: Record<string, Row[]> };
const file = resolve(dirname(fileURLToPath(import.meta.url)), '../data/deployment-content.json');
const snapshot = JSON.parse(await readFile(file, 'utf8')) as Snapshot;
if (snapshot.formatVersion !== 1) throw new Error('Агуулгын багцын хувилбар тохирохгүй байна.');
if (process.env.UNIT111_CONTENT_IMPORT_CONFIRM !== 'I_VERIFIED_TARGET_DATABASE') {
  throw new Error('Зорилтот database-аа шалгаад UNIT111_CONTENT_IMPORT_CONFIRM=I_VERIFIED_TARGET_DATABASE гэж тохируулна уу.');
}

const allowedColumns: Record<string, Set<string>> = {
  categories: new Set(['id','name','description','sort_order','is_active']),
  learning_subjects: new Set(['id','parent_id','title','icon','sort_order','is_active','created_at']),
  courses: new Set(['id','subject_id','title','description','status','course_order','free_learning_mode','default_lesson_pass_percentage','chapter_quiz_pass_percentage','lesson_completion_xp','lesson_pass_xp','perfect_practice_xp','chapter_quiz_xp','created_at','updated_at','created_by']),
  chapters: new Set(['id','course_id','title','description','status','chapter_order','required_lessons_completed','created_at','updated_at']),
  questions: new Set(['id','category_id','question_text','question_type','difficulty','explanation','xp','source_reference','status','approved_at','source_document','source_revision','source_section','source_location','last_reviewed_at','created_at','updated_at','archived_at','duplicate_of','created_by','reviewed_by']),
  question_options: new Set(['id','question_id','option_text','option_order']),
  question_correct_options: new Set(['question_id','option_id']),
  lessons: new Set(['id','title','category_id','chapter_id','description','content','status','theory_required','lesson_order','pass_percentage','completion_xp','pass_xp','perfect_xp','estimated_minutes','learning_objectives','created_at','updated_at','created_by']),
  lesson_questions: new Set(['lesson_id','question_id','question_order']),
  lesson_content_blocks: new Set(['id','lesson_id','block_order','block_type','content','source_document','source_revision','source_page','review_status','reviewed_at','created_at','updated_at','created_by','reviewed_by']),
  quizzes: new Set(['id','title','description','quiz_type','lesson_id','chapter_id','is_test','category_id','question_count','time_limit_seconds','passing_percentage','attempts_allowed','scoring_config','show_explanations','immediate_feedback','status','created_at','updated_at','created_by']),
  quiz_questions: new Set(['id','quiz_id','question_id','question_order','points']),
};
const jsonColumns = new Set(['learning_objectives','content','scoring_config']);

async function insertRows(client: PoolClient, table: string, rows: Row[]) {
  const allowed = allowedColumns[table];
  if (!allowed) throw new Error(`Импортын хүснэгт зөвшөөрөгдөөгүй: ${table}`);
  for (const row of rows) {
    const columns = Object.keys(row);
    if (columns.some((column) => !allowed.has(column))) throw new Error(`Импортын багана зөвшөөрөгдөөгүй: ${table}`);
    const values = columns.map((column) => jsonColumns.has(column) && row[column] != null ? JSON.stringify(row[column]) : row[column]);
    const quotedColumns = columns.map((column) => `"${column}"`).join(',');
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
    await client.query(`insert into "${table}" (${quotedColumns}) values (${placeholders})`, values);
  }
}

const client = await pool.connect();
try {
  const dbResult = await client.query('select current_database() as database, inet_server_addr()::text as host');
  console.log(`Зорилтот database: ${dbResult.rows[0].host ?? 'managed PostgreSQL'}/${dbResult.rows[0].database}`);
  await client.query('begin');
  await client.query(`select pg_advisory_xact_lock(hashtext('unit111.deployment-content-import'))`);
  const adminResult = await client.query(`select id from users where role='admin' and is_active=true limit 1`);
  if (!adminResult.rowCount) throw new Error('Идэвхтэй админ олдсонгүй. Эхлээд bootstrap:admin ажиллуулна уу.');
  const adminId = adminResult.rows[0].id as string;
  const countResult = await client.query(`select
    (select count(*)::int from courses) courses,
    (select count(*)::int from chapters) chapters,
    (select count(*)::int from lessons) lessons,
    (select count(*)::int from questions) questions,
    (select count(*)::int from quizzes) quizzes,
    (select count(*)::int from lesson_progress) progress,
    (select count(*)::int from quiz_attempts) attempts`);
  if (Object.values(countResult.rows[0] as Record<string, number>).some((count) => count !== 0)) {
    throw new Error('Зорилтот database-д өмнө нь контент эсвэл хэрэглэгчийн түүх байна. Нэг ч мөр өөрчлөхгүйгээр зогслоо.');
  }

  const categoryIds = new Map<string,string>();
  for (const row of snapshot.tables.categories ?? []) {
    const existing = await client.query(`select id from categories where lower(trim(name))=lower(trim($1))`, [row.name]);
    if (existing.rowCount) categoryIds.set(String(row.id), String(existing.rows[0].id));
    else {
      await insertRows(client, 'categories', [row]);
      categoryIds.set(String(row.id), String(row.id));
    }
  }
  const subjectIds = new Map<string,string>();
  const subjects = snapshot.tables.learningSubjects ?? [];
  for (const row of subjects.filter((item) => item.parent_id == null)) {
    const byId = await client.query(`select id,title from learning_subjects where id=$1`, [row.id]);
    if (byId.rowCount && byId.rows[0].title !== row.title) throw new Error(`Сургалтын сэдвийн ID зөрчилтэй: ${String(row.title)}`);
    const found = byId.rowCount ? byId : await client.query(`select id,title from learning_subjects where lower(trim(title))=lower(trim($1))`, [row.title]);
    if (found.rowCount) subjectIds.set(String(row.id), String(found.rows[0].id));
    else {
      await insertRows(client, 'learning_subjects', [row]);
      subjectIds.set(String(row.id), String(row.id));
    }
  }
  for (const row of subjects.filter((item) => item.parent_id != null)) {
    const parentId = subjectIds.get(String(row.parent_id));
    if (!parentId) throw new Error(`Сургалтын чиглэлийн эцэг холбоос олдсонгүй: ${String(row.title)}`);
    const found = await client.query(`select id,parent_id from learning_subjects where lower(trim(title))=lower(trim($1))`, [row.title]);
    if (found.rowCount) {
      if (String(found.rows[0].parent_id) !== parentId) throw new Error(`Сургалтын чиглэлийн бүтэц зөрүүтэй: ${String(row.title)}`);
      subjectIds.set(String(row.id), String(found.rows[0].id));
    } else {
      await insertRows(client, 'learning_subjects', [{ ...row, parent_id: parentId }]);
      subjectIds.set(String(row.id), String(row.id));
    }
  }

  const order: Array<[string,string]> = [
    ['courses','courses'],['chapters','chapters'],['questions','questions'],['questionOptions','question_options'],
    ['questionCorrectOptions','question_correct_options'],['lessons','lessons'],['lessonQuestions','lesson_questions'],
    ['lessonContentBlocks','lesson_content_blocks'],['quizzes','quizzes'],['quizQuestions','quiz_questions'],
  ];
  const counts: Record<string,number> = {};
  for (const [key, table] of order) {
    const rows = (snapshot.tables[key] ?? []).map((source) => {
      const row = { ...source };
      const categoryId = row.category_id;
      if (typeof categoryId === 'string' && categoryIds.has(categoryId)) row.category_id = categoryIds.get(categoryId);
      const subjectId = row.subject_id;
      if (typeof subjectId === 'string' && subjectIds.has(subjectId)) row.subject_id = subjectIds.get(subjectId);
      if (['courses','lessons','questions','lessonContentBlocks','quizzes'].includes(key)) row.created_by = adminId;
      if (key === 'questions' || key === 'lessonContentBlocks') row.reviewed_by = null;
      return row;
    });
    await insertRows(client, table, rows);
    counts[key] = rows.length;
  }
  await client.query(`insert into audit_logs (actor_user_id,action,entity_type,metadata) values ($1,'deployment.content_imported','deployment_content',$2::jsonb)`, [adminId, JSON.stringify({ formatVersion: snapshot.formatVersion, counts, reviewIdentityImported: false })]);
  await client.query('commit');
  console.log(`Агуулгын импорт амжилттай. Мөрийн тоо: ${JSON.stringify(counts)}`);
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
