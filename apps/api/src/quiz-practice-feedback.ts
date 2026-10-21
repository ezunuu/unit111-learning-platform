export type PracticeFeedbackMode = { quizType: string; isTest: boolean; immediateFeedback: boolean };

export function mayReturnImmediateFeedback(quiz: PracticeFeedbackMode): boolean {
  return quiz.quizType === 'practice' && quiz.immediateFeedback;
}

export function buildPracticeFeedback(
  options: { id: string; text: string }[],
  correctOptionIds: string[],
  selectedOptionIds: string[],
  explanation: string | null,
  source: { document: string | null; revision: string | null; location: string | null },
) {
  const correct = [...correctOptionIds].sort().join(',') === [...selectedOptionIds].sort().join(',');
  return {
    correct,
    selectedOptionTexts: options.filter((option) => selectedOptionIds.includes(option.id)).map((option) => option.text),
    correctOptionTexts: options.filter((option) => correctOptionIds.includes(option.id)).map((option) => option.text),
    explanation: explanation ?? '',
    source,
  };
}
