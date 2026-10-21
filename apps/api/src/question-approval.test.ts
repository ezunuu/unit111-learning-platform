import test from 'node:test';
import assert from 'node:assert/strict';
import {canApproveQuestion} from './question-approval.js';

test('administrator can approve their own pending question',()=>{
  assert.equal(canApproveQuestion({id:'admin-1',role:'admin'},{status:'pending_review',createdBy:'admin-1'}),true);
});

test('ordinary user cannot approve their own pending question',()=>{
  assert.equal(canApproveQuestion({id:'employee-1',role:'employee'},{status:'pending_review',createdBy:'employee-1'}),false);
});

test('administrator can approve another user’s pending question',()=>{
  assert.equal(canApproveQuestion({id:'admin-1',role:'admin'},{status:'pending_review',createdBy:'employee-1'}),true);
});

test('an already approved question cannot be approved again',()=>{
  assert.equal(canApproveQuestion({id:'admin-1',role:'admin'},{status:'approved',createdBy:'admin-1'}),false);
});
