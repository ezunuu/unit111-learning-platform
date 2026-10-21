import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifiedTestDatabaseBackup} from './test-quiz-backup.js';

test('backup refuses non-test database targets before invoking pg_dump',async()=>{
  await assert.rejects(createVerifiedTestDatabaseBackup('postgres://test@example.invalid/production','00000000-0000-4000-8000-000000000000'),/TEST_DATABASE_ONLY/);
});
