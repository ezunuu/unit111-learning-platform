export type LessonPathItem = {
  id: string;
  lessonOrder: number;
  completed: boolean;
  questionCount: number;
};

export type LessonAvailability = LessonPathItem & { unlocked: boolean };

export function buildSequentialLessonPath(items: LessonPathItem[]): LessonAvailability[] {
  const sorted = [...items].sort((a, b) => a.lessonOrder - b.lessonOrder || a.id.localeCompare(b.id));
  let priorLessonsPassed = true;
  return sorted.map((item) => {
    const validQuestionCount = item.questionCount >= 1 && item.questionCount <= 100;
    const unlocked = priorLessonsPassed && validQuestionCount;
    priorLessonsPassed = priorLessonsPassed && item.completed && validQuestionCount;
    return { ...item, unlocked };
  });
}

export function lessonPasses(correctCount: number, questionCount: number, passingPercentage = 80): boolean {
  if (!Number.isInteger(correctCount) || !Number.isInteger(questionCount) || questionCount <= 0) return false;
  if (correctCount < 0 || correctCount > questionCount || passingPercentage < 0 || passingPercentage > 100) return false;
  return correctCount / questionCount * 100 >= passingPercentage;
}

export function earnedQuestionXp(questionXp: number, correct: boolean): number {
  return correct && Number.isInteger(questionXp) && questionXp > 0 ? questionXp : 0;
}

export function earnedLearningAnswerXp(mode: 'lesson' | 'review', questionXp: number, correct: boolean): number {
  return mode === 'lesson' ? earnedQuestionXp(questionXp, correct) : 0;
}
