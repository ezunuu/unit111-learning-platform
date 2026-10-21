import assert from 'node:assert/strict';
import test from 'node:test';
import {questionReviewReasons} from './question-review-policy.js';

const complete={status:'pending_review',questionText:'BK117 C-2 fuselage review question?',questionType:'single_choice' as const,explanation:'Refer to the source section.',sourceDocument:'01 - Fuselage.pdf',sourceRevision:'Revision 4',sourceLocation:'02-4',options:['A','B','C','D'].map(text=>({text})),correctIndexes:[0]};

test('review readiness accepts an individually complete pending question',()=>{
  assert.deepEqual(questionReviewReasons(complete),[]);
});

test('review readiness does not require source metadata',()=>{
  assert.deepEqual(questionReviewReasons({...complete,sourceRevision:null}),[]);
  assert.ok(questionReviewReasons({...complete,sourceRevision:''}).length===0);
  assert.deepEqual(questionReviewReasons({...complete,sourceDocument:null,sourceLocation:null}),[]);
  assert.deepEqual(questionReviewReasons({...complete,sourceLocation:null}),[]);
});

test('review readiness rejects draft and incomplete question data',()=>{
  const reasons=questionReviewReasons({...complete,status:'draft',options:complete.options.slice(0,3),correctIndexes:[]});
  assert.ok(reasons.some(reason=>reason.includes('Зөвхөн хяналтад')));
  assert.ok(reasons.some(reason=>reason.includes('яг 4 сонголт')));
  assert.ok(reasons.some(reason=>reason.includes('Зөв хариултын')));
});

test('review readiness accepts an optional blank explanation',()=>{
  const reasons=questionReviewReasons({...complete,explanation:''});
  assert.deepEqual(reasons,[]);
});
