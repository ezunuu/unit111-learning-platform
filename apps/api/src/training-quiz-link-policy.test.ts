import assert from 'node:assert/strict';
import test from 'node:test';
import { decideTrainingQuizLink } from './training-quiz-link-policy.js';

const tenDraft = Array(10).fill('draft');

test('draft lesson can receive an idempotently linked draft training quiz for preview', () => {
  assert.deepEqual(decideTrainingQuizLink({ lessonExists: true, lessonStatus: 'draft', questionStatuses: tenDraft }), { kind: 'create' });
  assert.deepEqual(decideTrainingQuizLink({ lessonExists: true, lessonStatus: 'draft', questionStatuses: tenDraft, existingQuiz: { id: 'quiz-1', quizType: 'training' } }), { kind: 'already_linked', quizId: 'quiz-1' });
});

test('published lesson requires all linked questions to be published before a training quiz can be created', () => {
  assert.deepEqual(decideTrainingQuizLink({ lessonExists: true, lessonStatus: 'published', questionStatuses: tenDraft }), { kind: 'published_questions_required' });
  assert.deepEqual(decideTrainingQuizLink({ lessonExists: true, lessonStatus: 'published', questionStatuses: Array(10).fill('published') }), { kind: 'create' });
});

test('linking rejects empty or oversized lessons and quiz-type conflicts', () => {
  assert.deepEqual(decideTrainingQuizLink({ lessonExists: true, lessonStatus: 'draft', questionStatuses: [] }), { kind: 'question_count', actual: 0 });
  assert.deepEqual(decideTrainingQuizLink({ lessonExists: true, lessonStatus: 'draft', questionStatuses: Array(101).fill('draft') }), { kind: 'question_count', actual: 101 });
  assert.deepEqual(decideTrainingQuizLink({ lessonExists: true, lessonStatus: 'draft', questionStatuses: tenDraft, existingQuiz: { id: 'quiz-2', quizType: 'practice' } }), { kind: 'quiz_type_conflict' });
  assert.deepEqual(decideTrainingQuizLink({ lessonExists: false, questionStatuses: [] }), { kind: 'missing_lesson' });
});
