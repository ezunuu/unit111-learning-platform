import test from 'node:test';
import assert from 'node:assert/strict';
import {canPermanentlyDeleteQuiz,isTrainingQuiz,isVisibleTrainingLesson,learnerVisibleQuizStatus} from './quiz-lifecycle.js';

test('learner-facing quiz query status is published only',()=>{
  assert.equal(learnerVisibleQuizStatus,'published');
});

test('training quizzes use the lesson player and only published complete lessons are visible',()=>{
  assert.equal(isTrainingQuiz('training','lesson-1'),true);
  assert.equal(isTrainingQuiz('practice',null),false);
  assert.equal(isVisibleTrainingLesson('draft','draft',10,10),false);
  assert.equal(isVisibleTrainingLesson('published','draft',10,10),false);
  assert.equal(isVisibleTrainingLesson('published','published',9,9),true);
  assert.equal(isVisibleTrainingLesson('published','published',11,10),false);
  assert.equal(isVisibleTrainingLesson('published','published',11,11),true);
  assert.equal(isVisibleTrainingLesson('published','published',10,10),true);
});

test('permanent deletion is limited to archived quizzes without attempt or competition history',()=>{
  assert.equal(canPermanentlyDeleteQuiz('archived',0,0),true);
  assert.equal(canPermanentlyDeleteQuiz('published',0,0),false);
  assert.equal(canPermanentlyDeleteQuiz('archived',1,0),false);
  assert.equal(canPermanentlyDeleteQuiz('archived',0,1),false);
});
