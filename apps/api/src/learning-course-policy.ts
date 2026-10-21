export type OrderedLesson = {
  id: string;
  lessonOrder: number;
  completed: boolean;
  questionCount: number;
  groupKey?: string;
  freeLearning?: boolean;
  groupUnlocked?: boolean;
};

export function buildCourseLessonPath(items: OrderedLesson[]) {
  const sorted = [...items].sort((a, b) => a.lessonOrder - b.lessonOrder || a.id.localeCompare(b.id));
  const passedByGroup = new Map<string, boolean>();
  return sorted.map((item) => {
    const group = item.groupKey ?? 'default';
    const valid = item.questionCount >= 1 && item.questionCount <= 100;
    const priorPassed = passedByGroup.get(group) ?? true;
    const unlocked = valid && (item.completed || !!item.freeLearning || (item.groupUnlocked !== false && priorPassed));
    passedByGroup.set(group, priorPassed && item.completed && valid);
    return { ...item, unlocked };
  });
}

export function localActivityDate(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    throw new Error('INVALID_TIME_ZONE');
  }
}

export function currentLearningStreak(activityDates: string[], today: string): number {
  const dates = new Set(activityDates);
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00.000Z`);
  if (!dates.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  if (!dates.has(cursor.toISOString().slice(0, 10))) return 0;
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function lessonXpReward(input: { questionXp: number; passed: boolean; perfect: boolean; completionXp: number; passXp: number; perfectXp: number }): number {
  if (!input.passed) return 0;
  return Math.max(0, input.questionXp) + Math.max(0, input.completionXp) + Math.max(0, input.passXp) + (input.perfect ? Math.max(0, input.perfectXp) : 0);
}

export function achievedMilestones(input: { lessonCount: number; perfectLessonCount: number; streak: number; chapterComplete?: boolean; courseComplete: boolean }): string[] {
  return [
    ...(input.lessonCount >= 1 ? ['first_lesson'] : []),
    ...(input.lessonCount >= 5 ? ['lessons_5'] : []),
    ...(input.perfectLessonCount >= 1 ? ['perfect_practice'] : []),
    ...(input.streak >= 3 ? ['streak_3'] : []),
    ...(input.streak >= 7 ? ['streak_7'] : []),
    ...(input.chapterComplete ? ['chapter_complete'] : []),
    ...(input.courseComplete ? ['course_complete'] : []),
  ];
}
