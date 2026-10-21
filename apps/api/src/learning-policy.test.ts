import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSequentialLessonPath, earnedLearningAnswerXp, earnedQuestionXp, lessonPasses } from './learning-policy.js';

test('only first lesson unlocks until each prior lesson is completed', () => {
  const path = buildSequentialLessonPath([
    { id: '3', lessonOrder: 3, completed: false, questionCount: 10 },
    { id: '1', lessonOrder: 1, completed: false, questionCount: 10 },
    { id: '2', lessonOrder: 2, completed: false, questionCount: 10 },
  ]);
  assert.deepEqual(path.map((item) => item.unlocked), [true, false, false]);
  const next = buildSequentialLessonPath(path.map((item) => ({ ...item, completed: item.lessonOrder === 1 })));
  assert.deepEqual(next.map((item) => item.unlocked), [true, true, false]);
});

test('a lesson with one to one hundred questions is valid for sequential unlocking', () => {
  const path = buildSequentialLessonPath([
    { id: '1', lessonOrder: 1, completed: false, questionCount: 9 },
    { id: '2', lessonOrder: 2, completed: false, questionCount: 10 },
  ]);
  assert.deepEqual(path.map((item) => item.unlocked), [true, false]);
});

test('a later completion cannot bypass an earlier incomplete lesson', () => {
  const path = buildSequentialLessonPath([
    { id: '1', lessonOrder: 1, completed: false, questionCount: 10 },
    { id: '2', lessonOrder: 2, completed: true, questionCount: 10 },
    { id: '3', lessonOrder: 3, completed: false, questionCount: 10 },
  ]);
  assert.deepEqual(path.map(item => item.unlocked), [true, false, false]);
});

test('80 percent is the pass threshold, and xp is awarded only for correct answers', () => {
  assert.equal(lessonPasses(8, 10), true);
  assert.equal(lessonPasses(7, 10), false);
  assert.equal(lessonPasses(0, 0), false);
  assert.equal(earnedQuestionXp(10, true), 10);
  assert.equal(earnedQuestionXp(10, false), 0);
});

test('retry review answers never award XP', () => {
  assert.equal(earnedLearningAnswerXp('review', 10, true), 0);
  assert.equal(earnedLearningAnswerXp('review', 10, false), 0);
  assert.equal(earnedLearningAnswerXp('lesson', 10, true), 10);
});

test('lesson path unlock supports published lessons with one to one hundred questions',()=>{
  const path=buildSequentialLessonPath([{id:'a',lessonOrder:1,completed:false,questionCount:3},{id:'b',lessonOrder:2,completed:false,questionCount:100}]);
  assert.deepEqual(path.map(item=>item.unlocked),[true,false]);
  assert.equal(buildSequentialLessonPath([{id:'a',lessonOrder:1,completed:false,questionCount:101}])[0].unlocked,false);
});
