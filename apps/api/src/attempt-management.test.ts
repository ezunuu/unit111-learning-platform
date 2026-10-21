import test from 'node:test';
import assert from 'node:assert/strict';
import {canVoidAttempt,isAttemptTimeExpired} from './attempt-management.js';

test('only in-progress attempts can be voided',()=>{
  assert.equal(canVoidAttempt('in_progress'),true);
  assert.equal(canVoidAttempt('submitted'),false);
  assert.equal(canVoidAttempt('expired'),false);
  assert.equal(canVoidAttempt('voided'),false);
});

test('attempt expiry respects optional quiz time limits',()=>{
  const startedAt=new Date('2026-10-14T00:00:00Z');
  assert.equal(isAttemptTimeExpired(startedAt,null,new Date('2026-10-14T23:00:00Z')),false);
  assert.equal(isAttemptTimeExpired(startedAt,3600,new Date('2026-10-14T00:59:59Z')),false);
  assert.equal(isAttemptTimeExpired(startedAt,3600,new Date('2026-10-14T01:00:00Z')),true);
});
