import assert from 'node:assert/strict';
import test from 'node:test';
import {bulkQuestionPublishRequest,bulkQuestionReviewRequest,normalizeReviewNote,singleQuestionPublishRequest,singleQuestionReviewRequest} from './question-review-request.js';

const id='4d0e58bc-b3a3-400b-9652-bad9623ed107';

test('single approval and publish accept omitted, null, and blank optional notes',()=>{
  for(const schema of [singleQuestionReviewRequest,singleQuestionPublishRequest]){
    assert.equal(schema.safeParse({}).success,true);
    assert.equal(schema.safeParse({verificationNote:null}).success,true);
    assert.equal(schema.safeParse({verificationNote:'   '}).success,true);
    assert.equal(schema.safeParse({verificationNote:'Reviewed against the source.'}).success,true);
  }
});

test('bulk approval and publish accept items with and without optional notes while preserving unique IDs',()=>{
  for(const schema of [bulkQuestionReviewRequest,bulkQuestionPublishRequest]){
    assert.equal(schema.safeParse({items:[{questionId:id}]}).success,true);
    assert.equal(schema.safeParse({items:[{questionId:id,verificationNote:null}]}).success,true);
    assert.equal(schema.safeParse({items:[{questionId:id,verificationNote:'Reviewed.'}]}).success,true);
    assert.equal(schema.safeParse({items:[{questionId:id},{questionId:id}]}).success,false);
  }
});

test('empty optional notes normalize to null for audit metadata',()=>{
  assert.equal(normalizeReviewNote(undefined),null);
  assert.equal(normalizeReviewNote(null),null);
  assert.equal(normalizeReviewNote('  '),null);
  assert.equal(normalizeReviewNote('  reviewer note  '),'reviewer note');
});
