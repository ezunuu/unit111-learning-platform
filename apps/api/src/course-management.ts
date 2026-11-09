import { Router } from 'express';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db.js';
import * as s from './schema.js';
import { requireAuth, requireRoles } from './auth.js';

export const courseManagementRouter = Router();
const fail = (res: import('express').Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
const statusSchema = z.enum(['draft', 'published', 'archived']);
async function isActiveLeafSubject(id:string){const [subject]=await db.select({id:s.learningSubjects.id}).from(s.learningSubjects).where(and(eq(s.learningSubjects.id,id),eq(s.learningSubjects.isActive,true)));if(!subject)return false;const [child]=await db.select({id:s.learningSubjects.id}).from(s.learningSubjects).where(and(eq(s.learningSubjects.parentId,id),eq(s.learningSubjects.isActive,true))).limit(1);return !child;}
const courseInput = z.object({
  subjectId:z.string().uuid(), title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).default(''), status: statusSchema.default('draft'), courseOrder: z.number().int().min(0).max(10000).default(0),
  freeLearningMode: z.boolean().default(false), defaultLessonPassPercentage: z.number().int().min(0).max(100).default(80), chapterQuizPassPercentage: z.number().int().min(0).max(100).default(70),
  lessonCompletionXp: z.number().int().min(0).max(10000).default(10), lessonPassXp: z.number().int().min(0).max(10000).default(15), perfectPracticeXp: z.number().int().min(0).max(10000).default(10), chapterQuizXp: z.number().int().min(0).max(10000).default(30),
});
const chapterInput = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).default(''), status: statusSchema.default('draft'), chapterOrder: z.number().int().min(0).max(10000).default(0), requiredLessonsCompleted: z.boolean().default(true) });
const sourceFields = { sourceDocument: z.string().trim().max(500).nullable().optional(), sourceRevision: z.string().trim().max(200).nullable().optional(), sourcePage: z.string().trim().max(120).nullable().optional() };
const blockInput = z.discriminatedUnion('blockType', [
  z.object({ blockType: z.literal('text'), content: z.object({ text: z.string().trim().min(1).max(12000) }), ...sourceFields }),
  z.object({ blockType: z.literal('image'), content: z.object({ url: z.string().trim().max(2000).refine((value) => value.startsWith('/media/') || value.startsWith('https://'), 'Зураг HTTPS эсвэл /media/ замтай байна.'), caption: z.string().trim().max(500).default('') }), ...sourceFields }),
  z.object({ blockType: z.literal('key_concept'), content: z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(4000) }), ...sourceFields }),
  z.object({ blockType: z.literal('terminology'), content: z.object({ term: z.string().trim().min(1).max(200), definition: z.string().trim().min(1).max(2000) }), ...sourceFields }),
  z.object({ blockType: z.literal('technical_specification'), content: z.object({ label: z.string().trim().min(1).max(200), value: z.string().trim().min(1).max(500), unit: z.string().trim().max(80).optional(), note: z.string().trim().max(1000).optional() }), ...sourceFields }),
  z.object({ blockType: z.literal('knowledge_check'), content: z.object({ questionId: z.string().uuid() }), ...sourceFields }),
  z.object({ blockType: z.literal('summary'), content: z.object({ items: z.array(z.string().trim().min(1).max(1000)).min(1).max(20) }), ...sourceFields }),
]);
const blocksInput = z.array(blockInput).max(100);

async function lessonIsReadyToPublish(tx: any, lessonId: string) {
  const links = await tx.select({ status: s.questions.status }).from(s.lessonQuestions).innerJoin(s.questions, eq(s.questions.id, s.lessonQuestions.questionId)).where(eq(s.lessonQuestions.lessonId, lessonId));
  if (!links.length || links.some((link: { status: string }) => link.status !== 'published')) return false;
  const blocks = await tx.select({ reviewStatus: s.lessonContentBlocks.reviewStatus }).from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, lessonId));
  const [lesson] = await tx.select({ theoryRequired: s.lessons.theoryRequired }).from(s.lessons).where(eq(s.lessons.id, lessonId)).limit(1);
  if (lesson?.theoryRequired && (!blocks.length || blocks.some((block: { reviewStatus: string }) => block.reviewStatus !== 'approved'))) return false;
  return blocks.every((block: { reviewStatus: string }) => block.reviewStatus === 'approved');
}

courseManagementRouter.get('/admin/courses', requireAuth, requireRoles('admin', 'training_manager'), async (_req, res, next) => {
  try {
    const courses = await db.select().from(s.courses).orderBy(asc(s.courses.courseOrder), asc(s.courses.title));
    const chapters = courses.length ? await db.select().from(s.chapters).where(inArray(s.chapters.courseId, courses.map((course) => course.id))).orderBy(asc(s.chapters.chapterOrder)) : [];
    const lessons = chapters.length ? await db.select({ id: s.lessons.id, title: s.lessons.title, description: s.lessons.description, chapterId: s.lessons.chapterId, status: s.lessons.status, theoryRequired: s.lessons.theoryRequired, lessonOrder: s.lessons.lessonOrder, passPercentage: s.lessons.passPercentage, estimatedMinutes: s.lessons.estimatedMinutes }).from(s.lessons).where(inArray(s.lessons.chapterId, chapters.map((chapter) => chapter.id))).orderBy(asc(s.lessons.lessonOrder)) : [];
    const quizRows = chapters.length ? await db.select({ id: s.quizzes.id, title: s.quizzes.title, chapterId: s.quizzes.chapterId, status: s.quizzes.status, questionCount: s.quizzes.questionCount, passingPercentage: s.quizzes.passingPercentage }).from(s.quizzes).where(inArray(s.quizzes.chapterId, chapters.map((chapter) => chapter.id))) : [];
    res.json({ items: courses.map((course) => ({ ...course, chapters: chapters.filter((chapter) => chapter.courseId === course.id).map((chapter) => ({ ...chapter, lessons: lessons.filter((lesson) => lesson.chapterId === chapter.id), finalQuiz: quizRows.find((quiz) => quiz.chapterId === chapter.id) ?? null })) })) });
  } catch (error) { next(error); }
});

courseManagementRouter.get('/admin/course-builder/lessons', requireAuth, requireRoles('admin', 'training_manager'), async (_req, res, next) => {
  try {
    const lessons = await db.select({ id: s.lessons.id, title: s.lessons.title, description: s.lessons.description, chapterId: s.lessons.chapterId, status: s.lessons.status, lessonOrder: s.lessons.lessonOrder, passPercentage: s.lessons.passPercentage, estimatedMinutes: s.lessons.estimatedMinutes }).from(s.lessons).orderBy(asc(s.lessons.lessonOrder), asc(s.lessons.title));
    const quizzes = await db.select({ id: s.quizzes.id, title: s.quizzes.title, status: s.quizzes.status, chapterId: s.quizzes.chapterId, lessonId: s.quizzes.lessonId, quizType: s.quizzes.quizType }).from(s.quizzes).where(isNull(s.quizzes.lessonId));
    const questions = await db.select({ id: s.questions.id, questionText: s.questions.questionText }).from(s.questions).where(eq(s.questions.status, 'published')).orderBy(asc(s.questions.createdAt));
    res.json({ lessons, quizzes, questions });
  } catch (error) { next(error); }
});

courseManagementRouter.post('/admin/courses', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const p = courseInput.safeParse(req.body); if (!p.success) return fail(res, 400, 'VALIDATION', 'Сургалтын хөтөлбөрийн талбаруудыг шалгана уу.');
    if(p.data.subjectId&&!await isActiveLeafSubject(p.data.subjectId))return fail(res,400,'VALIDATION','Хөтөлбөрт идэвхтэй дэд ангилал сонгоно уу.');
    const [course] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(s.courses).values({ ...p.data, createdBy: req.user!.id }).returning();
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'course.created', entityType: 'course', entityId: created.id, metadata: { status: created.status } });
      return [created];
    });
    res.status(201).json({ course });
  } catch (error) { next(error); }
});

courseManagementRouter.put('/admin/courses/:id', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const p = courseInput.safeParse(req.body); if (!p.success) return fail(res, 400, 'VALIDATION', 'Сургалтын хөтөлбөрийн талбаруудыг шалгана уу.');
    if(p.data.subjectId&&!await isActiveLeafSubject(p.data.subjectId))return fail(res,400,'VALIDATION','Хөтөлбөрт идэвхтэй дэд ангилал сонгоно уу.');
    const id = String(req.params.id);
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: s.courses.id }).from(s.courses).where(eq(s.courses.id, id)).for('update').limit(1);
      if (!existing) return null;
      if (p.data.status === 'published') {
        if (req.user!.role !== 'admin') return 'publisher_required' as const;
        const chapters = await tx.select({ id: s.chapters.id, status: s.chapters.status }).from(s.chapters).where(eq(s.chapters.courseId, id));
        const publishedChapters = chapters.filter((chapter: { status: string }) => chapter.status === 'published');
        if (!publishedChapters.length) return 'course_not_ready' as const;
        for (const chapter of publishedChapters) {
          const lessons = await tx.select({ id: s.lessons.id }).from(s.lessons).where(and(eq(s.lessons.chapterId, chapter.id), eq(s.lessons.status, 'published')));
          if (!lessons.length) return 'course_not_ready' as const;
          for (const lesson of lessons) if (!(await lessonIsReadyToPublish(tx, lesson.id))) return 'course_not_ready' as const;
        }
      }
      const [row] = await tx.update(s.courses).set({ ...p.data, updatedAt: new Date() }).where(eq(s.courses.id, id)).returning();
      if (row) await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'course.updated', entityType: 'course', entityId: id, metadata: { status: row.status, freeLearningMode: row.freeLearningMode } });
      return row;
    });
    if (updated === 'publisher_required') return fail(res, 403, 'PUBLISHER_REQUIRED', 'Зөвхөн нийтлэх эрхтэй администратор сургалтын хөтөлбөр нийтэлнэ.');
    if (updated === 'course_not_ready') return fail(res, 409, 'COURSE_NOT_READY', 'Хөтөлбөр нийтлэхийн өмнө нийтэлсэн бүлэг, хичээл, хянагдсан агуулга болон нийтлэгдсэн асуултыг шалгана уу.');
    if (!updated) return fail(res, 404, 'NOT_FOUND', 'Сургалтын хөтөлбөр олдсонгүй.');
    res.json({ course: updated });
  } catch (error) { next(error); }
});

courseManagementRouter.post('/admin/courses/:courseId/chapters', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const p = chapterInput.safeParse(req.body); if (!p.success) return fail(res, 400, 'VALIDATION', 'Бүлгийн мэдээллийг шалгана уу.');
    const courseId = String(req.params.courseId);
    const [chapter] = await db.transaction(async (tx) => {
      const [course] = await tx.select({ id: s.courses.id }).from(s.courses).where(eq(s.courses.id, courseId)).for('update').limit(1);
      if (!course) return [null];
      const [created] = await tx.insert(s.chapters).values({ ...p.data, courseId }).returning();
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'chapter.created', entityType: 'chapter', entityId: created.id, metadata: { courseId } });
      return [created];
    });
    if (!chapter) return fail(res, 404, 'NOT_FOUND', 'Сургалтын хөтөлбөр олдсонгүй.');
    res.status(201).json({ chapter });
  } catch (error) { next(error); }
});

courseManagementRouter.put('/admin/chapters/:id', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const p = chapterInput.safeParse(req.body); if (!p.success) return fail(res, 400, 'VALIDATION', 'Бүлгийн мэдээллийг шалгана уу.');
    const id = String(req.params.id);
    const chapter = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: s.chapters.id }).from(s.chapters).where(eq(s.chapters.id, id)).for('update').limit(1);
      if (!existing) return null;
      if (p.data.status === 'published') {
        if (req.user!.role !== 'admin') return 'publisher_required' as const;
        const lessons = await tx.select({ id: s.lessons.id }).from(s.lessons).where(and(eq(s.lessons.chapterId, id), eq(s.lessons.status, 'published')));
        if (!lessons.length) return 'chapter_not_ready' as const;
        for (const lesson of lessons) if (!(await lessonIsReadyToPublish(tx, lesson.id))) return 'chapter_not_ready' as const;
      }
      const [row] = await tx.update(s.chapters).set({ ...p.data, updatedAt: new Date() }).where(eq(s.chapters.id, id)).returning();
      if (row) await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'chapter.updated', entityType: 'chapter', entityId: id, metadata: { status: row.status, chapterOrder: row.chapterOrder } });
      return row;
    });
    if (chapter === 'publisher_required') return fail(res, 403, 'PUBLISHER_REQUIRED', 'Зөвхөн нийтлэх эрхтэй администратор бүлгийг нийтэлнэ.');
    if (chapter === 'chapter_not_ready') return fail(res, 409, 'CHAPTER_NOT_READY', 'Бүлэг нийтлэхийн өмнө нийтэлсэн, нийтлэгдсэн асуулттай хичээлийг шалгана уу.');
    if (!chapter) return fail(res, 404, 'NOT_FOUND', 'Бүлэг олдсонгүй.');
    res.json({ chapter });
  } catch (error) { next(error); }
});

courseManagementRouter.post('/admin/chapters/:id/move', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const parsed = z.object({ direction: z.enum(['up', 'down']) }).safeParse(req.body); if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Шилжүүлэх чиглэлийг сонгоно уу.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(s.chapters).where(eq(s.chapters.id, id)).for('update').limit(1); if (!current) return null;
      const siblings = await tx.select().from(s.chapters).where(eq(s.chapters.courseId, current.courseId)).orderBy(asc(s.chapters.chapterOrder));
      const index = siblings.findIndex((chapter) => chapter.id === id), target = siblings[index + (parsed.data.direction === 'up' ? -1 : 1)]; if (!target) return current;
      await tx.update(s.chapters).set({ chapterOrder: 10001, updatedAt: new Date() }).where(eq(s.chapters.id, current.id));
      await tx.update(s.chapters).set({ chapterOrder: current.chapterOrder, updatedAt: new Date() }).where(eq(s.chapters.id, target.id));
      const [updated] = await tx.update(s.chapters).set({ chapterOrder: target.chapterOrder, updatedAt: new Date() }).where(eq(s.chapters.id, current.id)).returning();
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'chapter.reordered', entityType: 'chapter', entityId: id, metadata: { direction: parsed.data.direction, swappedWith: target.id } });
      return updated;
    });
    if (!result) return fail(res, 404, 'NOT_FOUND', 'Бүлэг олдсонгүй.');
    res.json({ chapter: result });
  } catch (error) { next(error); }
});

courseManagementRouter.post('/admin/lessons/:id/move', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const parsed = z.object({ direction: z.enum(['up', 'down']) }).safeParse(req.body); if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Шилжүүлэх чиглэлийг сонгоно уу.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(s.lessons).where(eq(s.lessons.id, id)).for('update').limit(1); if (!current) return null;
      const siblings = await tx.select().from(s.lessons).where(current.chapterId ? eq(s.lessons.chapterId, current.chapterId) : and(isNull(s.lessons.chapterId), eq(s.lessons.categoryId, current.categoryId))).orderBy(asc(s.lessons.lessonOrder), asc(s.lessons.title));
      const index = siblings.findIndex((lesson) => lesson.id === id), target = siblings[index + (parsed.data.direction === 'up' ? -1 : 1)]; if (!target) return current;
      await tx.update(s.lessons).set({ lessonOrder: target.lessonOrder, updatedAt: new Date() }).where(eq(s.lessons.id, current.id));
      const [updated] = await tx.update(s.lessons).set({ lessonOrder: current.lessonOrder, updatedAt: new Date() }).where(eq(s.lessons.id, target.id)).returning();
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'lesson.reordered', entityType: 'lesson', entityId: id, metadata: { direction: parsed.data.direction, swappedWith: target.id } });
      return updated;
    });
    if (!result) return fail(res, 404, 'NOT_FOUND', 'Хичээл олдсонгүй.');
    res.json({ lesson: result });
  } catch (error) { next(error); }
});

courseManagementRouter.put('/admin/lessons/:id/placement', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const p = z.object({ chapterId: z.string().uuid().nullable(), lessonOrder: z.number().int().min(0).max(10000), passPercentage: z.number().int().min(0).max(100).optional(), estimatedMinutes: z.number().int().min(1).max(600).optional(), learningObjectives: z.array(z.string().trim().min(1).max(500)).max(20).optional() }).safeParse(req.body);
    if (!p.success) return fail(res, 400, 'VALIDATION', 'Хичээлийн дараалал болон completion тохиргоог шалгана уу.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [lesson] = await tx.select().from(s.lessons).where(eq(s.lessons.id, id)).for('update').limit(1); if (!lesson) return null;
      if (p.data.chapterId) { const [chapter] = await tx.select({ id: s.chapters.id, courseId: s.chapters.courseId }).from(s.chapters).where(eq(s.chapters.id, p.data.chapterId)).limit(1); if (!chapter) return 'chapter_missing'; }
      const [updated] = await tx.update(s.lessons).set({ chapterId: p.data.chapterId, lessonOrder: p.data.lessonOrder, ...(p.data.passPercentage !== undefined ? { passPercentage: p.data.passPercentage } : {}), ...(p.data.estimatedMinutes !== undefined ? { estimatedMinutes: p.data.estimatedMinutes } : {}), ...(p.data.learningObjectives !== undefined ? { learningObjectives: p.data.learningObjectives } : {}), updatedAt: new Date() }).where(eq(s.lessons.id, id)).returning();
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'lesson.placement_updated', entityType: 'lesson', entityId: id, metadata: { previousChapterId: lesson.chapterId, chapterId: updated.chapterId, lessonOrder: updated.lessonOrder } });
      return updated;
    });
    if (!result) return fail(res, 404, 'NOT_FOUND', 'Хичээл олдсонгүй.');
    if (result === 'chapter_missing') return fail(res, 404, 'CHAPTER_NOT_FOUND', 'Сонгосон бүлэг олдсонгүй.');
    res.json({ lesson: result });
  } catch (error) { next(error); }
});

courseManagementRouter.put('/admin/chapters/:id/final-quiz', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const p = z.object({ quizId: z.string().uuid().nullable() }).safeParse(req.body); if (!p.success) return fail(res, 400, 'VALIDATION', 'Сорилын ID буруу байна.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [chapter] = await tx.select().from(s.chapters).where(eq(s.chapters.id, id)).for('update').limit(1); if (!chapter) return 'chapter_missing' as const;
      if (p.data.quizId) {
        const [quiz] = await tx.select().from(s.quizzes).where(eq(s.quizzes.id, p.data.quizId)).for('update').limit(1);
        if (!quiz) return 'quiz_missing' as const;
        if (quiz.chapterId && quiz.chapterId !== id) return 'quiz_in_use' as const;
        if (quiz.lessonId) return 'training_quiz' as const;
        if (quiz.status === 'published') {
          const linked = await tx.select({ id: s.questions.id }).from(s.quizQuestions).innerJoin(s.questions, eq(s.questions.id, s.quizQuestions.questionId)).where(and(eq(s.quizQuestions.quizId, quiz.id), eq(s.questions.status, 'published')));
          if (linked.length !== quiz.questionCount || linked.length === 0) return 'quiz_not_ready' as const;
        }
        await tx.update(s.quizzes).set({ chapterId: id, updatedAt: new Date() }).where(eq(s.quizzes.id, quiz.id));
      }
      if (p.data.quizId === null) await tx.update(s.quizzes).set({ chapterId: null, updatedAt: new Date() }).where(eq(s.quizzes.chapterId, id));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'chapter.final_quiz_linked', entityType: 'chapter', entityId: id, metadata: { quizId: p.data.quizId } });
      return 'linked' as const;
    });
    if (result === 'chapter_missing') return fail(res, 404, 'NOT_FOUND', 'Бүлэг олдсонгүй.');
    if (result === 'quiz_missing') return fail(res, 404, 'NOT_FOUND', 'Сорил олдсонгүй.');
    if (result === 'quiz_in_use') return fail(res, 409, 'QUIZ_IN_USE', 'Энэ сорил өөр бүлэгт аль хэдийн холбогдсон байна.');
    if (result === 'training_quiz') return fail(res, 409, 'TRAINING_QUIZ', 'Хичээлийн сургалтын сорилыг бүлгийн эцсийн сорил болгон холбохгүй.');
    if (result === 'quiz_not_ready') return fail(res, 409, 'QUIZ_NOT_READY', 'Нийтлэх сорил бүрэн нийтлэгдсэн асуулттай байх шаардлагатай.');
    res.json({ status: 'linked', quizId: p.data.quizId });
  } catch (error) { next(error); }
});

courseManagementRouter.get('/admin/lessons/:id/content-blocks', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try { res.json({ items: await db.select().from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, String(req.params.id))).orderBy(asc(s.lessonContentBlocks.blockOrder)) }); }
  catch (error) { next(error); }
});

courseManagementRouter.get('/admin/lessons/:id/explanation-sources', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const lessonId = String(req.params.id);
    const items = await db.select({ id: s.questions.id, questionText: s.questions.questionText, explanation: s.questions.explanation, sourceDocument: s.questions.sourceDocument, sourceRevision: s.questions.sourceRevision, sourceLocation: s.questions.sourceLocation, status: s.questions.status, reviewedBy: s.questions.reviewedBy, approvedAt: s.questions.approvedAt })
      .from(s.lessonQuestions).innerJoin(s.questions, eq(s.questions.id, s.lessonQuestions.questionId)).where(eq(s.lessonQuestions.lessonId, lessonId)).orderBy(asc(s.lessonQuestions.questionOrder));
    res.json({ items });
  } catch (error) { next(error); }
});

courseManagementRouter.put('/admin/lessons/:id/theory-settings', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const p = z.object({ theoryRequired: z.boolean() }).safeParse(req.body);
    if (!p.success) return fail(res, 400, 'VALIDATION', 'Онол заавал үзэх тохиргоог шалгана уу.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [lesson] = await tx.select().from(s.lessons).where(eq(s.lessons.id, id)).for('update').limit(1);
      if (!lesson) return 'missing' as const;
      const blocks = await tx.select({ reviewStatus: s.lessonContentBlocks.reviewStatus }).from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, id));
      if (p.data.theoryRequired && lesson.status === 'published' && (!blocks.length || blocks.some((block) => block.reviewStatus !== 'approved'))) return 'not_ready' as const;
      await tx.update(s.lessons).set({ theoryRequired: p.data.theoryRequired, updatedAt: new Date() }).where(eq(s.lessons.id, id));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'lesson.theory_settings_updated', entityType: 'lesson', entityId: id, metadata: { theoryRequired: p.data.theoryRequired } });
      return 'saved' as const;
    });
    if (result === 'missing') return fail(res, 404, 'NOT_FOUND', 'Хичээл олдсонгүй.');
    if (result === 'not_ready') return fail(res, 409, 'THEORY_NOT_READY', 'Нийтэлсэн хичээлд онолыг заавал болгохын өмнө бүх блок баталгаажсан байх шаардлагатай.');
    res.json({ theoryRequired: p.data.theoryRequired });
  } catch (error) { next(error); }
});

courseManagementRouter.put('/admin/content-blocks/:id', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const parsed = blockInput.safeParse(req.body); if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Агуулгын блокийн төрөл эсвэл текстийг шалгана уу.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [block] = await tx.select().from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.id, id)).for('update').limit(1);
      if (!block) return 'missing' as const;
      if (block.reviewStatus === 'approved' && req.user!.role !== 'admin') return 'admin_required' as const;
      if (parsed.data.blockType === 'knowledge_check') {
        const [linked] = await tx.select({ id: s.questions.id }).from(s.lessonQuestions).innerJoin(s.questions, eq(s.questions.id, s.lessonQuestions.questionId)).where(and(eq(s.lessonQuestions.lessonId, block.lessonId), eq(s.questions.id, parsed.data.content.questionId), eq(s.questions.status, 'published'))).limit(1);
        if (!linked) return 'question_unavailable' as const;
      }
      const now = new Date();
      await tx.update(s.lessonContentBlocks).set({ blockType: parsed.data.blockType, content: parsed.data.content, sourceDocument: parsed.data.sourceDocument ?? null, sourceRevision: parsed.data.sourceRevision ?? null, sourcePage: parsed.data.sourcePage ?? null, reviewStatus: 'draft', reviewedBy: null, reviewedAt: null, updatedAt: now }).where(eq(s.lessonContentBlocks.id, id));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'lesson.content_block.updated', entityType: 'lesson_content_block', entityId: id, metadata: { lessonId: block.lessonId, previousReviewStatus: block.reviewStatus } });
      return 'saved' as const;
    });
    if (result === 'missing') return fail(res, 404, 'NOT_FOUND', 'Агуулгын блок олдсонгүй.');
    if (result === 'admin_required') return fail(res, 403, 'FORBIDDEN', 'Баталгаажсан агуулгыг зөвхөн администратор засварлаж болно.');
    if (result === 'question_unavailable') return fail(res, 409, 'QUESTION_NOT_READY', 'Мэдлэг шалгах блок нь тухайн хичээлтэй холбогдсон нийтлэгдсэн асуултыг заана.');
    res.json({ status: 'draft' });
  } catch (error) { next(error); }
});

courseManagementRouter.post('/admin/lessons/:id/content-blocks/submit-review', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [lesson] = await tx.select({ id: s.lessons.id }).from(s.lessons).where(eq(s.lessons.id, id)).for('update').limit(1); if (!lesson) return 'missing' as const;
      const blocks = await tx.select().from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, id)).orderBy(asc(s.lessonContentBlocks.blockOrder)).for('update');
      if (!blocks.length) return 'empty' as const;
      const now = new Date();
      await tx.update(s.lessonContentBlocks).set({ reviewStatus: 'pending_review', reviewedBy: null, reviewedAt: null, updatedAt: now }).where(and(eq(s.lessonContentBlocks.lessonId, id), inArray(s.lessonContentBlocks.reviewStatus, ['draft', 'rejected'])));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'lesson.content_blocks.submitted_for_review', entityType: 'lesson', entityId: id, metadata: { blockCount: blocks.length } });
      return 'submitted' as const;
    });
    if (result === 'missing') return fail(res, 404, 'NOT_FOUND', 'Хичээл олдсонгүй.');
    if (result === 'empty') return fail(res, 409, 'CONTENT_EMPTY', 'Хяналтад шилжүүлэх онолын блок алга.');
    res.json({ status: 'pending_review' });
  } catch (error) { next(error); }
});

courseManagementRouter.post('/admin/lessons/:id/content-blocks/reorder', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const p = z.object({ ids: z.array(z.string().uuid()).max(100) }).safeParse(req.body); if (!p.success || new Set(p.data?.ids ?? []).size !== (p.data?.ids.length ?? 0)) return fail(res, 400, 'VALIDATION', 'Блокийн дарааллыг шалгана уу.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const blocks = await tx.select().from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, id)).for('update');
      if (!blocks.length || blocks.length !== p.data.ids.length || blocks.some((block) => !p.data.ids.includes(block.id))) return 'mismatch' as const;
      if (blocks.some((block) => block.reviewStatus === 'approved') && req.user!.role !== 'admin') return 'admin_required' as const;
      const [maxOrder] = await tx.select({ value: sql<number>`coalesce(max(${s.lessonContentBlocks.blockOrder}), 0)::int` }).from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, id));
      const offset = (maxOrder?.value ?? 0) + blocks.length + 1;
      await tx.update(s.lessonContentBlocks).set({ blockOrder: sql`${s.lessonContentBlocks.blockOrder} + ${offset}`, reviewStatus: 'draft', reviewedBy: null, reviewedAt: null, updatedAt: new Date() }).where(eq(s.lessonContentBlocks.lessonId, id));
      for (const [blockOrder, blockId] of p.data.ids.entries()) await tx.update(s.lessonContentBlocks).set({ blockOrder }).where(eq(s.lessonContentBlocks.id, blockId));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'lesson.content_blocks.reordered', entityType: 'lesson', entityId: id, metadata: { blockCount: p.data.ids.length } });
      return 'saved' as const;
    });
    if (result === 'mismatch') return fail(res, 409, 'BLOCK_ORDER_MISMATCH', 'Хичээлийн бүх блокийг яг нэг удаа сонгоно уу.');
    if (result === 'admin_required') return fail(res, 403, 'FORBIDDEN', 'Баталгаажсан блокийн дарааллыг зөвхөн администратор өөрчилж болно.');
    res.json({ status: 'draft' });
  } catch (error) { next(error); }
});

courseManagementRouter.post('/admin/lessons/:id/content-blocks', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const parsed = blockInput.safeParse(req.body); if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Агуулгын блокийн төрөл эсвэл текстийг шалгана уу.');
    const id = String(req.params.id);
    const created = await db.transaction(async (tx) => {
      const [lesson] = await tx.select({ id: s.lessons.id }).from(s.lessons).where(eq(s.lessons.id, id)).for('update').limit(1); if (!lesson) return null;
      if (parsed.data.blockType === 'knowledge_check') {
        const [linked] = await tx.select({ id: s.questions.id }).from(s.lessonQuestions).innerJoin(s.questions, eq(s.questions.id, s.lessonQuestions.questionId)).where(and(eq(s.lessonQuestions.lessonId, id), eq(s.questions.id, parsed.data.content.questionId), eq(s.questions.status, 'published'))).limit(1);
        if (!linked) return 'question_unavailable' as const;
      }
      const [maxOrder] = await tx.select({ value: sql<number>`coalesce(max(${s.lessonContentBlocks.blockOrder}),-1)::int` }).from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, id));
      const [block] = await tx.insert(s.lessonContentBlocks).values({ lessonId: id, blockOrder: (maxOrder?.value ?? -1) + 1, blockType: parsed.data.blockType, content: parsed.data.content, sourceDocument: parsed.data.sourceDocument ?? null, sourceRevision: parsed.data.sourceRevision ?? null, sourcePage: parsed.data.sourcePage ?? null, reviewStatus: 'draft', createdBy: req.user!.id }).returning();
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'lesson.content_block.created', entityType: 'lesson_content_block', entityId: block.id, metadata: { lessonId: id, blockType: block.blockType } });
      return block;
    });
    if (!created) return fail(res, 404, 'NOT_FOUND', 'Хичээл олдсонгүй.');
    if (created === 'question_unavailable') return fail(res, 409, 'QUESTION_NOT_READY', 'Мэдлэг шалгах блок нь тухайн хичээлтэй холбогдсон нийтлэгдсэн асуултыг заана.');
    res.status(201).json({ block: created });
  } catch (error) { next(error); }
});

courseManagementRouter.put('/admin/lessons/:id/content-blocks', requireAuth, requireRoles('admin', 'training_manager'), async (req, res, next) => {
  try {
    const parsed = blocksInput.safeParse(req.body?.blocks); if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Агуулгын блокийн төрөл эсвэл текстийг шалгана уу.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [lesson] = await tx.select({ id: s.lessons.id }).from(s.lessons).where(eq(s.lessons.id, id)).for('update').limit(1); if (!lesson) return 'missing' as const;
      const old = await tx.select({ id: s.lessonContentBlocks.id, reviewStatus: s.lessonContentBlocks.reviewStatus }).from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, id));
      if (old.some((block) => block.reviewStatus === 'approved') && req.user!.role !== 'admin') return 'admin_required' as const;
      for (const block of parsed.data) if (block.blockType === 'knowledge_check') {
        const [linked] = await tx.select({ id: s.questions.id }).from(s.lessonQuestions).innerJoin(s.questions, eq(s.questions.id, s.lessonQuestions.questionId)).where(and(eq(s.lessonQuestions.lessonId, id), eq(s.questions.id, block.content.questionId), eq(s.questions.status, 'published'))).limit(1);
        if (!linked) return 'knowledge_check_unavailable' as const;
      }
      await tx.delete(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId, id));
      if (parsed.data.length) await tx.insert(s.lessonContentBlocks).values(parsed.data.map((block, blockOrder) => ({ lessonId: id, blockOrder, blockType: block.blockType, content: block.content, sourceDocument: block.sourceDocument ?? null, sourceRevision: block.sourceRevision ?? null, sourcePage: block.sourcePage ?? null, reviewStatus: 'draft', createdBy: req.user!.id })));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: 'lesson.content_blocks_updated', entityType: 'lesson', entityId: id, metadata: { previousBlockCount: old.length, newBlockCount: parsed.data.length } });
      return 'saved' as const;
    });
    if (result === 'missing') return fail(res, 404, 'NOT_FOUND', 'Хичээл олдсонгүй.');
    if (result === 'admin_required') return fail(res, 403, 'FORBIDDEN', 'Баталгаажсан агуулгыг дахин засахын тулд администратор шаардлагатай.');
    if (result === 'knowledge_check_unavailable') return fail(res, 409, 'QUESTION_NOT_READY', 'Мэдлэг шалгах блок нь тухайн хичээлтэй холбогдсон нийтлэгдсэн асуултыг заана.');
    res.json({ status: 'saved', reviewStatus: 'draft', blockCount: parsed.data.length });
  } catch (error) { next(error); }
});

courseManagementRouter.post('/admin/content-blocks/:id/review', requireAuth, requireRoles('admin'), async (req, res, next) => {
  try {
    const p = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(2000).optional() }).safeParse(req.body); if (!p.success) return fail(res, 400, 'VALIDATION', 'Хяналтын шийдвэрийг шалгана уу.');
    const id = String(req.params.id);
    const result = await db.transaction(async (tx) => {
      const [block] = await tx.select().from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.id, id)).for('update').limit(1); if (!block) return 'missing' as const;
      if (block.reviewStatus !== 'pending_review') return 'not_submitted' as const;
      const now = new Date();
      await tx.update(s.lessonContentBlocks).set({ reviewStatus: p.data.decision, reviewedBy: req.user!.id, reviewedAt: now, updatedAt: now }).where(eq(s.lessonContentBlocks.id, id));
      await tx.insert(s.auditLogs).values({ actorUserId: req.user!.id, action: `lesson.content_block.${p.data.decision}`, entityType: 'lesson_content_block', entityId: id, metadata: { lessonId: block.lessonId, sourceDocument: block.sourceDocument, sourceRevision: block.sourceRevision, sourcePage: block.sourcePage, note: p.data.note ?? null } });
      return 'reviewed' as const;
    });
    if (result === 'missing') return fail(res, 404, 'NOT_FOUND', 'Агуулгын блок олдсонгүй.');
    if (result === 'not_submitted') return fail(res, 409, 'NOT_SUBMITTED', 'Блокийг эхлээд reviewer-ийн хяналтад шилжүүлнэ үү.');
    res.json({ status: p.data.decision });
  } catch (error) { next(error); }
});
