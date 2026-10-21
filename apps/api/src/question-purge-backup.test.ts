import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackupForEligibleQuestionPurge} from './question-purge-backup.js';

test('does not create a backup when every selected question is protected',async()=>{
  let called=false;
  const result=await createBackupForEligibleQuestionPurge([{id:'a',canDelete:false},{id:'b',canDelete:false}],async()=>{called=true;return'backup'});
  assert.deepEqual(result,{kind:'none_eligible',eligibleIds:[]});
  assert.equal(called,false);
});

test('creates and returns a verified backup only for a selection with eligible questions',async()=>{
  const result=await createBackupForEligibleQuestionPurge([{id:'a',canDelete:true},{id:'b',canDelete:false}],async()=>({verified:true}));
  assert.deepEqual(result,{kind:'verified',eligibleIds:['a'],backup:{verified:true}});
});

test('backup errors prevent a verified result',async()=>{
  await assert.rejects(createBackupForEligibleQuestionPurge([{id:'a',canDelete:true}],async()=>{throw new Error('backup failed')}),/backup failed/);
});
