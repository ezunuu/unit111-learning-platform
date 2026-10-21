import { validateQuestionDraft } from './question-validation.js';

export type BulkQuestionInput = {
  id: string;
  status: string;
  questionText: string;
  questionType: 'single_choice' | 'multiple_choice' | 'true_false';
  explanation: string;
  sourceDocument: string | null;
  sourceRevision: string | null;
  sourceSection?: string | null;
  sourceLocation: string | null;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
};

export function questionPublishReasons(question: BulkQuestionInput): string[] {
  const reasons: string[] = [];
  if (question.status === 'archived') reasons.push('Архивласан асуултыг эхлээд сэргээнэ үү.');
  if (question.status === 'published') reasons.push('Аль хэдийн нийтлэгдсэн.');
  if (question.options.length !== 4) reasons.push(`Яг 4 сонголт шаардлагатай (одоогоор ${question.options.length}).`);
  const indexes = question.options.map((option, index) => question.correctOptionIds.includes(option.id) ? index : -1).filter(index => index >= 0);
  if (indexes.length !== question.correctOptionIds.length) reasons.push('Зөв хариултын холбоос сонголтуудтай таарахгүй байна.');
  if (question.correctOptionIds.length !== 1) reasons.push('Яг нэг зөв хариулт шаардлагатай.');
  const validation = validateQuestionDraft({ questionText: question.questionText, questionType: question.questionType, options: question.options.map(option => ({ text: option.text })), correctIndexes: indexes });
  if (validation) reasons.push(validation);
  return [...new Set(reasons)];
}

export type LessonPublishInput = { id: string; title: string; status: string; trainingQuizLinked:boolean; linkedQuestions: { id: string; status: string; validationError?:string|null }[]; theoryRequired?:boolean; contentBlockStatuses?:string[]; categoryId?:string; description?:string; lessonOrder?:number };
export function lessonPublishReasons(lesson: LessonPublishInput): { reasons: string[]; blockingQuestionIds: string[]; blockingQuestions:{id:string;reason:string}[] } {
  const reasons: string[] = [];
  if (lesson.status !== 'draft') reasons.push(lesson.status === 'published' ? 'Хичээл аль хэдийн нийтлэгдсэн.' : 'Зөвхөн ноорог хичээлийг нийтэлж болно.');
  if (lesson.linkedQuestions.length < 1 || lesson.linkedQuestions.length > 100) reasons.push(`1–100 асуулт шаардлагатай (одоогоор ${lesson.linkedQuestions.length}).`);
  if(lesson.theoryRequired&&!lesson.contentBlockStatuses?.length)reasons.push('Онол шаардлагатай боловч онолын блок алга.');
  if(lesson.contentBlockStatuses?.some(status=>status!=='approved'))reasons.push('Онолын материалыг баталгаажуулна уу.');
  const blocked = lesson.linkedQuestions.filter(question => question.status !== 'published'||question.validationError);
  if (blocked.length) reasons.push(`${blocked.length} асуулт нийтлэгдээгүй эсвэл хариулт дутуу байна.`);
  return { reasons, blockingQuestionIds: blocked.map(question => question.id), blockingQuestions:blocked.map(question=>({id:question.id,reason:question.validationError||`Нийтлэгдээгүй (төлөв: ${question.status}).`})) };
}
