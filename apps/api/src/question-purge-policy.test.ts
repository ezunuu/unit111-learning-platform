import test from 'node:test';
import assert from 'node:assert/strict';
import {assessQuestionPurge,type QuestionPurgeDependencies} from './question-purge-policy.js';

const clean:QuestionPurgeDependencies={quizLinkCount:0,lessonLinkCount:0,attemptCount:0,answerCount:0,snapshotCount:0,competitionCount:0,learningHistoryCount:0,revisionCount:0,duplicateReferenceCount:0,unknownForeignKeyTables:[]};

test('unused archived questions can be removed and quiz-only links are detached',()=>{
  assert.deepEqual(assessQuestionPurge('archived',{...clean,quizLinkCount:2}),{canDelete:true,reasons:[],quizLinksToDetach:2});
});

test('only archived questions can be permanently removed',()=>{
  assert.equal(assessQuestionPurge('published',clean).canDelete,false);
});

test('attempt, answer, snapshot, competition, learning history, lesson, duplicate, and unknown references block removal',()=>{
  for(const dependency of ['attemptCount','answerCount','snapshotCount','competitionCount','learningHistoryCount','lessonLinkCount','duplicateReferenceCount'] as const){
    assert.equal(assessQuestionPurge('archived',{...clean,[dependency]:1}).canDelete,false,dependency);
  }
  assert.equal(assessQuestionPurge('archived',{...clean,unknownForeignKeyTables:['future_table']}).canDelete,false);
});

test('audit logs may be retained independently while owned rows and safe quiz links are removed',()=>{
  assert.equal(assessQuestionPurge('archived',{...clean,quizLinkCount:1}).canDelete,true);
});
