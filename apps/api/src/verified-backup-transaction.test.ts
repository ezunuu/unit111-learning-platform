import test from 'node:test';
import assert from 'node:assert/strict';
import {runAfterVerifiedBackup} from './verified-backup-transaction.js';

test('a backup failure prevents the transaction from running',async()=>{
  let transactionRan=false;
  await assert.rejects(runAfterVerifiedBackup(async()=>{throw new Error('backup failed')},async()=>{transactionRan=true;return'committed';}),/backup failed/);
  assert.equal(transactionRan,false);
});

test('transaction errors propagate after verified backup and are left to the transaction to roll back',async()=>{
  let backupVerified=false;
  await assert.rejects(runAfterVerifiedBackup(async()=>{backupVerified=true;return'verified'},async()=>{throw new Error('transaction failed');}),/transaction failed/);
  assert.equal(backupVerified,true);
});
