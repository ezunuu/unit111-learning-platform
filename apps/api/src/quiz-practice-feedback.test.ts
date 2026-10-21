import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPracticeFeedback, mayReturnImmediateFeedback } from './quiz-practice-feedback.js';

test('immediate answer feedback is limited to practice quizzes configured for it', () => {
  assert.equal(mayReturnImmediateFeedback({ quizType: 'practice', isTest: false, immediateFeedback: true }), true);
  assert.equal(mayReturnImmediateFeedback({ quizType: 'practice', isTest: true, immediateFeedback: true }), true);
  assert.equal(mayReturnImmediateFeedback({ quizType: 'official', isTest: false, immediateFeedback: true }), false);
  assert.equal(mayReturnImmediateFeedback({ quizType: 'practice', isTest: false, immediateFeedback: false }), false);
});

test('feedback is built only after submission and contains question scoped explanation and source', () => {
  assert.deepEqual(buildPracticeFeedback([{ id: 'a', text: 'Wrong' }, { id: 'b', text: 'Right' }], ['b'], ['a'], 'Use the approved manual.', { document: 'Manual', revision: null, location: 'page 4' }), {
    correct: false, selectedOptionTexts: ['Wrong'], correctOptionTexts: ['Right'], explanation: 'Use the approved manual.', source: { document: 'Manual', revision: null, location: 'page 4' },
  });
});
