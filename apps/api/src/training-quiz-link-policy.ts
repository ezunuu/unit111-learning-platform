export type TrainingQuizLinkResult =
  | { kind: 'missing_lesson' }
  | { kind: 'already_linked'; quizId: string }
  | { kind: 'quiz_type_conflict' }
  | { kind: 'question_count'; actual: number }
  | { kind: 'published_questions_required' }
  | { kind: 'create' };

/** Draft lessons may have draft training quizzes for admin preview; learner publication remains gated elsewhere. */
export function decideTrainingQuizLink(input: {
  lessonExists: boolean;
  lessonStatus?: string;
  questionStatuses: string[];
  existingQuiz?: { id: string; quizType: string } | null;
}): TrainingQuizLinkResult {
  if (!input.lessonExists) return { kind: 'missing_lesson' };
  if (input.existingQuiz) {
    return input.existingQuiz.quizType === 'training'
      ? { kind: 'already_linked', quizId: input.existingQuiz.id }
      : { kind: 'quiz_type_conflict' };
  }
  if (input.questionStatuses.length < 1 || input.questionStatuses.length > 100) {
    return { kind: 'question_count', actual: input.questionStatuses.length };
  }
  if (input.lessonStatus === 'published' && input.questionStatuses.some(status => status !== 'published')) {
    return { kind: 'published_questions_required' };
  }
  return { kind: 'create' };
}
