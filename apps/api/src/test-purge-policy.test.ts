import test from 'node:test';
import assert from 'node:assert/strict';
import {canMarkQuizAsTest,canPermanentlyPurgeTestQuiz} from './test-purge-policy.js';

const candidate={title:'Development quiz',status:'archived',isTest:true};

test('only archived quizzes without competitions can be explicitly marked as test-only',()=>{
  assert.equal(canMarkQuizAsTest({...candidate,isTest:false},0),true);
  assert.equal(canMarkQuizAsTest({...candidate,status:'published',isTest:false},0),false);
  assert.equal(canMarkQuizAsTest({...candidate,isTest:false},1),false);
});

test('test quiz purge requires exact title, explicit attestation, no competitions, and known foreign keys only',()=>{
  const base={candidate,confirmedTestOnly:true,confirmationTitle:'Development quiz',competitionCount:0,unknownForeignKeyTables:[]};
  assert.equal(canPermanentlyPurgeTestQuiz(base),true);
  assert.equal(canPermanentlyPurgeTestQuiz({...base,confirmationTitle:'wrong'}),false);
  assert.equal(canPermanentlyPurgeTestQuiz({...base,confirmedTestOnly:false}),false);
  assert.equal(canPermanentlyPurgeTestQuiz({...base,competitionCount:1}),false);
  assert.equal(canPermanentlyPurgeTestQuiz({...base,unknownForeignKeyTables:['unknown_relation']}),false);
  assert.equal(canPermanentlyPurgeTestQuiz({...base,candidate:{...candidate,isTest:false}}),false);
});
