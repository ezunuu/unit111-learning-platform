import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLearningAnswerFeedback } from './learning-answer-feedback.js';

const snapshot = {
  options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Bravo' }, { id: 'c', text: 'Charlie' }, { id: 'd', text: 'Delta' }],
  correctOptionIds: ['b'],
  explanation: 'Bravo is correct for this question.',
  sourceDocument: 'Approved manual',
  sourceRevision: 'Rev A',
  sourceLocation: 'page 7',
};

test('answer feedback only returns the correct answer and explanation after answer evaluation', () => {
  assert.deepEqual(buildLearningAnswerFeedback(snapshot, { isCorrect: true, awardedXp: 10 }), {
    correct: true,
    correctOptionIds: ['b'],
    correctOptionTexts: ['Bravo'],
    explanation: 'Bravo is correct for this question.',
    source: { document: 'Approved manual', revision: 'Rev A', location: 'page 7' },
    xpPotential: 10,
  });
  assert.deepEqual(buildLearningAnswerFeedback(snapshot, { isCorrect: false, awardedXp: 0 }), {
    correct: false,
    correctOptionIds: ['b'],
    correctOptionTexts: ['Bravo'],
    explanation: 'Bravo is correct for this question.',
    source: { document: 'Approved manual', revision: 'Rev A', location: 'page 7' },
    xpPotential: 0,
  });
});

test('missing explanation and options are safe and do not leak unrelated question data', () => {
  assert.deepEqual(buildLearningAnswerFeedback({ options: [], correctOptionIds: [], explanation: null }, { isCorrect: false, awardedXp: 0 }), {
    correct: false,
    correctOptionIds: [],
    correctOptionTexts: [],
    explanation: '',
    source: { document: null, revision: null, location: null },
    xpPotential: 0,
  });
});
