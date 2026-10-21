import { Router } from 'express';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db.js';
import * as s from './schema.js';
import { requireAuth, requireRoles } from './auth.js';
import { answersMatch } from './scoring.js';
import { earnedLearningAnswerXp, lessonPasses } from './learning-policy.js';
import { achievedMilestones, buildCourseLessonPath, currentLearningStreak, lessonXpReward, localActivityDate } from './learning-course-policy.js';
import { isVisibleTrainingLesson } from './quiz-lifecycle.js';
import { buildLearningAnswerFeedback } from './learning-answer-feedback.js';
import { advanceTheoryProgress, theoryContentVersion } from './lesson-theory-policy.js';

export const learningRouter = Router();
const fail = (res: import('express').Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
type QuestionSnapshot = { text: string; type: string; options: { id: string; text: string }[]; correctOptionIds: string[]; explanation: string; sourceDocument?: string | null; sourceRevision?: string | null; sourceLocation?: string | null };
type PathQuestion = { id: string; questionOrder: number; xp: number; snapshot: QuestionSnapshot };

async function makePathPack(attemptId: string, userId: string) {
  const [attempt] = await db.select().from(s.learningAttempts).where(and(eq(s.learningAttempts.id, attemptId), eq(s.learningAttempts.userId, userId))).limit(1);
  if (!attempt) return null;
  const [lessonRow] = await db.select({ id: s.lessons.id, title: s.lessons.title, lessonOrder: s.lessons.lessonOrder, description: s.lessons.description, estimatedMinutes: s.lessons.estimatedMinutes, learningObjectives: s.lessons.learningObjectives, passPercentage: s.lessons.passPercentage, chapterId: s.chapters.id, chapterTitle: s.chapters.title, chapterOrder: s.chapters.chapterOrder, subjectId:s.courses.subjectId, courseId: s.courses.id, courseTitle: s.courses.title })
    .from(s.lessons).leftJoin(s.chapters, eq(s.chapters.id, s.lessons.chapterId)).leftJoin(s.courses, eq(s.courses.id, s.chapters.courseId)).where(eq(s.lessons.id, attempt.lessonId)).limit(1);
  const contentBlocks = await db.select({ id: s.lessonContentBlocks.id, blockOrder: s.lessonContentBlocks.blockOrder, blockType: s.lessonContentBlocks.blockType, content: s.lessonContentBlocks.content, sourceDocument: s.lessonContentBlocks.sourceDocument, sourceRevision: s.lessonContentBlocks.sourceRevision, sourcePage: s.lessonContentBlocks.sourcePage })
    .from(s.lessonContentBlocks).where(and(eq(s.lessonContentBlocks.lessonId, attempt.lessonId), eq(s.lessonContentBlocks.reviewStatus, 'approved'))).orderBy(asc(s.lessonContentBlocks.blockOrder));
  const questions = await db.select().from(s.learningAttemptQuestions).where(eq(s.learningAttemptQuestions.attemptId, attempt.id)).orderBy(asc(s.learningAttemptQuestions.questionOrder));
  const answers = await db.select().from(s.learningAttemptAnswers).where(eq(s.learningAttemptAnswers.attemptId, attempt.id));
  const safeQuestions = questions.map((row) => {
    const snapshot = row.snapshot as QuestionSnapshot;
    return { id: row.questionId, text: snapshot.text, type: snapshot.type, options: snapshot.options, xp: row.xp };
  });
  return {
    attempt: { id: attempt.id, mode: attempt.mode, status: attempt.status, currentQuestionOrder: attempt.currentQuestionOrder, correctCount: attempt.correctCount, earnedXp: attempt.earnedXp },
    lesson: lessonRow ? { id: lessonRow.id, title: lessonRow.title, description: lessonRow.description, lessonOrder: lessonRow.lessonOrder, estimatedMinutes: lessonRow.estimatedMinutes, learningObjectives: lessonRow.learningObjectives, passPercentage: lessonRow.passPercentage, chapter: lessonRow.chapterId ? { id: lessonRow.chapterId, title: lessonRow.chapterTitle, order: lessonRow.chapterOrder } : null, course: lessonRow.courseId ? { id: lessonRow.courseId, title: lessonRow.courseTitle } : null, contentBlocks } : null,
    questions: safeQuestions,
    answers: answers.map((answer) => ({ questionId: answer.questionId, selectedOptionIds: answer.selectedOptionIds, isCorrect: answer.isCorrect })),
  };
}

learningRouter.get('/path', requireAuth, async (req, res, next) => {
  try {
    const filter=z.object({subjectId:z.string().uuid().optional()}).safeParse(req.query);
    if(!filter.success)return fail(res,400,'VALIDATION','Чиглэлийн сонголтоо шалгана уу.');
    const subjectId=filter.data.subjectId;
    if(subjectId){const [subject]=await db.select({id:s.learningSubjects.id}).from(s.learningSubjects).where(and(eq(s.learningSubjects.id,subjectId),eq(s.learningSubjects.isActive,true)));if(!subject)return fail(res,404,'SUBJECT_NOT_FOUND','Сургалтын чиглэл олдсонгүй.');}
    const rows = await db.select({ id: s.lessons.id, title: s.lessons.title, description: s.lessons.description, categoryId: s.lessons.categoryId, lessonOrder: s.lessons.lessonOrder, status: s.lessons.status, theoryRequired: s.lessons.theoryRequired, passPercentage: s.lessons.passPercentage, completionXp: s.lessons.completionXp, passXp: s.lessons.passXp, perfectXp: s.lessons.perfectXp, estimatedMinutes: s.lessons.estimatedMinutes,
      chapterId: s.chapters.id, chapterTitle: s.chapters.title, chapterOrder: s.chapters.chapterOrder, chapterStatus: s.chapters.status, requiredLessonsCompleted: s.chapters.requiredLessonsCompleted,
      subjectId:s.courses.subjectId, courseId: s.courses.id, courseTitle: s.courses.title, courseDescription: s.courses.description, courseOrder: s.courses.courseOrder, courseStatus: s.courses.status, freeLearningMode: s.courses.freeLearningMode, courseLessonPassPercentage: s.courses.defaultLessonPassPercentage, courseCompletionXp: s.courses.lessonCompletionXp, coursePassXp: s.courses.lessonPassXp, coursePerfectXp: s.courses.perfectPracticeXp, chapterQuizPassPercentage: s.courses.chapterQuizPassPercentage })
      .from(s.lessons).leftJoin(s.chapters, eq(s.chapters.id, s.lessons.chapterId)).leftJoin(s.courses, eq(s.courses.id, s.chapters.courseId))
      .where(eq(s.lessons.status, 'published')).orderBy(asc(s.courses.courseOrder), asc(s.chapters.chapterOrder), asc(s.lessons.lessonOrder), asc(s.lessons.createdAt), asc(s.lessons.id));
    const lessons = rows.filter((row) => (!subjectId||(row.subjectId??'11100000-0000-4000-8000-000000000001')===subjectId)&&(!row.courseId || (row.courseStatus === 'published' && row.chapterStatus === 'published')));
    const ids = lessons.map((lesson) => lesson.id);
    const theoryBlocks = ids.length ? await db.select({ id: s.lessonContentBlocks.id, lessonId: s.lessonContentBlocks.lessonId, blockOrder: s.lessonContentBlocks.blockOrder, blockType: s.lessonContentBlocks.blockType, content: s.lessonContentBlocks.content, updatedAt: s.lessonContentBlocks.updatedAt }).from(s.lessonContentBlocks).where(and(inArray(s.lessonContentBlocks.lessonId, ids), eq(s.lessonContentBlocks.reviewStatus, 'approved'))).orderBy(asc(s.lessonContentBlocks.blockOrder)) : [];
    const theoryProgress = ids.length ? await db.select().from(s.lessonTheoryProgress).where(and(eq(s.lessonTheoryProgress.userId, req.user!.id), inArray(s.lessonTheoryProgress.lessonId, ids))) : [];
    const theoryByLesson = new Map<string, typeof theoryBlocks>();
    for (const block of theoryBlocks) theoryByLesson.set(block.lessonId, [...(theoryByLesson.get(block.lessonId) ?? []), block]);
    const theoryProgressByLesson = new Map(theoryProgress.map((item) => [item.lessonId, item]));
    const links = ids.length ? await db.select({ lessonId: s.lessonQuestions.lessonId, questionId: s.questions.id, status: s.questions.status, xp: s.questions.xp }).from(s.lessonQuestions).innerJoin(s.questions, eq(s.questions.id, s.lessonQuestions.questionId)).where(inArray(s.lessonQuestions.lessonId, ids)) : [];
    const progress = ids.length ? await db.select({ lessonId: s.lessonProgress.lessonId, xpEarned: s.lessonProgress.xpEarned, correctCount: s.lessonProgress.correctCount, accuracy: s.lessonProgress.accuracy, completedAt: s.lessonProgress.completedAt }).from(s.lessonProgress).where(and(eq(s.lessonProgress.userId, req.user!.id), inArray(s.lessonProgress.lessonId, ids))) : [];
    const trainingQuizzes = ids.length ? await db.select({ lessonId: s.quizzes.lessonId, id: s.quizzes.id, title: s.quizzes.title, status: s.quizzes.status }).from(s.quizzes).where(and(eq(s.quizzes.quizType, 'training'), inArray(s.quizzes.lessonId, ids))) : [];
    const chapterIds = [...new Set(lessons.flatMap((lesson) => lesson.chapterId ? [lesson.chapterId] : []))];
    const finalQuizzes = chapterIds.length ? await db.select({ id: s.quizzes.id, title: s.quizzes.title, status: s.quizzes.status, questionCount: s.quizzes.questionCount, passingPercentage: s.courses.chapterQuizPassPercentage, chapterId: s.quizzes.chapterId }).from(s.quizzes).innerJoin(s.chapters, eq(s.chapters.id, s.quizzes.chapterId)).innerJoin(s.courses, eq(s.courses.id, s.chapters.courseId)).where(and(inArray(s.quizzes.chapterId, chapterIds), eq(s.quizzes.status, 'published'), eq(s.chapters.status, 'published'), eq(s.courses.status, 'published'))) : [];
    const finalQuizIds = finalQuizzes.map((quiz) => quiz.id);
    const passedFinalQuizRows = finalQuizIds.length ? await db.select({ quizId: s.quizAttempts.quizId, accuracy: s.quizAttempts.accuracy }).from(s.quizAttempts).where(and(eq(s.quizAttempts.userId, req.user!.id), inArray(s.quizAttempts.quizId, finalQuizIds), eq(s.quizAttempts.status, 'submitted'))) : [];
    const passedFinalQuizIds = new Set(passedFinalQuizRows.filter((attempt) => { const quiz = finalQuizzes.find((row) => row.id === attempt.quizId); return !!quiz && attempt.accuracy >= quiz.passingPercentage; }).map((attempt) => attempt.quizId));
    const counts = new Map<string, { total: number; published: number; questionXp: number }>();
    for (const link of links) { const item = counts.get(link.lessonId) ?? { total: 0, published: 0, questionXp: 0 }; item.total++; item.questionXp += link.xp; if (link.status === 'published') item.published++; counts.set(link.lessonId, item); }
    const progressById = new Map(progress.map((item) => [item.lessonId, item]));
    const chapterGroups = [...new Map(lessons.filter((lesson) => lesson.chapterId && lesson.courseId).map((lesson) => [lesson.chapterId!, { id: lesson.chapterId!, courseId: lesson.courseId!, order: lesson.chapterOrder ?? 0 }])).values()];
    const groupUnlocked = new Map<string, boolean>();
    const groupLockReasons = new Map<string,string>();
    const courseIds = [...new Set(chapterGroups.map((chapter) => chapter.courseId))];
    for (const courseId of courseIds) {
      const courseChapters = chapterGroups.filter((chapter) => chapter.courseId === courseId).sort((a, b) => a.order - b.order);
      let allowed = true;let prerequisiteReason='';
      for (const chapter of courseChapters) {
        const continued=lessons.some(lesson=>lesson.chapterId===chapter.id&&progressById.has(lesson.id));
        groupUnlocked.set(chapter.id, allowed||continued);
        if(!allowed&&!continued)groupLockReasons.set(chapter.id,prerequisiteReason);
        const chapterLessons = lessons.filter((lesson) => lesson.chapterId === chapter.id);
        const allLessonsDone = chapterLessons.length > 0 && chapterLessons.every((lesson) => progressById.has(lesson.id));
        const finalQuiz = finalQuizzes.find((quiz) => quiz.chapterId === chapter.id);
        const quizPassed = !!finalQuiz && passedFinalQuizIds.has(finalQuiz.id);
        allowed = finalQuiz ? quizPassed : allLessonsDone;
        const chapterTitle=chapterLessons[0]?.chapterTitle||'Өмнөх бүлэг';prerequisiteReason=finalQuiz?`“${chapterTitle}” бүлгийн эцсийн сорилд тэнцэнэ үү.`:`“${chapterTitle}” бүлгийн хичээлүүдийг дуусгана уу.`;
      }
    }
    const unlockedRows = buildCourseLessonPath(lessons.map((lesson) => { const count = counts.get(lesson.id) ?? { total: 0, published: 0, questionXp: 0 }; return { id: lesson.id, lessonOrder: lesson.lessonOrder, completed: progressById.has(lesson.id), questionCount: count.total === count.published ? count.total : 0, groupKey: lesson.chapterId ?? lesson.courseId ?? 'legacy', freeLearning: !!lesson.freeLearningMode, groupUnlocked: !lesson.chapterId || groupUnlocked.get(lesson.chapterId) !== false }; }));
    const unlockedById = new Map(unlockedRows.map((item) => [item.id, item.unlocked]));
    const items = lessons.map((lesson) => {
      const count = counts.get(lesson.id) ?? { total: 0, published: 0, questionXp: 0 }; const done = progressById.get(lesson.id); const training = trainingQuizzes.find((quiz) => quiz.lessonId === lesson.id);
      const blocks = theoryByLesson.get(lesson.id) ?? []; const contentVersion = theoryContentVersion(blocks); const theoryProgressRow = theoryProgressByLesson.get(lesson.id);
      const theoryReady = blocks.length > 0; const theoryCompleted = !!theoryProgressRow && theoryProgressRow.contentVersion === contentVersion && !!theoryProgressRow.completedAt;
      return { ...lesson, theoryReady, theoryCompleted, theoryBlockCount: blocks.length, passPercentage: lesson.courseLessonPassPercentage ?? lesson.passPercentage, questionCount: count.total, publishedQuestionCount: count.published, potentialXp: count.questionXp + (lesson.courseId ? lesson.courseCompletionXp ?? lesson.completionXp : lesson.completionXp) + (lesson.courseId ? lesson.coursePassXp ?? lesson.passXp : lesson.passXp) + (lesson.courseId ? lesson.coursePerfectXp ?? lesson.perfectXp : lesson.perfectXp), completed: !!done, completedAt: done?.completedAt ?? null, xpEarned: done?.xpEarned ?? 0, correctCount: done?.correctCount ?? 0, accuracy: done?.accuracy ?? null, unlocked: unlockedById.get(lesson.id) ?? false,
        lockReason:unlockedById.get(lesson.id)?null:count.total<1||count.total>100||count.total!==count.published?'Хичээлийн асуултууд бэлтгэгдэж байна.':lesson.chapterId&&groupLockReasons.has(lesson.chapterId)?groupLockReasons.get(lesson.chapterId):(()=>{const prior=lessons.filter(item=>(item.chapterId??item.courseId??'legacy')===(lesson.chapterId??lesson.courseId??'legacy'));const position=prior.findIndex(item=>item.id===lesson.id);const missing=prior.slice(0,position).find(item=>!progressById.has(item.id));return missing?`“${missing.title}” хичээлийг ${missing.courseLessonPassPercentage??missing.passPercentage}% ба түүнээс дээш үнэлгээтэй дуусгана уу.`:'Өмнөх хичээлээ дуусгана уу.'})(),
        trainingQuizId: training?.id ?? null, trainingQuizTitle: training?.title ?? null, trainingQuizStatus: training?.status ?? null, trainingQuizVisible: !!training && isVisibleTrainingLesson(lesson.status, training.status, count.total, count.published) };
    });
    const courses = [...new Map(lessons.filter((lesson) => lesson.courseId).map((lesson) => [lesson.courseId!, { id: lesson.courseId!, subjectId:lesson.subjectId, title: lesson.courseTitle!, description: lesson.courseDescription ?? '', courseOrder: lesson.courseOrder ?? 0, freeLearningMode: !!lesson.freeLearningMode }])).values()]
      .map((course) => ({ ...course, chapters: [...new Map(lessons.filter((lesson) => lesson.courseId === course.id && lesson.chapterId).map((lesson) => [lesson.chapterId!, { id: lesson.chapterId!, title: lesson.chapterTitle!, chapterOrder: lesson.chapterOrder ?? 0, requiredLessonsCompleted: lesson.requiredLessonsCompleted ?? true, passPercentage: lesson.chapterQuizPassPercentage ?? 70 }])).values()].map((chapter) => {
        const chapterLessons = items.filter((lesson) => lesson.chapterId === chapter.id); const finalQuiz = finalQuizzes.find((quiz) => quiz.chapterId === chapter.id); const completedCount = chapterLessons.filter((lesson) => lesson.completed).length;
        const firstUnlocked = chapterLessons[0]?.unlocked ?? false; const complete = chapterLessons.length > 0 && completedCount === chapterLessons.length;
        return { ...chapter, lessons: chapterLessons, completedLessons: completedCount, completionPercentage: chapterLessons.length ? Math.round(completedCount / chapterLessons.length * 100) : 0,
          finalQuiz: finalQuiz ? { ...finalQuiz, passed: passedFinalQuizIds.has(finalQuiz.id), unlocked: firstUnlocked && (!chapter.requiredLessonsCompleted || complete) } : null };
      }) }));
    const [xp] = await db.select({ total: sql<number>`coalesce(sum(${s.xpTransactions.amount}),0)::int` }).from(s.xpTransactions).where(eq(s.xpTransactions.userId, req.user!.id));
    const [user] = await db.select({ timezone: s.users.timezone }).from(s.users).where(eq(s.users.id, req.user!.id)).limit(1);
    const today = localActivityDate(new Date(), user?.timezone ?? 'Asia/Ulaanbaatar');
    const activity = await db.select({ activityDate: s.learningActivityDays.activityDate, activityCount: s.learningActivityDays.activityCount, xpEarned: s.learningActivityDays.xpEarned }).from(s.learningActivityDays).where(and(eq(s.learningActivityDays.userId, req.user!.id), sql`${s.learningActivityDays.activityDate} <= ${today}`)).orderBy(desc(s.learningActivityDays.activityDate)).limit(366);
    const streak = currentLearningStreak(activity.map((item) => item.activityDate), today);
    const weekStart = new Date(`${today}T00:00:00.000Z`); weekStart.setUTCDate(weekStart.getUTCDate() - 6); const startDate = weekStart.toISOString().slice(0, 10);
    const weeklyActivity = activity.filter((item) => item.activityDate >= startDate);
    res.json({ items, courses, summary: { completedLessons: progress.length, xp: xp?.total ?? 0, totalLessons: lessons.length, completionPercentage: lessons.length ? Math.round(progress.length / lessons.length * 100) : 0, activityDate: today, currentStreak: streak, todayActivityCount: activity.find((item) => item.activityDate === today)?.activityCount ?? 0, weeklyActiveDays: weeklyActivity.length, weeklyXp: weeklyActivity.reduce((total, item) => total + item.xpEarned, 0) } });
  } catch (error) { next(error); }
});

learningRouter.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const [summary] = await db.select({ completedLessons: sql<number>`count(*)::int`, correctAnswers: sql<number>`coalesce(sum(${s.lessonProgress.correctCount}),0)::int` }).from(s.lessonProgress).where(eq(s.lessonProgress.userId, req.user!.id));
    const [xp] = await db.select({ xp: sql<number>`coalesce(sum(${s.xpTransactions.amount}),0)::int` }).from(s.xpTransactions).where(eq(s.xpTransactions.userId, req.user!.id));
    const [lessonQueue] = await db.select({ wrongAnswers: sql<number>`coalesce(sum(${s.questionReviewQueue.missCount}),0)::int`, needsReview: sql<number>`count(*) filter (where ${s.questionReviewQueue.status} = 'open')::int` }).from(s.questionReviewQueue).where(eq(s.questionReviewQueue.userId, req.user!.id));
    const [practiceQueue] = await db.select({ wrongAnswers: sql<number>`coalesce(sum(${s.practiceQuestionReviewQueue.missCount}),0)::int`, needsReview: sql<number>`count(*) filter (where ${s.practiceQuestionReviewQueue.status} = 'open')::int` }).from(s.practiceQuestionReviewQueue).where(eq(s.practiceQuestionReviewQueue.userId, req.user!.id));
    const [lessonReviews] = await db.select({ reviewedAnswers: sql<number>`count(*)::int`, reviewedQuestions: sql<number>`count(distinct ${s.learningAttemptAnswers.questionId})::int`, correctAfterReview: sql<number>`count(*) filter (where ${s.learningAttemptAnswers.isCorrect})::int` }).from(s.learningAttemptAnswers).innerJoin(s.learningAttempts, eq(s.learningAttempts.id, s.learningAttemptAnswers.attemptId)).where(and(eq(s.learningAttempts.userId, req.user!.id), eq(s.learningAttempts.mode, 'review')));
    const [practiceReviews] = await db.select({ reviewedAnswers: sql<number>`count(*)::int`, reviewedQuestions: sql<number>`count(distinct ${s.practiceQuestionReviewQueue.questionId})::int`, correctAfterReview: sql<number>`count(*) filter (where ${s.practiceQuestionReviewAnswers.isCorrect})::int` }).from(s.practiceQuestionReviewAnswers).innerJoin(s.practiceQuestionReviewQueue, eq(s.practiceQuestionReviewQueue.id, s.practiceQuestionReviewAnswers.queueId)).where(eq(s.practiceQuestionReviewQueue.userId, req.user!.id));
    const topics = await db.select({ categoryId: s.categories.id, category: s.categories.name, wrongAnswers: sql<number>`coalesce(sum(${s.questionReviewQueue.missCount}),0)::int`, needsReview: sql<number>`count(*) filter (where ${s.questionReviewQueue.status} = 'open')::int`, mastered: sql<number>`count(*) filter (where ${s.questionReviewQueue.status} = 'mastered')::int` }).from(s.questionReviewQueue).innerJoin(s.questions, eq(s.questions.id, s.questionReviewQueue.questionId)).innerJoin(s.categories, eq(s.categories.id, s.questions.categoryId)).where(eq(s.questionReviewQueue.userId, req.user!.id)).groupBy(s.categories.id, s.categories.name).orderBy(asc(s.categories.name));
    res.json({ ...summary, xp: xp?.xp ?? 0, wrongAnswers: (lessonQueue?.wrongAnswers ?? 0) + (practiceQueue?.wrongAnswers ?? 0), reviewedAnswers: (lessonReviews?.reviewedAnswers ?? 0) + (practiceReviews?.reviewedAnswers ?? 0), reviewedQuestions: (lessonReviews?.reviewedQuestions ?? 0) + (practiceReviews?.reviewedQuestions ?? 0), correctAfterReview: (lessonReviews?.correctAfterReview ?? 0) + (practiceReviews?.correctAfterReview ?? 0), needsReview: (lessonQueue?.needsReview ?? 0) + (practiceQueue?.needsReview ?? 0), topicProgress: topics });
  } catch (error) { next(error); }
});

learningRouter.get('/xp', requireAuth, async (req, res, next) => {
  try {
    const items = await db.select().from(s.xpTransactions).where(eq(s.xpTransactions.userId, req.user!.id)).orderBy(desc(s.xpTransactions.createdAt)).limit(100);
    const [summary] = await db.select({ total: sql<number>`coalesce(sum(${s.xpTransactions.amount}),0)::int` }).from(s.xpTransactions).where(eq(s.xpTransactions.userId, req.user!.id));
    res.json({ total: summary?.total ?? 0, items });
  } catch (error) { next(error); }
});

learningRouter.get('/achievements', requireAuth, async (req, res, next) => {
  try {
    const items = await db.select({ id: s.achievements.id, code: s.achievements.code, title: s.achievements.title, description: s.achievements.description, xpReward: s.achievements.xpReward, earnedAt: s.userAchievements.earnedAt })
      .from(s.achievements).leftJoin(s.userAchievements, and(eq(s.userAchievements.achievementId, s.achievements.id), eq(s.userAchievements.userId, req.user!.id))).where(eq(s.achievements.isActive, true));
    res.json({ items });
  } catch (error) { next(error); }
});

learningRouter.get('/review-queue', requireAuth, async (req, res, next) => {
  try {
    const lessonItems = await db.select({ id: s.questionReviewQueue.id, kind: sql<string>`'lesson'`, questionId: s.questions.id, questionText: s.questions.questionText, lessonId: s.lessons.id, lessonTitle: s.lessons.title, missCount: s.questionReviewQueue.missCount, reviewCount: s.questionReviewQueue.reviewCount, firstMissedAt: s.questionReviewQueue.firstMissedAt, lastMissedAt: s.questionReviewQueue.lastMissedAt, sourceDocument: s.questions.sourceDocument, sourceRevision: s.questions.sourceRevision, sourceLocation: s.questions.sourceLocation })
      .from(s.questionReviewQueue).innerJoin(s.questions, eq(s.questions.id, s.questionReviewQueue.questionId)).innerJoin(s.lessons, eq(s.lessons.id, s.questionReviewQueue.lessonId))
      .where(and(eq(s.questionReviewQueue.userId, req.user!.id), eq(s.questionReviewQueue.status, 'open'), eq(s.questions.status, 'published'))).orderBy(desc(s.questionReviewQueue.lastMissedAt));
    const practiceItems = await db.select({ id: s.practiceQuestionReviewQueue.id, kind: sql<string>`'practice'`, questionId: s.questions.id, questionText: s.questions.questionText, lessonId: s.quizzes.lessonId, lessonTitle: s.quizzes.title, attemptId: s.quizAttempts.id, quizId: s.quizzes.id, missCount: s.practiceQuestionReviewQueue.missCount, reviewCount: s.practiceQuestionReviewQueue.reviewCount, firstMissedAt: s.practiceQuestionReviewQueue.firstMissedAt, lastMissedAt: s.practiceQuestionReviewQueue.lastMissedAt, sourceDocument: s.questions.sourceDocument, sourceRevision: s.questions.sourceRevision, sourceLocation: s.questions.sourceLocation, options: sql<{id:string;text:string}[]>`json_agg(json_build_object('id', ${s.questionOptions.id}, 'text', ${s.questionOptions.optionText}) order by ${s.questionOptions.optionOrder})` })
      .from(s.practiceQuestionReviewQueue).innerJoin(s.questions, eq(s.questions.id, s.practiceQuestionReviewQueue.questionId)).innerJoin(s.quizAttempts, eq(s.quizAttempts.id, s.practiceQuestionReviewQueue.attemptId)).innerJoin(s.quizzes, eq(s.quizzes.id, s.quizAttempts.quizId)).innerJoin(s.questionOptions, eq(s.questionOptions.questionId, s.questions.id))
      .where(and(eq(s.practiceQuestionReviewQueue.userId, req.user!.id), eq(s.practiceQuestionReviewQueue.status, 'open'), eq(s.quizzes.quizType, 'practice'), sql`(${s.quizzes.immediateFeedback} = true or (${s.quizAttempts.status} = 'submitted' and ${s.quizzes.showExplanations} = true))`)).groupBy(s.practiceQuestionReviewQueue.id, s.questions.id, s.quizzes.lessonId, s.quizzes.title, s.quizAttempts.id, s.quizzes.id).orderBy(desc(s.practiceQuestionReviewQueue.lastMissedAt));
    const items = [...lessonItems, ...practiceItems].sort((a, b) => new Date(b.lastMissedAt).getTime() - new Date(a.lastMissedAt).getTime());
    res.json({ items });
  } catch (error) { next(error); }
});

learningRouter.post('/review-queue/start', requireAuth, async (req, res, next) => {
  try {
    const input = z.object({ questionIds: z.array(z.string().uuid()).min(1).max(50).optional() }).safeParse(req.body);
    if (!input.success) return fail(res, 400, 'VALIDATION', 'Давтах асуултын жагсаалтыг шалгана уу.');
    const result = await db.transaction(async (tx) => {
      const queued = await tx.select({ questionId: s.questionReviewQueue.questionId, lessonId: s.questionReviewQueue.lessonId }).from(s.questionReviewQueue).innerJoin(s.questions, eq(s.questions.id, s.questionReviewQueue.questionId))
        .where(and(eq(s.questionReviewQueue.userId, req.user!.id), eq(s.questionReviewQueue.status, 'open'), eq(s.questions.status, 'published'), ...(input.data.questionIds ? [inArray(s.questionReviewQueue.questionId, input.data.questionIds)] : []))).orderBy(asc(s.questionReviewQueue.lastMissedAt)).limit(50);
      if (!queued.length) return null;
      const options = await tx.select({ questionId: s.questionOptions.questionId, id: s.questionOptions.id, text: s.questionOptions.optionText }).from(s.questionOptions).where(inArray(s.questionOptions.questionId, queued.map((item) => item.questionId))).orderBy(asc(s.questionOptions.optionOrder));
      const correct = await tx.select({ questionId: s.questionCorrectOptions.questionId, optionId: s.questionCorrectOptions.optionId }).from(s.questionCorrectOptions).where(inArray(s.questionCorrectOptions.questionId, queued.map((item) => item.questionId)));
      const questions = await tx.select({ id: s.questions.id, text: s.questions.questionText, type: s.questions.questionType, explanation: s.questions.explanation, xp: s.questions.xp, sourceDocument: s.questions.sourceDocument, sourceRevision: s.questions.sourceRevision, sourceLocation: s.questions.sourceLocation }).from(s.questions).where(inArray(s.questions.id, queued.map((item) => item.questionId)));
      const byOptions = new Map<string, { id: string; text: string }[]>(); for (const row of options) byOptions.set(row.questionId, [...(byOptions.get(row.questionId) ?? []), { id: row.id, text: row.text }]);
      const byCorrect = new Map<string, string[]>(); for (const row of correct) byCorrect.set(row.questionId, [...(byCorrect.get(row.questionId) ?? []), row.optionId]);
      if (queued.some((row) => !byOptions.get(row.questionId)?.length || !byCorrect.get(row.questionId)?.length)) return null;
      const [attempt] = await tx.insert(s.learningAttempts).values({ userId: req.user!.id, lessonId: queued[0].lessonId, mode: 'review' }).returning({ id: s.learningAttempts.id });
      await tx.insert(s.learningAttemptQuestions).values(queued.map((row, questionOrder) => { const question = questions.find((item) => item.id === row.questionId)!; return { attemptId: attempt.id, questionId: row.questionId, questionOrder, xp: question.xp, snapshot: { text: question.text, type: question.type, options: byOptions.get(row.questionId)!, correctOptionIds: byCorrect.get(row.questionId)!, explanation: question.explanation, sourceDocument: question.sourceDocument, sourceRevision: question.sourceRevision, sourceLocation: question.sourceLocation } }; }));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'learning.review_queue.started', entityType: 'learning_attempt', entityId: attempt.id, metadata: { questionCount: queued.length } });
      return attempt.id;
    });
    if (!result) return fail(res, 409, 'NO_REVIEW_QUESTIONS', 'Давтах нийтлэгдсэн асуулт алга байна.');
    const pack = await makePathPack(result, req.user!.id);
    if (!pack) return fail(res, 404, 'ATTEMPT_NOT_FOUND', 'Давтлагын оролдлого үүссэнгүй.');
    res.status(201).json(pack);
  } catch (error) { next(error); }
});

learningRouter.get('/lessons/:id/theory', requireAuth, async (req, res, next) => {
  try {
    const lessonId = String(req.params.id);
    const [lesson] = await db.select({ id: s.lessons.id, title: s.lessons.title, categoryId: s.lessons.categoryId, theoryRequired: s.lessons.theoryRequired, status: s.lessons.status, chapterId: s.chapters.id, courseId: s.courses.id, freeLearning: s.courses.freeLearningMode, courseStatus: s.courses.status, chapterStatus: s.chapters.status })
      .from(s.lessons).leftJoin(s.chapters, eq(s.chapters.id, s.lessons.chapterId)).leftJoin(s.courses, eq(s.courses.id, s.chapters.courseId)).where(eq(s.lessons.id, lessonId)).limit(1);
    if (!lesson || lesson.status !== 'published' || (lesson.courseStatus && (lesson.courseStatus !== 'published' || lesson.chapterStatus !== 'published'))) return fail(res, 404, 'LESSON_NOT_FOUND', 'Нийтэлсэн хичээл олдсонгүй.');
    if (!lesson.freeLearning) {
      const samePath = await db.select({ id: s.lessons.id, lessonOrder: s.lessons.lessonOrder, createdAt: s.lessons.createdAt }).from(s.lessons)
        .where(and(eq(s.lessons.status, 'published'), lesson.chapterId ? eq(s.lessons.chapterId, lesson.chapterId) : eq(s.lessons.categoryId, lesson.categoryId))).orderBy(asc(s.lessons.lessonOrder), asc(s.lessons.createdAt), asc(s.lessons.id));
      const index = samePath.findIndex((item) => item.id === lessonId);
      const priorIds = samePath.slice(0, index).map((item) => item.id);
      if (priorIds.length) {
        const done = await db.select({ lessonId: s.lessonProgress.lessonId }).from(s.lessonProgress).where(and(eq(s.lessonProgress.userId, req.user!.id), inArray(s.lessonProgress.lessonId, priorIds)));
        if (done.length !== priorIds.length) return fail(res, 403, 'LESSON_LOCKED', 'Өмнөх хичээлийг дуусгасны дараа энэ онол нээгдэнэ.');
      }
    }
    const blocks = await db.select({ id: s.lessonContentBlocks.id, blockOrder: s.lessonContentBlocks.blockOrder, blockType: s.lessonContentBlocks.blockType, content: s.lessonContentBlocks.content, sourceDocument: s.lessonContentBlocks.sourceDocument, sourceRevision: s.lessonContentBlocks.sourceRevision, sourcePage: s.lessonContentBlocks.sourcePage, updatedAt: s.lessonContentBlocks.updatedAt })
      .from(s.lessonContentBlocks).where(and(eq(s.lessonContentBlocks.lessonId, lessonId), eq(s.lessonContentBlocks.reviewStatus, 'approved'))).orderBy(asc(s.lessonContentBlocks.blockOrder));
    const version = theoryContentVersion(blocks);
    const [saved] = await db.select().from(s.lessonTheoryProgress).where(and(eq(s.lessonTheoryProgress.userId, req.user!.id), eq(s.lessonTheoryProgress.lessonId, lessonId))).limit(1);
    const validProgress = saved?.contentVersion === version ? saved : null;
    const currentBlockOrder = Math.max(0, Math.min(validProgress?.currentBlockOrder ?? Math.max((validProgress?.maxViewedOrder ?? -1) + 1, 0), Math.max(blocks.length - 1, 0)));
    res.json({ lesson: { id: lesson.id, title: lesson.title }, theoryRequired: lesson.theoryRequired, ready: blocks.length > 0, contentVersion: version, blocks: blocks.map(({ updatedAt: _updatedAt, ...block }) => block), progress: { maxViewedOrder: validProgress?.maxViewedOrder ?? -1, currentBlockOrder, completed: !!validProgress?.completedAt } });
  } catch (error) { next(error); }
});

learningRouter.post('/lessons/:id/theory/progress', requireAuth, async (req, res, next) => {
  try {
    const parsed = z.object({ blockOrder: z.number().int().min(0), contentVersion: z.string().regex(/^[a-f0-9]{64}$/), direction: z.enum(['continue', 'previous']), completed: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Онолын ахицын мэдээллийг шалгана уу.');
    const lessonId = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [lesson] = await tx.select().from(s.lessons).where(and(eq(s.lessons.id, lessonId), eq(s.lessons.status, 'published'))).for('update').limit(1);
      if (!lesson) return { kind: 'missing' as const };
      const blocks = await tx.select({ id: s.lessonContentBlocks.id, blockOrder: s.lessonContentBlocks.blockOrder, blockType: s.lessonContentBlocks.blockType, content: s.lessonContentBlocks.content, updatedAt: s.lessonContentBlocks.updatedAt }).from(s.lessonContentBlocks).where(and(eq(s.lessonContentBlocks.lessonId, lessonId), eq(s.lessonContentBlocks.reviewStatus, 'approved'))).orderBy(asc(s.lessonContentBlocks.blockOrder));
      if (!blocks.length) return { kind: 'not_ready' as const };
      const version = theoryContentVersion(blocks);
      if (version !== parsed.data.contentVersion) return { kind: 'changed' as const };
      const [saved] = await tx.select().from(s.lessonTheoryProgress).where(and(eq(s.lessonTheoryProgress.userId, req.user!.id), eq(s.lessonTheoryProgress.lessonId, lessonId))).for('update').limit(1);
      const sameVersion = saved?.contentVersion === version;
      const maxViewedOrder = sameVersion ? saved.maxViewedOrder : -1;
      const currentBlockOrder = sameVersion ? saved.currentBlockOrder : 0;
      let nextMaxViewedOrder = maxViewedOrder;
      let nextBlockOrder = currentBlockOrder;
      let completedAt = sameVersion ? saved?.completedAt ?? null : null;
      if (parsed.data.direction === 'previous') {
        if (parsed.data.completed || parsed.data.blockOrder !== currentBlockOrder - 1 || parsed.data.blockOrder < 0) return { kind: 'sequence' as const };
        nextBlockOrder = parsed.data.blockOrder;
      } else {
        if (parsed.data.blockOrder !== currentBlockOrder) return { kind: 'sequence' as const };
        const step = advanceTheoryProgress(maxViewedOrder, parsed.data.blockOrder, blocks.length - 1, !!parsed.data.completed);
        if (!step.ok) return { kind: step.reason === 'sequence' ? 'sequence' as const : 'invalid' as const };
        nextMaxViewedOrder = step.maxViewedOrder;
        const reachedFinalBlock = parsed.data.blockOrder === blocks.length - 1;
        nextBlockOrder = reachedFinalBlock ? blocks.length - 1 : parsed.data.blockOrder + 1;
        if (step.completed) completedAt = saved?.completedAt ?? new Date();
      }
      await tx.insert(s.lessonTheoryProgress).values({ userId: req.user!.id, lessonId, contentVersion: version, maxViewedOrder: nextMaxViewedOrder, currentBlockOrder: nextBlockOrder, completedAt, updatedAt: new Date() }).onConflictDoUpdate({ target: [s.lessonTheoryProgress.userId, s.lessonTheoryProgress.lessonId], set: { contentVersion: version, maxViewedOrder: nextMaxViewedOrder, currentBlockOrder: nextBlockOrder, completedAt, updatedAt: new Date() } });
      return { kind: 'saved' as const, maxViewedOrder: nextMaxViewedOrder, currentBlockOrder: nextBlockOrder, completed: !!completedAt };
    });
    if (result.kind === 'missing') return fail(res, 404, 'LESSON_NOT_FOUND', 'Нийтэлсэн хичээл олдсонгүй.');
    if (result.kind === 'not_ready') return fail(res, 409, 'THEORY_NOT_READY', 'Баталгаажсан онолын агуулга хараахан алга.');
    if (result.kind === 'changed') return fail(res, 409, 'THEORY_CHANGED', 'Онолын агуулга шинэчлэгдсэн байна. Дахин ачаална уу.');
    if (result.kind === 'sequence') return fail(res, 409, 'THEORY_SEQUENCE', 'Өмнөх ойлголтыг үзсэний дараа үргэлжлүүлнэ үү.');
    if (result.kind === 'invalid') return fail(res, 400, 'VALIDATION', 'Онолын алхамын дугаар буруу байна.');
    res.json({ maxViewedOrder: result.maxViewedOrder, currentBlockOrder: result.currentBlockOrder, completed: result.completed, xpEarned: 0 });
  } catch (error) { next(error); }
});

learningRouter.post('/lessons/:id/start', requireAuth, async (req, res, next) => {
  try {
    const lessonId = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [lesson] = await tx.select().from(s.lessons).where(and(eq(s.lessons.id, lessonId), eq(s.lessons.status, 'published'))).for('update').limit(1);
      if (!lesson) return { kind: 'not_found' as const };
      if (lesson.theoryRequired) {
        const blocks = await tx.select({ id: s.lessonContentBlocks.id, blockOrder: s.lessonContentBlocks.blockOrder, blockType: s.lessonContentBlocks.blockType, content: s.lessonContentBlocks.content, updatedAt: s.lessonContentBlocks.updatedAt }).from(s.lessonContentBlocks).where(and(eq(s.lessonContentBlocks.lessonId, lessonId), eq(s.lessonContentBlocks.reviewStatus, 'approved'))).orderBy(asc(s.lessonContentBlocks.blockOrder));
        const [theoryProgress] = await tx.select().from(s.lessonTheoryProgress).where(and(eq(s.lessonTheoryProgress.userId, req.user!.id), eq(s.lessonTheoryProgress.lessonId, lessonId))).limit(1);
        if (!blocks.length) return { kind: 'theory_not_ready' as const };
        if (!theoryProgress || theoryProgress.contentVersion !== theoryContentVersion(blocks) || !theoryProgress.completedAt) return { kind: 'theory_required' as const };
      }
      const [placement] = await tx.select({ chapterId: s.lessons.chapterId, courseId: s.chapters.courseId, freeLearning: s.courses.freeLearningMode, coursePassPercentage: s.courses.defaultLessonPassPercentage }).from(s.lessons).leftJoin(s.chapters, eq(s.chapters.id, s.lessons.chapterId)).leftJoin(s.courses, eq(s.courses.id, s.chapters.courseId)).where(eq(s.lessons.id, lesson.id)).limit(1);
      const pathLessons = await tx.select({ id: s.lessons.id, lessonOrder: s.lessons.lessonOrder, createdAt: s.lessons.createdAt }).from(s.lessons)
        .where(and(eq(s.lessons.status, 'published'), placement?.chapterId ? eq(s.lessons.chapterId, placement.chapterId) : placement?.courseId ? eq(s.lessons.categoryId, lesson.categoryId) : eq(s.lessons.categoryId, lesson.categoryId))).orderBy(asc(s.lessons.lessonOrder), asc(s.lessons.createdAt), asc(s.lessons.id));
      const pathIndex = pathLessons.findIndex((item) => item.id === lesson.id);
      if (pathIndex < 0) return { kind: 'not_found' as const };
      const [alreadyCompleted]=await tx.select({id:s.lessonProgress.lessonId}).from(s.lessonProgress).where(and(eq(s.lessonProgress.userId,req.user!.id),eq(s.lessonProgress.lessonId,lesson.id))).limit(1);
      const priorIds = placement?.freeLearning||alreadyCompleted ? [] : pathLessons.slice(0, pathIndex).map((item) => item.id);
      if (priorIds.length) {
        const done = await tx.select({ lessonId: s.lessonProgress.lessonId }).from(s.lessonProgress)
          .where(and(eq(s.lessonProgress.userId, req.user!.id), inArray(s.lessonProgress.lessonId, priorIds)));
        if (done.length !== priorIds.length) return { kind: 'locked' as const };
      }
      const existing = await tx.select({ id: s.learningAttempts.id }).from(s.learningAttempts).where(and(eq(s.learningAttempts.userId, req.user!.id), eq(s.learningAttempts.lessonId, lesson.id), eq(s.learningAttempts.mode, 'lesson'), eq(s.learningAttempts.status, 'in_progress'))).orderBy(asc(s.learningAttempts.startedAt)).limit(1);
      if (existing.length) return { kind: 'resumed' as const, attemptId: existing[0].id };
      const linked = await tx.select({ questionId: s.questions.id, questionText: s.questions.questionText, questionType: s.questions.questionType, explanation: s.questions.explanation, xp: s.questions.xp, status: s.questions.status, sourceDocument: s.questions.sourceDocument, sourceRevision: s.questions.sourceRevision, sourceLocation: s.questions.sourceLocation })
        .from(s.lessonQuestions).innerJoin(s.questions, eq(s.questions.id, s.lessonQuestions.questionId))
        .where(eq(s.lessonQuestions.lessonId, lesson.id)).orderBy(asc(s.lessonQuestions.questionOrder));
      if (linked.length < 1 || linked.length > 100 || linked.some((question) => question.status !== 'published')) return { kind: 'not_ready' as const };
      const answerRows = await tx.select({ questionId: s.questionOptions.questionId, id: s.questionOptions.id, text: s.questionOptions.optionText })
        .from(s.questionOptions).where(inArray(s.questionOptions.questionId, linked.map((question) => question.questionId))).orderBy(asc(s.questionOptions.optionOrder));
      const correctRows = await tx.select({ questionId: s.questionCorrectOptions.questionId, optionId: s.questionCorrectOptions.optionId })
        .from(s.questionCorrectOptions).where(inArray(s.questionCorrectOptions.questionId, linked.map((question) => question.questionId)));
      const optionsByQuestion = new Map<string, { id: string; text: string }[]>();
      for (const option of answerRows) optionsByQuestion.set(option.questionId, [...(optionsByQuestion.get(option.questionId) ?? []), { id: option.id, text: option.text }]);
      const correctByQuestion = new Map<string, string[]>();
      for (const item of correctRows) correctByQuestion.set(item.questionId, [...(correctByQuestion.get(item.questionId) ?? []), item.optionId]);
      const incomplete = linked.some((question) => !optionsByQuestion.get(question.questionId)?.length || !correctByQuestion.get(question.questionId)?.length);
      if (incomplete) return { kind: 'not_ready' as const };
      const [attempt] = await tx.insert(s.learningAttempts).values({ userId: req.user!.id, lessonId: lesson.id, mode: 'lesson' }).returning({ id: s.learningAttempts.id });
      const snapshots = linked.map((question, questionOrder) => ({
        attemptId: attempt.id, questionId: question.questionId, questionOrder, xp: question.xp,
        snapshot: { text: question.questionText, type: question.questionType, options: optionsByQuestion.get(question.questionId)!, correctOptionIds: correctByQuestion.get(question.questionId)!, explanation: question.explanation, sourceDocument: question.sourceDocument, sourceRevision: question.sourceRevision, sourceLocation: question.sourceLocation },
      }));
      await tx.insert(s.learningAttemptQuestions).values(snapshots);
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'learning.lesson.started', entityType: 'learning_attempt', entityId: attempt.id, metadata: { lessonId: lesson.id, questionCount: linked.length } });
      return { kind: 'started' as const, attemptId: attempt.id };
    });
    if (result.kind === 'not_found') return fail(res, 404, 'LESSON_NOT_FOUND', 'Нийтэлсэн хичээл олдсонгүй.');
    if (result.kind === 'locked') return fail(res, 403, 'LESSON_LOCKED', 'Өмнөх хичээлийг амжилттай дуусгасны дараа энэ хичээл нээгдэнэ.');
    if (result.kind === 'not_ready') return fail(res, 409, 'LESSON_NOT_READY', 'Хичээл эхлэхийн тулд яг 10 нийтлэгдсэн, бүрэн асуулт шаардлагатай.');
    if (result.kind === 'theory_not_ready') return fail(res, 409, 'THEORY_NOT_READY', 'Хичээлийн онолын хэсгийг reviewer баталгаажуулсны дараа практик нээгдэнэ.');
    if (result.kind === 'theory_required') return fail(res, 409, 'THEORY_REQUIRED', 'Практик эхлэхийн өмнө баталгаажсан онолын хичээлийг дуустал үзнэ үү.');
    const pack = await makePathPack(result.attemptId, req.user!.id);
    if (!pack) return fail(res, 404, 'ATTEMPT_NOT_FOUND', 'Хичээлийн оролдлого олдсонгүй.');
    res.status(result.kind === 'resumed' ? 200 : 201).json({ ...pack, resumed: result.kind === 'resumed' });
  } catch (error) { next(error); }
});

learningRouter.get('/attempts/:id', requireAuth, async (req, res, next) => {
  try { const pack = await makePathPack(String(req.params.id), req.user!.id); if (!pack) return fail(res, 404, 'ATTEMPT_NOT_FOUND', 'Хичээлийн оролдлого олдсонгүй.'); res.json(pack); }
  catch (error) { next(error); }
});

learningRouter.post('/attempts/:id/answer', requireAuth, async (req, res, next) => {
  try {
    const input = z.object({ questionId: z.string().uuid(), optionIds: z.array(z.string().uuid()).min(1).max(8) }).safeParse(req.body);
    if (!input.success || new Set(input.data.optionIds).size !== input.data.optionIds.length) return fail(res, 400, 'VALIDATION', 'Асуултын хариултаа шалгана уу.');
    const result = await db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(s.learningAttempts).where(and(eq(s.learningAttempts.id, String(req.params.id)), eq(s.learningAttempts.userId, req.user!.id))).for('update').limit(1);
      if (!attempt) return { kind: 'not_found' as const };
      if (attempt.status !== 'in_progress') return { kind: 'closed' as const };
      const [item] = await tx.select().from(s.learningAttemptQuestions).where(and(eq(s.learningAttemptQuestions.attemptId, attempt.id), eq(s.learningAttemptQuestions.questionId, input.data.questionId))).limit(1);
      if (!item) return { kind: 'not_in_attempt' as const };
      const snapshot = item.snapshot as QuestionSnapshot;
      const [prior] = await tx.select().from(s.learningAttemptAnswers).where(and(eq(s.learningAttemptAnswers.attemptId, attempt.id), eq(s.learningAttemptAnswers.questionId, item.questionId))).limit(1);
      if (prior) return { kind: 'answered' as const, snapshot, prior };
      if (item.questionOrder !== attempt.currentQuestionOrder) return { kind: 'wrong_order' as const };
      const validIds = new Set(snapshot.options.map((option) => option.id));
      if (input.data.optionIds.some((optionId) => !validIds.has(optionId))) return { kind: 'invalid_options' as const };
      if (snapshot.type !== 'multiple_choice' && input.data.optionIds.length !== 1) return { kind: 'invalid_options' as const };
      const correct = answersMatch([...input.data.optionIds].sort(), [...snapshot.correctOptionIds].sort());
      const awardedXp = earnedLearningAnswerXp(attempt.mode, item.xp, correct);
      const [answer] = await tx.insert(s.learningAttemptAnswers).values({ attemptId: attempt.id, questionId: item.questionId, selectedOptionIds: input.data.optionIds, isCorrect: correct, awardedXp }).returning();
      await tx.update(s.learningAttempts).set({ currentQuestionOrder: attempt.currentQuestionOrder + 1, correctCount: attempt.correctCount + Number(correct) }).where(eq(s.learningAttempts.id, attempt.id));
      if (attempt.mode === 'lesson' && !correct) {
        const [open] = await tx.select({ id: s.questionReviewQueue.id }).from(s.questionReviewQueue).where(and(eq(s.questionReviewQueue.userId, req.user!.id), eq(s.questionReviewQueue.questionId, item.questionId), eq(s.questionReviewQueue.status, 'open'))).limit(1);
        if (open) await tx.update(s.questionReviewQueue).set({ missCount: sql`${s.questionReviewQueue.missCount} + 1`, lastMissedAt: new Date(), sourceAttemptId: attempt.id }).where(eq(s.questionReviewQueue.id, open.id));
        else await tx.insert(s.questionReviewQueue).values({ userId: req.user!.id, questionId: item.questionId, lessonId: attempt.lessonId, sourceAttemptId: attempt.id }).onConflictDoNothing();
      } else if (attempt.mode === 'review' && correct) {
        await tx.update(s.questionReviewQueue).set({ status: 'mastered', masteredAt: new Date(), reviewCount: sql`${s.questionReviewQueue.reviewCount} + 1` }).where(and(eq(s.questionReviewQueue.userId, req.user!.id), eq(s.questionReviewQueue.questionId, item.questionId), eq(s.questionReviewQueue.status, 'open')));
      } else if (attempt.mode === 'review') {
        await tx.update(s.questionReviewQueue).set({ reviewCount: sql`${s.questionReviewQueue.reviewCount} + 1`, lastMissedAt: new Date() }).where(and(eq(s.questionReviewQueue.userId, req.user!.id), eq(s.questionReviewQueue.questionId, item.questionId), eq(s.questionReviewQueue.status, 'open')));
      }
      return { kind: 'saved' as const, snapshot, answer };
    });
    if (result.kind === 'not_found') return fail(res, 404, 'ATTEMPT_NOT_FOUND', 'Хичээлийн оролдлого олдсонгүй.');
    if (result.kind === 'closed') return fail(res, 409, 'ATTEMPT_CLOSED', 'Энэ хичээлийн оролдлого дууссан байна.');
    if (result.kind === 'not_in_attempt') return fail(res, 400, 'QUESTION_NOT_IN_LESSON', 'Асуулт энэ хичээлийн оролдлогод байхгүй байна.');
    if (result.kind === 'wrong_order') return fail(res, 409, 'QUESTION_ORDER', 'Асуултуудыг дарааллаар нь бөглөнө үү.');
    if (result.kind === 'invalid_options') return fail(res, 400, 'INVALID_OPTIONS', 'Сонгосон хариултын сонголт буруу байна.');
    const answer = result.kind === 'answered' ? result.prior : result.answer;
    const snapshot = result.snapshot;
    res.json({ saved: true, ...buildLearningAnswerFeedback(snapshot, answer) });
  } catch (error) { next(error); }
});

learningRouter.post('/attempts/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const result = await db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(s.learningAttempts).where(and(eq(s.learningAttempts.id, String(req.params.id)), eq(s.learningAttempts.userId, req.user!.id))).for('update').limit(1);
      if (!attempt) return { kind: 'not_found' as const };
      if (attempt.status !== 'in_progress') return { kind: 'closed' as const };
      const questionRows = await tx.select({ questionId: s.learningAttemptQuestions.questionId, xp: s.learningAttemptQuestions.xp }).from(s.learningAttemptQuestions).where(eq(s.learningAttemptQuestions.attemptId, attempt.id));
      const answers = await tx.select().from(s.learningAttemptAnswers).where(eq(s.learningAttemptAnswers.attemptId, attempt.id));
      if (!questionRows.length || answers.length !== questionRows.length) return { kind: 'incomplete' as const };
      const correctCount = answers.filter((answer) => answer.isCorrect).length;
      const accuracy = Math.round(correctCount / questionRows.length * 10000) / 100;
      const [lesson] = await tx.select({ passPercentage: s.lessons.passPercentage, courseThreshold: s.courses.defaultLessonPassPercentage, chapterQuizThreshold: s.courses.chapterQuizPassPercentage, completionXp: s.lessons.completionXp, passXp: s.lessons.passXp, perfectXp: s.lessons.perfectXp, chapterId: s.lessons.chapterId, courseCompletionXp: s.courses.lessonCompletionXp, coursePassXp: s.courses.lessonPassXp, coursePerfectXp: s.courses.perfectPracticeXp }).from(s.lessons).leftJoin(s.chapters, eq(s.chapters.id, s.lessons.chapterId)).leftJoin(s.courses, eq(s.courses.id, s.chapters.courseId)).where(eq(s.lessons.id, attempt.lessonId)).limit(1);
      const threshold = lesson?.courseThreshold ?? lesson?.passPercentage ?? 80;
      const passed = attempt.mode === 'lesson' && lessonPasses(correctCount, questionRows.length, threshold);
      let xpEarned = 0;
      if (passed) {
        const [alreadyCompleted] = await tx.select({ lessonId: s.lessonProgress.lessonId }).from(s.lessonProgress)
          .where(and(eq(s.lessonProgress.userId, req.user!.id), eq(s.lessonProgress.lessonId, attempt.lessonId))).limit(1);
        if (!alreadyCompleted) {
          const questionXp = questionRows.reduce((sum, question) => sum + (answers.find((answer) => answer.questionId === question.questionId)?.isCorrect ? question.xp : 0), 0);
          const baseXp = lessonXpReward({ questionXp, passed: true, perfect: correctCount === questionRows.length, completionXp: lesson?.courseCompletionXp ?? lesson?.completionXp ?? 10, passXp: lesson?.coursePassXp ?? lesson?.passXp ?? 15, perfectXp: lesson?.coursePerfectXp ?? lesson?.perfectXp ?? 10 });
          const [grant] = await tx.insert(s.lessonProgress).values({ userId: req.user!.id, lessonId: attempt.lessonId, xpEarned: baseXp, correctCount, accuracy }).onConflictDoNothing().returning({ userId: s.lessonProgress.userId });
          if (grant) {
            const [ledger] = baseXp > 0 ? await tx.insert(s.xpTransactions).values({ userId: req.user!.id, sourceKey: `lesson_complete:${attempt.lessonId}`, sourceType: 'lesson_completion', amount: baseXp, lessonId: attempt.lessonId, chapterId: lesson?.chapterId ?? null, metadata: { attemptId: attempt.id, correctCount, questionCount: questionRows.length } }).onConflictDoNothing().returning({ id: s.xpTransactions.id }) : [null];
            if (ledger) xpEarned = baseXp;
            const [user] = await tx.select({ timezone: s.users.timezone }).from(s.users).where(eq(s.users.id, req.user!.id)).limit(1);
            const activityDate = localActivityDate(new Date(), user?.timezone ?? 'Asia/Ulaanbaatar');
            await tx.insert(s.learningActivityDays).values({ userId: req.user!.id, activityDate: activityDate as `${number}-${number}-${number}`, activityCount: 1, xpEarned }).onConflictDoUpdate({ target: [s.learningActivityDays.userId, s.learningActivityDays.activityDate], set: { activityCount: sql`${s.learningActivityDays.activityCount} + 1`, xpEarned: sql`${s.learningActivityDays.xpEarned} + ${xpEarned}`, updatedAt: new Date() } });
            const completed = await tx.select({ lessonId: s.lessonProgress.lessonId, accuracy: s.lessonProgress.accuracy }).from(s.lessonProgress).where(eq(s.lessonProgress.userId, req.user!.id));
            const streakRows = await tx.select({ activityDate: s.learningActivityDays.activityDate }).from(s.learningActivityDays).where(and(eq(s.learningActivityDays.userId, req.user!.id), sql`${s.learningActivityDays.activityDate} <= ${activityDate}`)).orderBy(desc(s.learningActivityDays.activityDate)).limit(366);
            const completedIds = new Set(completed.map((item) => item.lessonId)); completedIds.add(attempt.lessonId);
            let chapterComplete = false;
            if (lesson?.chapterId) {
              const chapterLessons = await tx.select({ id: s.lessons.id }).from(s.lessons).where(and(eq(s.lessons.chapterId, lesson.chapterId), eq(s.lessons.status, 'published')));
              const chapterQuizzes = await tx.select({ id: s.quizzes.id }).from(s.quizzes).where(and(eq(s.quizzes.chapterId, lesson.chapterId), eq(s.quizzes.status, 'published')));
              const passedQuizRows = chapterQuizzes.length ? await tx.select({ quizId: s.quizAttempts.quizId, accuracy: s.quizAttempts.accuracy }).from(s.quizAttempts).where(and(eq(s.quizAttempts.userId, req.user!.id), inArray(s.quizAttempts.quizId, chapterQuizzes.map((item) => item.id)), eq(s.quizAttempts.status, 'submitted'))) : [];
              chapterComplete = chapterLessons.length > 0 && chapterLessons.every((item) => completedIds.has(item.id)) && chapterQuizzes.every((quiz) => passedQuizRows.some((attempt) => attempt.quizId === quiz.id && attempt.accuracy >= (lesson.chapterQuizThreshold ?? 70)));
            }
            const milestones = achievedMilestones({ lessonCount: completedIds.size, perfectLessonCount: completed.filter((item) => item.accuracy === 100).length, streak: currentLearningStreak(streakRows.map((item) => item.activityDate), activityDate), chapterComplete, courseComplete: false });
            const badgeRows = milestones.length ? await tx.select().from(s.achievements).where(and(inArray(s.achievements.code, milestones), eq(s.achievements.isActive, true))) : [];
            for (const badge of badgeRows) {
              const [earned] = await tx.insert(s.userAchievements).values({ userId: req.user!.id, achievementId: badge.id, metadata: { attemptId: attempt.id } }).onConflictDoNothing().returning({ achievementId: s.userAchievements.achievementId });
              if (earned && badge.xpReward > 0) { const [reward] = await tx.insert(s.xpTransactions).values({ userId: req.user!.id, sourceKey: `achievement:${badge.code}`, sourceType: 'achievement', amount: badge.xpReward, lessonId: attempt.lessonId, metadata: { attemptId: attempt.id } }).onConflictDoNothing().returning({ id: s.xpTransactions.id }); if (reward) { xpEarned += badge.xpReward; await tx.update(s.learningActivityDays).set({ xpEarned: sql`${s.learningActivityDays.xpEarned} + ${badge.xpReward}`, updatedAt: new Date() }).where(and(eq(s.learningActivityDays.userId, req.user!.id), eq(s.learningActivityDays.activityDate, activityDate as `${number}-${number}-${number}`))); } }
            }
          }
        }
      }
      const status = attempt.mode === 'review' ? 'review_completed' : passed ? 'passed' : 'failed';
      await tx.update(s.learningAttempts).set({ status, completedAt: new Date(), correctCount, earnedXp: xpEarned }).where(eq(s.learningAttempts.id, attempt.id));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'learning.lesson.completed', entityType: 'learning_attempt', entityId: attempt.id, metadata: { lessonId: attempt.lessonId, mode: attempt.mode, correctCount, questionCount: questionRows.length, accuracy, passed, xpEarned } });
      return { kind: 'completed' as const, lessonId: attempt.lessonId, mode: attempt.mode, correctCount, questionCount: questionRows.length, accuracy, passed, xpEarned };
    });
    if (result.kind === 'not_found') return fail(res, 404, 'ATTEMPT_NOT_FOUND', 'Хичээлийн оролдлого олдсонгүй.');
    if (result.kind === 'closed') return fail(res, 409, 'ATTEMPT_CLOSED', 'Энэ хичээлийн оролдлого дууссан байна.');
    if (result.kind === 'incomplete') return fail(res, 409, 'ATTEMPT_INCOMPLETE', 'Хичээлийн бүх асуултад хариулсны дараа дуусгана.');
    const [lesson] = result.mode === 'lesson' ? await db.select({ passPercentage: s.lessons.passPercentage, courseThreshold: s.courses.defaultLessonPassPercentage }).from(s.lessons).leftJoin(s.chapters, eq(s.chapters.id, s.lessons.chapterId)).leftJoin(s.courses, eq(s.courses.id, s.chapters.courseId)).where(eq(s.lessons.id, result.lessonId)).limit(1) : [];
    const items = result.mode === 'lesson' ? await db.select({ id: s.lessons.id, lessonOrder: s.lessons.lessonOrder }).from(s.lessons).where(and(eq(s.lessons.status, 'published'), sql`${s.lessons.lessonOrder} > (select lesson_order from lessons where id=${result.lessonId})`)).orderBy(asc(s.lessons.lessonOrder)).limit(1) : [];
    res.json({ ...result, threshold: lesson?.courseThreshold ?? lesson?.passPercentage ?? 80, nextLessonId: result.passed ? items[0]?.id ?? null : null });
  } catch (error) { next(error); }
});

learningRouter.post('/attempts/:id/review', requireAuth, async (req, res, next) => {
  try {
    const result = await db.transaction(async (tx) => {
      const [attempt] = await tx.select().from(s.learningAttempts).where(and(eq(s.learningAttempts.id, String(req.params.id)), eq(s.learningAttempts.userId, req.user!.id))).for('update').limit(1);
      if (!attempt) return { kind: 'not_found' as const };
      if (attempt.status !== 'failed' || attempt.mode !== 'lesson') return { kind: 'not_reviewable' as const };
      const wrongIds = await tx.select({ questionId: s.learningAttemptAnswers.questionId }).from(s.learningAttemptAnswers)
        .where(and(eq(s.learningAttemptAnswers.attemptId, attempt.id), eq(s.learningAttemptAnswers.isCorrect, false)));
      if (!wrongIds.length) return { kind: 'none' as const };
      const oldSnapshots = await tx.select().from(s.learningAttemptQuestions)
        .where(and(eq(s.learningAttemptQuestions.attemptId, attempt.id), inArray(s.learningAttemptQuestions.questionId, wrongIds.map((item) => item.questionId))))
        .orderBy(asc(s.learningAttemptQuestions.questionOrder));
      const [review] = await tx.insert(s.learningAttempts).values({ userId: req.user!.id, lessonId: attempt.lessonId, mode: 'review' }).returning({ id: s.learningAttempts.id });
      await tx.insert(s.learningAttemptQuestions).values(oldSnapshots.map((item, questionOrder) => ({ attemptId: review.id, questionId: item.questionId, questionOrder, xp: item.xp, snapshot: item.snapshot })));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'learning.lesson.review_started', entityType: 'learning_attempt', entityId: review.id, metadata: { lessonId: attempt.lessonId, sourceAttemptId: attempt.id, questionCount: oldSnapshots.length } });
      return { kind: 'created' as const, attemptId: review.id };
    });
    if (result.kind === 'not_found') return fail(res, 404, 'ATTEMPT_NOT_FOUND', 'Хичээлийн оролдлого олдсонгүй.');
    if (result.kind === 'not_reviewable') return fail(res, 409, 'REVIEW_NOT_AVAILABLE', 'Зөвхөн тэнцээгүй хичээлийн алдсан асуултыг давтаж болно.');
    if (result.kind === 'none') return fail(res, 409, 'NO_MISSED_QUESTIONS', 'Давтах алдсан асуулт алга байна.');
    res.status(201).json({ attemptId: result.attemptId });
  } catch (error) { next(error); }
});

learningRouter.get('/admin/progress', requireAuth, requireRoles('admin', 'training_manager'), async (_req, res, next) => {
  try {
    const rows = await db.select({ userId: s.users.id, username: s.users.username, fullName: s.users.fullName, lessonId: s.lessonProgress.lessonId, lessonTitle: s.lessons.title, lessonOrder: s.lessons.lessonOrder, completedAt: s.lessonProgress.completedAt, xpEarned: s.lessonProgress.xpEarned, correctCount: s.lessonProgress.correctCount, accuracy: s.lessonProgress.accuracy })
      .from(s.users).leftJoin(s.lessonProgress, eq(s.lessonProgress.userId, s.users.id)).leftJoin(s.lessons, eq(s.lessons.id, s.lessonProgress.lessonId))
      .orderBy(asc(s.users.fullName), asc(s.lessons.lessonOrder));
    const grouped = new Map<string, { userId: string; username: string; fullName: string; xp: number; lessonsCompleted: number; lessons: unknown[] }>();
    for (const row of rows) {
      const item = grouped.get(row.userId) ?? { userId: row.userId, username: row.username, fullName: row.fullName, xp: 0, lessonsCompleted: 0, lessons: [] };
      if (row.lessonId) { item.xp += row.xpEarned ?? 0; item.lessonsCompleted++; item.lessons.push({ lessonId: row.lessonId, title: row.lessonTitle, lessonOrder: row.lessonOrder, completedAt: row.completedAt, xpEarned: row.xpEarned, correctCount: row.correctCount, accuracy: row.accuracy }); }
      grouped.set(row.userId, item);
    }
    res.json({ items: [...grouped.values()] });
  } catch (error) { next(error); }
});
