import test from 'node:test';
import assert from 'node:assert/strict';
import {attemptAllowance,canConfigureUnlimitedAttempts,isUnlimitedTestQuiz} from './attempt-retry-policy.js';

test('voided attempts do not consume the allowance while attempt history numbering stays monotonic',()=>{
  assert.deepEqual(attemptAllowance([{status:'voided',attemptNumber:7}],1,false),{used:0,remaining:1,unlimited:false,exhausted:false,nextAttemptNumber:8});
});

test('in-progress attempts count as used but can be resumed before the limit check',()=>{
  const active={status:'in_progress',attemptNumber:1};
  assert.equal(attemptAllowance([active],1,false).exhausted,true);
  assert.equal(attemptAllowance([active],1,false).used,1);
});

test('submitted and expired attempts consume allowance, voided attempts do not',()=>{
  const usage=attemptAllowance([{status:'submitted',attemptNumber:1},{status:'voided',attemptNumber:2},{status:'expired',attemptNumber:3}],3,false);
  assert.deepEqual(usage,{used:2,remaining:1,unlimited:false,exhausted:false,nextAttemptNumber:4});
});

test('unlimited allowance is available only to an explicitly marked test quiz',()=>{
  assert.equal(isUnlimitedTestQuiz(true,0),true);
  assert.equal(isUnlimitedTestQuiz(false,0),false);
  assert.equal(canConfigureUnlimitedAttempts(false,0),false);
  assert.equal(canConfigureUnlimitedAttempts(true,0),true);
  assert.equal(canConfigureUnlimitedAttempts(false,1),true);
});
