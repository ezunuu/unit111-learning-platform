export type LearningAnswerSnapshot = {
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  explanation: string | null;
  sourceDocument?: string | null;
  sourceRevision?: string | null;
  sourceLocation?: string | null;
};

export function buildLearningAnswerFeedback(
  snapshot: LearningAnswerSnapshot,
  answer: { isCorrect: boolean; awardedXp: number },
) {
  return {
    correct: answer.isCorrect,
    correctOptionIds: [...snapshot.correctOptionIds],
    correctOptionTexts: snapshot.options
      .filter((option) => snapshot.correctOptionIds.includes(option.id))
      .map((option) => option.text),
    explanation: snapshot.explanation ?? '',
    source: { document: snapshot.sourceDocument ?? null, revision: snapshot.sourceRevision ?? null, location: snapshot.sourceLocation ?? null },
    xpPotential: answer.awardedXp,
  };
}
