import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import { db, pool } from './db.js';
import * as s from './schema.js';
import { learningRouter } from './learning.js';
import { practiceQuizRouter } from './practice-quiz-router.js';
import { createQuizStartRouter } from './quiz-start-router.js';

const enabled = process.env.UNIT111_TEST_DATABASE_INTEGRATION === '1';
type LearningPath = { courses: { chapters: { lessons: { id: string; unlocked: boolean }[] }[] }[] };

test('PostgreSQL lesson practice, retry queue, XP idempotency and official feedback protection', { skip: !enabled }, async () => {
  const [category] = await db.select().from(s.categories).limit(1);
  assert.ok(category, 'migration and seed must provide a category');
  const [user] = await db.insert(s.users).values({ username: `it_${crypto.randomUUID()}`, fullName: 'Integration Learner', passwordHash: 'integration-only-not-a-login-secret', role: 'employee', isActive: true, mustChangePassword: false }).returning({ id: s.users.id });
  const [course] = await db.insert(s.courses).values({ title: 'Integration Course', status: 'published', freeLearningMode: true, createdBy: user.id }).returning({ id: s.courses.id });
  const [chapter] = await db.insert(s.chapters).values({ courseId: course.id, title: 'Integration Chapter', status: 'published', chapterOrder: 1 }).returning({ id: s.chapters.id });
  const [lesson] = await db.insert(s.lessons).values({ title: 'Integration Lesson', categoryId: category.id, chapterId: chapter.id, description: 'test', content: 'test', status: 'published', lessonOrder: 1, createdBy: user.id }).returning({ id: s.lessons.id });

  const questions: { id: string; options: string[]; correct: string; wrong: string }[] = [];
  for (let index = 0; index < 10; index++) {
    const [question] = await db.insert(s.questions).values({ categoryId: category.id, questionText: `Integration question ${index + 1}`, questionType: 'single_choice', difficulty: 'easy', explanation: `Verified explanation ${index + 1}`, xp: 5, status: 'published', createdBy: user.id, sourceDocument: 'Integration fixture', sourceLocation: `page ${index + 1}` }).returning({ id: s.questions.id });
    const optionRows = await db.insert(s.questionOptions).values(['Correct', 'Wrong A', 'Wrong B', 'Wrong C'].map((optionText, optionOrder) => ({ questionId: question.id, optionText, optionOrder }))).returning({ id: s.questionOptions.id });
    await db.insert(s.questionCorrectOptions).values({ questionId: question.id, optionId: optionRows[0].id });
    await db.insert(s.lessonQuestions).values({ lessonId: lesson.id, questionId: question.id, questionOrder: index });
    questions.push({ id: question.id, options: optionRows.map((row) => row.id), correct: optionRows[0].id, wrong: optionRows[1].id });
  }

  const [practiceQuiz] = await db.insert(s.quizzes).values({ title: 'Retry Practice', quizType: 'practice', isTest: true, categoryId: category.id, questionCount: 1, attemptsAllowed: 99, immediateFeedback: true, status: 'published', createdBy: user.id }).returning({ id: s.quizzes.id });
  const [officialQuiz] = await db.insert(s.quizzes).values({ title: 'Official Protection', quizType: 'official', categoryId: category.id, questionCount: 1, attemptsAllowed: 1, immediateFeedback: true, showExplanations: false, status: 'published', createdBy: user.id }).returning({ id: s.quizzes.id });
  for (const [quizId, questionId] of [[practiceQuiz.id, questions[0].id], [officialQuiz.id, questions[1].id]]) await db.insert(s.quizQuestions).values({ quizId, questionId, questionOrder: 0, points: 100 });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: user.id, username: 'integration', fullName: 'Integration Learner', role: 'employee', mustChangePassword: false }; next(); });
  app.use(createQuizStartRouter());
  app.use(practiceQuizRouter);
  app.use('/learning', learningRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<{ response: Response; data: T }> {
    const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, data: await response.json() as T };
  }
  try {
    const path = await request<LearningPath>('/learning/path');
    assert.equal(path.response.status, 200);
    const pathLesson = path.data.courses.flatMap((item) => item.chapters.flatMap((group) => group.lessons)).find((item) => item.id === lesson.id);
    assert.equal(pathLesson?.unlocked, true);

    const started = await request<{ attempt: { id: string }; questions: { id: string }[] }>(`/learning/lessons/${lesson.id}/start`, 'POST', {});
    assert.equal(started.response.status, 201);
    const lessonAttempt = started.data.attempt.id;
    const wrong = await request<{ correct: boolean; explanation: string; xpPotential: number }>(`/learning/attempts/${lessonAttempt}/answer`, 'POST', { questionId: questions[0].id, optionIds: [questions[0].wrong] });
    assert.equal(wrong.data.correct, false);
    assert.equal(wrong.data.explanation, 'Verified explanation 1');
    assert.equal(wrong.data.xpPotential, 0);
    const queueStart = await request<{ attempt: { id: string }; questions: { id: string }[] }>('/learning/review-queue/start', 'POST', { questionIds: [questions[0].id] });
    assert.equal(queueStart.response.status, 201);
    const miniLesson = queueStart.data.questions[0];
    assert.ok(miniLesson.id === questions[0].id);
    const reviewAnswer = await request<{ correct: boolean }>(`/learning/attempts/${queueStart.data.attempt.id}/answer`, 'POST', { questionId: questions[0].id, optionIds: [questions[0].correct] });
    assert.equal(reviewAnswer.data.correct, true);
    const reviewComplete = await request<{ mode: string; xpEarned: number }>(`/learning/attempts/${queueStart.data.attempt.id}/complete`, 'POST', {});
    assert.equal(reviewComplete.data.mode, 'review');
    assert.equal(reviewComplete.data.xpEarned, 0);
    const lessonQueue = await request<{ items: { questionId: string }[] }>('/learning/review-queue');
    assert.equal(lessonQueue.data.items.some((item) => item.questionId === questions[0].id), false);

    const progressBefore = await request<{ xp: number }>('/learning/summary');
    assert.equal(progressBefore.data.xp, 0);
    const lessonPack = started.data;
    for (const question of questions.slice(1)) {
      const answer = await request<{ correct: boolean }>(`/learning/attempts/${lessonAttempt}/answer`, 'POST', { questionId: question.id, optionIds: [question.correct] });
      assert.equal(answer.data.correct, true);
    }
    const complete = await request<{ passed: boolean; xpEarned: number }>(`/learning/attempts/${lessonAttempt}/complete`, 'POST', {});
    assert.equal(complete.data.passed, true);
    assert.ok(complete.data.xpEarned > 0);
    const xpAfterPass = await request<{ xp: number }>('/learning/summary');
    assert.ok(xpAfterPass.data.xp > 0);
    const secondStart = await request<{ attempt: { id: string } }>(`/learning/lessons/${lesson.id}/start`, 'POST', {});
    for (const question of questions) await request(`/learning/attempts/${secondStart.data.attempt.id}/answer`, 'POST', { questionId: question.id, optionIds: [question.correct] });
    await request(`/learning/attempts/${secondStart.data.attempt.id}/complete`, 'POST', {});
    const xpAfterRepeat = await request<{ xp: number }>('/learning/summary');
    assert.equal(xpAfterRepeat.data.xp, xpAfterPass.data.xp, 'lesson XP is idempotent');

    const practiceStart = await request<{ attempt: { id: string }; questions: { id: string }[]; quiz: { immediateFeedback: boolean } }>(`/quizzes/${practiceQuiz.id}/start`, 'POST', {});
    assert.equal(practiceStart.response.status, 201);
    assert.equal(practiceStart.data.quiz.immediateFeedback, true);
    const practiceAttemptId = practiceStart.data.attempt.id;
    const practiceWrong = await request<Record<string, unknown>>(`/attempts/${practiceAttemptId}/answers`, 'PUT', { questionId: questions[0].id, optionIds: [questions[0].wrong] });
    assert.equal(practiceWrong.response.status, 200);
    assert.equal(practiceWrong.data.correct, false);
    assert.equal(practiceWrong.data.explanation, 'Verified explanation 1');
    assert.deepEqual(practiceWrong.data.source, { document: 'Integration fixture', revision: null, location: 'page 1' });
    const originalAnswer = await db.select().from(s.answers).where(and(eq(s.answers.attemptId, practiceAttemptId), eq(s.answers.questionId, questions[0].id))).limit(1);
    const originalOptions = await db.select().from(s.answerOptions).where(eq(s.answerOptions.answerId, originalAnswer[0].id));
    const originalAttempt = await db.select().from(s.quizAttempts).where(eq(s.quizAttempts.id, practiceAttemptId)).limit(1);
    const originalSnapshot = await db.select().from(s.quizAttemptQuestions).where(eq(s.quizAttemptQuestions.attemptId, practiceAttemptId));
    const practiceQueueBefore = await request<{ items: { id: string; kind: string; questionId: string; options: { id: string; text: string }[] }[] }>('/learning/review-queue');
    const queuedPractice = practiceQueueBefore.data.items.find((item) => item.kind === 'practice' && item.questionId === questions[0].id);
    assert.ok(queuedPractice);
    assert.equal(queuedPractice.options.length, 4);
    const statsBeforeRetry = await request<{ needsReview: number; wrongAnswers: number }>('/learning/summary');
    assert.ok(statsBeforeRetry.data.needsReview >= 1);
    assert.ok(statsBeforeRetry.data.wrongAnswers >= 1);
    const xpBeforeRetry = xpAfterRepeat.data.xp;
    const retry = await request<{ correct: boolean; awardedXp: number }>(`/attempts/${practiceAttemptId}/questions/${questions[0].id}/retry`, 'POST', { optionIds: [questions[0].correct] });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.data.correct, true);
    assert.equal(retry.data.awardedXp, 0);
    const answerAfterRetry = await db.select().from(s.answers).where(eq(s.answers.id, originalAnswer[0].id)).limit(1);
    const optionsAfterRetry = await db.select().from(s.answerOptions).where(eq(s.answerOptions.answerId, originalAnswer[0].id));
    const attemptAfterRetry = await db.select().from(s.quizAttempts).where(eq(s.quizAttempts.id, practiceAttemptId)).limit(1);
    const snapshotAfterRetry = await db.select().from(s.quizAttemptQuestions).where(eq(s.quizAttemptQuestions.attemptId, practiceAttemptId));
    assert.deepEqual(answerAfterRetry[0], originalAnswer[0]);
    assert.deepEqual(optionsAfterRetry.map((row) => row.optionId), originalOptions.map((row) => row.optionId));
    assert.deepEqual(attemptAfterRetry[0], originalAttempt[0]);
    assert.deepEqual(snapshotAfterRetry, originalSnapshot);
    assert.equal((await db.select().from(s.practiceQuestionReviewAnswers).where(eq(s.practiceQuestionReviewAnswers.queueId, queuedPractice.id))).length, 1);
    assert.equal((await request<{ xp: number }>('/learning/summary')).data.xp, xpBeforeRetry);
    const statsAfterRetry = await request<{ reviewedAnswers: number; correctAfterReview: number }>('/learning/summary');
    assert.ok(statsAfterRetry.data.reviewedAnswers >= 1);
    assert.ok(statsAfterRetry.data.correctAfterReview >= 1);
    const combinedQueue = await request<{ items: { kind: string; questionId: string }[] }>('/learning/review-queue');
    assert.ok(combinedQueue.data.items.some((item) => item.kind === 'practice' && item.questionId === questions[0].id) === false, 'mastered practice retry leaves the open queue');

    const officialStart = await request<{ attempt: { id: string }; quiz: { immediateFeedback: boolean } }>(`/quizzes/${officialQuiz.id}/start`, 'POST', {});
    assert.equal(officialStart.response.status, 201);
    assert.equal(officialStart.data.quiz.immediateFeedback, false);
    const officialAnswer = await request<Record<string, unknown>>(`/attempts/${officialStart.data.attempt.id}/answers`, 'PUT', { questionId: questions[1].id, optionIds: [questions[1].wrong] });
    assert.deepEqual(officialAnswer.data, { saved: true });
    assert.equal('correct' in officialAnswer.data, false);
    assert.equal('explanation' in officialAnswer.data, false);
    const forbiddenRetry = await request<{ error: { code: string } }>(`/attempts/${officialStart.data.attempt.id}/questions/${questions[1].id}/retry`, 'POST', { optionIds: [questions[1].correct] });
    assert.equal(forbiddenRetry.response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});
