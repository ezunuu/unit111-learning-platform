import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTheoryProgress, theoryContentVersion } from './lesson-theory-policy.js';

test('theory progress is sequential and completion is only allowed on the final block', () => {
  assert.deepEqual(advanceTheoryProgress(-1, 0, 2, false), { ok: true, maxViewedOrder: 0, completed: false });
  assert.deepEqual(advanceTheoryProgress(0, 2, 2, true), { ok: false, reason: 'sequence' });
  assert.deepEqual(advanceTheoryProgress(1, 2, 2, true), { ok: true, maxViewedOrder: 2, completed: true });
  assert.deepEqual(advanceTheoryProgress(2, 3, 2, true), { ok: false, reason: 'invalid' });
});

test('theory content version changes when reviewer approved content changes', () => {
  const first = [{ id: 'a', blockOrder: 0, blockType: 'text', content: { text: 'A' }, updatedAt: '2026-01-01T00:00:00.000Z' }];
  assert.equal(theoryContentVersion(first), theoryContentVersion(first));
  assert.notEqual(theoryContentVersion(first), theoryContentVersion([{ ...first[0], content: { text: 'B' } }]));
});
