import { Router, type Response } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db.js';
import * as s from './schema.js';
import { requireAuth } from './auth.js';
import { answersMatch } from './scoring.js';
import { buildPracticeFeedback, mayReturnImmediateFeedback } from './quiz-practice-feedback.js';

const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
const answerSchema = z.object({ questionId: z.string().uuid(), optionIds: z.array(z.string().uuid()).min(1).max(8) });
const retrySchema = z.object({ optionIds: z.array(z.string().uuid()).min(1).max(8) });

export const practiceQuizRouter = Router();

practiceQuizRouter.put('/attempts/:id/answers', requireAuth, async (req, res, next) => {
  try {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success || new Set(parsed.data.optionIds).size !== parsed.data.optionIds.length) return fail(res, 400, 'VALIDATION', 'Хариултыг шалгана уу.');
    const result = await db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(s.quizAttempts).where(and(eq(s.quizAttempts.id, String(req.params.id)), eq(s.quizAttempts.userId, req.user!.id))).for('update').limit(1);
      if (!attempt) return { kind: 'not_found' as const };
      if (attempt.status !== 'in_progress') return { kind: 'closed' as const };
      const [link] = await tx.select().from(s.quizAttemptQuestions).where(and(eq(s.quizAttemptQuestions.attemptId, attempt.id), eq(s.quizAttemptQuestions.questionId, parsed.data.questionId))).limit(1);
      if (!link) return { kind: 'not_in_quiz' as const };
      const [quiz] = await tx.select().from(s.quizzes).where(eq(s.quizzes.id, attempt.quizId)).limit(1);
      const immediate = !!quiz && mayReturnImmediateFeedback(quiz);
      const options = await tx.select({ id: s.questionOptions.id, text: s.questionOptions.optionText }).from(s.questionOptions).where(eq(s.questionOptions.questionId, parsed.data.questionId));
      if (parsed.data.optionIds.some((id) => !options.some((option) => option.id === id))) return { kind: 'invalid_options' as const };
      const [question] = await tx.select({ explanation: s.questions.explanation, sourceDocument: s.questions.sourceDocument, sourceRevision: s.questions.sourceRevision, sourceLocation: s.questions.sourceLocation }).from(s.questions).where(eq(s.questions.id, parsed.data.questionId)).limit(1);
      const [prior] = await tx.select().from(s.answers).where(and(eq(s.answers.attemptId, attempt.id), eq(s.answers.questionId, parsed.data.questionId))).limit(1);
      let selectedIds = parsed.data.optionIds;
      if (prior && immediate) {
        selectedIds = (await tx.select({ optionId: s.answerOptions.optionId }).from(s.answerOptions).where(eq(s.answerOptions.answerId, prior.id))).map((row) => row.optionId);
      } else {
        const [answer] = await tx.insert(s.answers).values({ attemptId: attempt.id, questionId: parsed.data.questionId, answeredAt: new Date() })
          .onConflictDoUpdate({ target: [s.answers.attemptId, s.answers.questionId], set: { answeredAt: new Date() } }).returning();
        await tx.delete(s.answerOptions).where(eq(s.answerOptions.answerId, answer.id));
        await tx.insert(s.answerOptions).values(parsed.data.optionIds.map((optionId) => ({ answerId: answer.id, optionId })));
      }
      if (!immediate) return { kind: 'saved' as const };
      const correctIds = (await tx.select({ optionId: s.questionCorrectOptions.optionId }).from(s.questionCorrectOptions).where(eq(s.questionCorrectOptions.questionId, parsed.data.questionId))).map((row) => row.optionId);
      const feedback = buildPracticeFeedback(options, correctIds, selectedIds, question?.explanation ?? null, { document: question?.sourceDocument ?? null, revision: question?.sourceRevision ?? null, location: question?.sourceLocation ?? null });
      if (!prior && !feedback.correct) {
        await tx.insert(s.practiceQuestionReviewQueue).values({ userId: req.user!.id, attemptId: attempt.id, questionId: parsed.data.questionId }).onConflictDoNothing();
      }
      return { kind: 'feedback' as const, feedback };
    });
    if (result.kind === 'not_found') return fail(res, 404, 'NOT_FOUND', 'Сорилын оролдлого олдсонгүй.');
    if (result.kind === 'closed') return fail(res, 409, 'ATTEMPT_CLOSED', 'Энэ сорил дууссан байна.');
    if (result.kind === 'not_in_quiz') return fail(res, 400, 'QUESTION_NOT_IN_QUIZ', 'Асуулт энэ сорилд байхгүй байна.');
    if (result.kind === 'invalid_options') return fail(res, 400, 'INVALID_OPTIONS', 'Сонгосон хариултын сонголт буруу байна.');
    res.json(result.kind === 'feedback' ? { saved: true, ...result.feedback } : { saved: true });
  } catch (error) { next(error); }
});

practiceQuizRouter.post('/attempts/:id/questions/:questionId/retry', requireAuth, async (req, res, next) => {
  try {
    const parsed = retrySchema.safeParse(req.body);
    if (!parsed.success || new Set(parsed.data.optionIds).size !== parsed.data.optionIds.length) return fail(res, 400, 'VALIDATION', 'Давтах хариултаа шалгана уу.');
    const result = await db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(s.quizAttempts).where(and(eq(s.quizAttempts.id, String(req.params.id)), eq(s.quizAttempts.userId, req.user!.id))).for('update').limit(1);
      if (!attempt) return { kind: 'not_found' as const };
      const [quiz] = await tx.select().from(s.quizzes).where(eq(s.quizzes.id, attempt.quizId)).limit(1);
      if (!quiz || quiz.quizType !== 'practice' || (!mayReturnImmediateFeedback(quiz) && !(attempt.status === 'submitted' && quiz.showExplanations))) return { kind: 'not_practice' as const };
      const [link] = await tx.select().from(s.quizAttemptQuestions).where(and(eq(s.quizAttemptQuestions.attemptId, attempt.id), eq(s.quizAttemptQuestions.questionId, String(req.params.questionId)))).limit(1);
      if (!link) return { kind: 'not_in_quiz' as const };
      const [answer] = await tx.select().from(s.answers).where(and(eq(s.answers.attemptId, attempt.id), eq(s.answers.questionId, String(req.params.questionId)))).limit(1);
      if (!answer) return { kind: 'not_missed' as const };
      const original = (await tx.select({ optionId: s.answerOptions.optionId }).from(s.answerOptions).where(eq(s.answerOptions.answerId, answer.id))).map((row) => row.optionId);
      const correctIds = (await tx.select({ optionId: s.questionCorrectOptions.optionId }).from(s.questionCorrectOptions).where(eq(s.questionCorrectOptions.questionId, answer.questionId))).map((row) => row.optionId);
      if (answersMatch([...original].sort(), [...correctIds].sort())) return { kind: 'not_missed' as const };
      const options = await tx.select({ id: s.questionOptions.id, text: s.questionOptions.optionText }).from(s.questionOptions).where(eq(s.questionOptions.questionId, answer.questionId));
      if (parsed.data.optionIds.some((id) => !options.some((option) => option.id === id))) return { kind: 'invalid_options' as const };
      const [question] = await tx.select({ explanation: s.questions.explanation, sourceDocument: s.questions.sourceDocument, sourceRevision: s.questions.sourceRevision, sourceLocation: s.questions.sourceLocation }).from(s.questions).where(eq(s.questions.id, answer.questionId)).limit(1);
      await tx.insert(s.practiceQuestionReviewQueue).values({ userId: req.user!.id, attemptId: attempt.id, questionId: answer.questionId }).onConflictDoNothing();
      const [queue] = await tx.select().from(s.practiceQuestionReviewQueue).where(and(eq(s.practiceQuestionReviewQueue.userId, req.user!.id), eq(s.practiceQuestionReviewQueue.attemptId, attempt.id), eq(s.practiceQuestionReviewQueue.questionId, answer.questionId))).for('update').limit(1);
      if (!queue || queue.status === 'mastered') return { kind: 'already_mastered' as const };
      const correct = answersMatch([...parsed.data.optionIds].sort(), [...correctIds].sort());
      const [review] = await tx.insert(s.practiceQuestionReviewAnswers).values({ queueId: queue.id, selectedOptionIds: parsed.data.optionIds, isCorrect: correct, awardedXp: 0 }).returning({ id: s.practiceQuestionReviewAnswers.id });
      const reviewCount = queue.reviewCount + 1;
      await tx.update(s.practiceQuestionReviewQueue).set({ reviewCount, status: correct ? 'mastered' : 'open', lastReviewedAt: new Date(), masteredAt: correct ? new Date() : null }).where(eq(s.practiceQuestionReviewQueue.id, queue.id));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'practice_question.retried', entityType: 'practice_question_review', entityId: review.id, metadata: { attemptId: attempt.id, questionId: answer.questionId, correct, reviewCount, awardedXp: 0 } });
      return { kind: 'saved' as const, correct, selectedOptionTexts: options.filter((option) => parsed.data.optionIds.includes(option.id)).map((option) => option.text), correctOptionTexts: options.filter((option) => correctIds.includes(option.id)).map((option) => option.text), explanation: question?.explanation ?? '', source: { document: question?.sourceDocument ?? null, revision: question?.sourceRevision ?? null, location: question?.sourceLocation ?? null }, reviewCount, awardedXp: 0 };
    });
    if (result.kind === 'not_found') return fail(res, 404, 'NOT_FOUND', 'Сорилын оролдлого олдсонгүй.');
    if (result.kind === 'not_practice') return fail(res, 403, 'RETRY_NOT_ALLOWED', 'Зөвхөн тайлбар харуулах тохиргоотой Practice сорилд давтах боломжтой.');
    if (result.kind === 'not_in_quiz') return fail(res, 400, 'QUESTION_NOT_IN_QUIZ', 'Асуулт энэ сорилд байхгүй байна.');
    if (result.kind === 'not_missed') return fail(res, 409, 'QUESTION_NOT_MISSED', 'Зөв хариулсан эсвэл хариулаагүй асуултыг давтлагын бүртгэлд оруулахгүй.');
    if (result.kind === 'invalid_options') return fail(res, 400, 'INVALID_OPTIONS', 'Сонгосон хариултын сонголт буруу байна.');
    if (result.kind === 'already_mastered') return fail(res, 409, 'ALREADY_MASTERED', 'Энэ асуултыг давтаж зөв хариулсан байна.');
    res.json({ saved: true, ...result });
  } catch (error) { next(error); }
});

