import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type Request } from 'express';
import { once } from 'node:events';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from './db.js';
import * as s from './schema.js';
import { learningRouter } from './learning.js';
import { courseManagementRouter } from './course-management.js';

test('approved theory gates practice, persists sequential progress, and preserves existing practice XP policy', { skip: process.env.UNIT111_TEST_DATABASE_INTEGRATION !== '1' }, async (t) => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname));
  assert.match(url.pathname.slice(1), /^unit111_it_[0-9]{14}_[a-f0-9]{8}$/);
  const databaseResult = await pool.query('select current_database() as name');
  assert.equal(databaseResult.rows[0]?.name, url.pathname.slice(1));
  const [admin] = await db.insert(s.users).values({ username: `theory_it_${crypto.randomUUID()}`, fullName: 'Theory Integration', passwordHash: 'test-only-hash', role: 'admin', mustChangePassword: false }).returning({ id: s.users.id, role: s.users.role });
  const [category] = await db.select({ id: s.categories.id }).from(s.categories).limit(1);
  assert.ok(admin && category, 'isolated integration seed must provide admin and category');

  const suffix = crypto.randomUUID();
  const [course] = await db.insert(s.courses).values({ title: `Theory IT ${suffix}`, description: '', status: 'published', courseOrder: 9000, createdBy: admin.id, defaultLessonPassPercentage: 50 }).returning();
  const [chapter] = await db.insert(s.chapters).values({ courseId: course.id, title: 'Theory integration', status: 'published', chapterOrder: 9000 }).returning();
  const [lesson] = await db.insert(s.lessons).values({ title: `Theory lesson ${suffix}`, categoryId: category.id, chapterId: chapter.id, description: '', content: '', status: 'published', theoryRequired: true, lessonOrder: 9000, passPercentage: 50, createdBy: admin.id }).returning();
  const questionIds: string[] = [];
  const correctOptionIds: string[] = [];
  for (let n = 0; n < 2; n++) {
    const [question] = await db.insert(s.questions).values({ categoryId: category.id, questionText: `Theory integration Q${n} ${suffix}`, questionType: 'single_choice', difficulty: 'easy', explanation: `Explanation ${n}`, status: 'published', createdBy: admin.id }).returning();
    questionIds.push(question.id);
    const options = await db.insert(s.questionOptions).values(['Correct', 'Wrong A', 'Wrong B', 'Wrong C'].map((optionText, optionOrder) => ({ questionId: question.id, optionText: `${optionText} ${suffix}`, optionOrder }))).returning();
    correctOptionIds.push(options[0].id);
    await db.insert(s.questionCorrectOptions).values({ questionId: question.id, optionId: options[0].id });
    await db.insert(s.lessonQuestions).values({ lessonId: lesson.id, questionId: question.id, questionOrder: n });
  }

  const app = express(); app.use(express.json());
  app.use((req: Request, _res, next) => { const role = req.header('x-test-role') === 'employee' || req.header('x-test-role') === 'training_manager' ? req.header('x-test-role') as 'employee'|'training_manager' : 'admin'; req.user = { id: admin.id, username: 'theory-integration', fullName: 'Theory Integration', role, mustChangePassword: false }; next(); });
  app.use('/learning', learningRouter); app.use('/', courseManagementRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await pool.end(); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (path: string, method = 'GET', body?: unknown, role?: string) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(role ? { 'x-test-role': role } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { response, data: await response.json() as any };
  };

  const startBlocked = await call(`/learning/lessons/${lesson.id}/start`, 'POST', {});
  assert.equal(startBlocked.response.status, 409); assert.equal(startBlocked.data.error.code, 'THEORY_NOT_READY');
  const blocks = [
    { blockType: 'key_concept', content: { title: 'Concept 1', text: 'Reviewer supplied theory text one.' }, sourceDocument: 'Integration source', sourcePage: '1' },
    { blockType: 'image', content: { url: 'https://example.invalid/diagram.png', caption: 'Diagram caption' }, sourceDocument: 'Integration source', sourcePage: '2' },
    { blockType: 'summary', content: { items: ['Summary one'] } },
  ];
  const blockIds: string[] = [];
  for (const block of blocks) { const created = await call(`/admin/lessons/${lesson.id}/content-blocks`, 'POST', block); assert.equal(created.response.status, 201); blockIds.push(created.data.block.id); }
  const forbiddenEdit = await call(`/admin/content-blocks/${blockIds[0]}`, 'PUT', blocks[0], 'employee'); assert.equal(forbiddenEdit.response.status, 403);
  const reordered = await call(`/admin/lessons/${lesson.id}/content-blocks/reorder`, 'POST', { ids: [blockIds[2], blockIds[1], blockIds[0]] }); assert.equal(reordered.response.status, 200);
  const reorderedList = await call(`/admin/lessons/${lesson.id}/content-blocks`); assert.deepEqual(reorderedList.data.items.map((block: any) => block.id), [blockIds[2], blockIds[1], blockIds[0]]); assert.ok(reorderedList.data.items.every((block: any) => block.reviewStatus === 'draft'));
  const edited = await call(`/admin/content-blocks/${blockIds[0]}`, 'PUT', { ...blocks[0], content: { title: 'Edited concept', text: 'Edited reviewer supplied theory text.' } }); assert.equal(edited.response.status, 200);
  const draftLeak = await call(`/learning/lessons/${lesson.id}/theory`); assert.deepEqual(draftLeak.data.blocks, []);
  const submitted = await call(`/admin/lessons/${lesson.id}/content-blocks/submit-review`, 'POST', {}); assert.equal(submitted.response.status, 200);
  const managerApproval = await call(`/admin/content-blocks/${blockIds[0]}/review`, 'POST', { decision: 'approved' }, 'training_manager'); assert.equal(managerApproval.response.status, 403);
  for (const id of blockIds) { const reviewed = await call(`/admin/content-blocks/${id}/review`, 'POST', { decision: 'approved' }); assert.equal(reviewed.response.status, 200); }
  const path = await call('/learning/path');
  const pathLesson = path.data.items.find((item: any) => item.id === lesson.id); assert.equal(pathLesson.theoryReady, true); assert.equal(pathLesson.theoryRequired, true); assert.equal(pathLesson.theoryCompleted, false);
  const theory = await call(`/learning/lessons/${lesson.id}/theory`); assert.equal(theory.response.status, 200); assert.equal(theory.data.blocks.length, 3); assert.equal(JSON.stringify(theory.data).includes('correctOptionIds'), false);
  const startAgain = await call(`/learning/lessons/${lesson.id}/start`, 'POST', {}); assert.equal(startAgain.data.error.code, 'THEORY_REQUIRED');
  const skip = await call(`/learning/lessons/${lesson.id}/theory/progress`, 'POST', { blockOrder: 2, contentVersion: theory.data.contentVersion, direction: 'continue', completed: true }); assert.equal(skip.data.error.code, 'THEORY_SEQUENCE');
  const parallelSteps = await Promise.all([0, 1].map(() => call(`/learning/lessons/${lesson.id}/theory/progress`, 'POST', { blockOrder: 0, contentVersion: theory.data.contentVersion, direction: 'continue' })));
  assert.deepEqual(parallelSteps.map(item => item.response.status).sort(), [200, 409]);
  assert.equal(parallelSteps.find(item => item.response.status === 200)!.data.currentBlockOrder, 1);
  const resumeAtSecond = await call(`/learning/lessons/${lesson.id}/theory`); assert.equal(resumeAtSecond.data.progress.currentBlockOrder, 1);
  const previous = await call(`/learning/lessons/${lesson.id}/theory/progress`, 'POST', { blockOrder: 0, contentVersion: theory.data.contentVersion, direction: 'previous' }); assert.equal(previous.response.status, 200); assert.equal(previous.data.maxViewedOrder, 0); assert.equal(previous.data.currentBlockOrder, 0);
  const resumeAtFirst = await call(`/learning/lessons/${lesson.id}/theory`); assert.equal(resumeAtFirst.data.progress.currentBlockOrder, 0);
  for (let blockOrder = 0; blockOrder < 3; blockOrder++) {
    const step = await call(`/learning/lessons/${lesson.id}/theory/progress`, 'POST', { blockOrder, contentVersion: theory.data.contentVersion, direction: 'continue', completed: blockOrder === 2 });
    assert.equal(step.response.status, 200); assert.equal(step.data.xpEarned, 0);
    if (blockOrder < 2) assert.equal(step.data.currentBlockOrder, blockOrder + 1);
  }
  const starts = await Promise.all([0, 1].map(() => call(`/learning/lessons/${lesson.id}/start`, 'POST', {})));
  assert.deepEqual(starts.map(item => item.response.status).sort(), [200, 201]);
  assert.equal(starts[0].data.attempt.id, starts[1].data.attempt.id, 'two tabs must share the same active lesson attempt');
  const started = starts.find(item => item.response.status === 201)!; assert.equal(started.data.questions.length, 2);
  const wrong = await call(`/learning/attempts/${started.data.attempt.id}/answer`, 'POST', { questionId: questionIds[0], optionIds: [started.data.questions[0].options[1].id] });
  assert.equal(wrong.data.correct, false); assert.equal(wrong.data.explanation, 'Explanation 0');
  const rightAnswers = await Promise.all([0, 1].map(() => call(`/learning/attempts/${started.data.attempt.id}/answer`, 'POST', { questionId: questionIds[1], optionIds: [correctOptionIds[1]] })));
  assert.ok(rightAnswers.every(item => item.response.status === 200 && item.data.correct === true));
  const afterDuplicates = await call(`/learning/attempts/${started.data.attempt.id}`);
  assert.equal(afterDuplicates.data.answers.length, 2); assert.equal(afterDuplicates.data.attempt.correctCount, 1);
  const completions = await Promise.all([0, 1].map(() => call(`/learning/attempts/${started.data.attempt.id}/complete`, 'POST', {})));
  assert.deepEqual(completions.map(item => item.response.status).sort(), [200, 409]);
  const completion = completions.find(item => item.response.status === 200)!; assert.equal(completion.data.passed, true);
  const [xpAfter] = await db.select({ total: sql<number>`coalesce(sum(${s.xpTransactions.amount}),0)::int` }).from(s.xpTransactions).where(eq(s.xpTransactions.userId, admin.id));
  assert.ok(xpAfter.total > 0);
  const duplicateComplete = await call(`/learning/attempts/${started.data.attempt.id}/complete`, 'POST', {}); assert.equal(duplicateComplete.data.error.code, 'ATTEMPT_CLOSED');
  const [xpStill] = await db.select({ total: sql<number>`coalesce(sum(${s.xpTransactions.amount}),0)::int` }).from(s.xpTransactions).where(eq(s.xpTransactions.userId, admin.id)); assert.equal(xpStill.total, xpAfter.total);
  const queue = await call('/learning/review-queue'); assert.ok(queue.data.items.some((item: any) => item.questionId === questionIds[0]));
  const retry = await call('/learning/review-queue/start', 'POST', { questionIds: [questionIds[0]] }); assert.equal(retry.response.status, 201);
  const reviewAttemptId = retry.data.attempt.id;
  const newLesson = await call(`/learning/lessons/${lesson.id}/start`, 'POST', {});
  assert.equal(newLesson.response.status, 201); assert.equal(newLesson.data.attempt.mode, 'lesson');
  assert.notEqual(newLesson.data.attempt.id, reviewAttemptId, 'an unfinished review must never be resumed as a lesson');
  assert.equal(newLesson.data.questions.length, 2);
  const reviewPack = await call(`/learning/attempts/${reviewAttemptId}`); assert.equal(reviewPack.data.questions.length, 1);
  const retryAnswer = await call(`/learning/attempts/${reviewAttemptId}/answer`, 'POST', { questionId: questionIds[0], optionIds: [correctOptionIds[0]] }); assert.equal(retryAnswer.data.correct, true); assert.equal(retryAnswer.data.xpPotential, 0);
});
