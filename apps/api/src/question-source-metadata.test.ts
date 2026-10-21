import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeSourceMetadata,type SourceMetadata} from './question-source-metadata.js';

const current:SourceMetadata={sourceDocument:'BK117 C-2 CAT B1 / Fuselage',sourceRevision:null,sourceSection:null,sourceLocation:'02-4'};

test('bulk metadata fills missing fields but protects existing values by default',()=>{
  const result=mergeSourceMetadata(current,{sourceRevision:'Revision 8',sourceLocation:'02-5',sourceSection:'Fuselage'},false);
  assert.deepEqual(result.updated,{sourceRevision:'Revision 8',sourceSection:'Fuselage'});
  assert.deepEqual(result.protectedFields,['sourceLocation']);
  assert.deepEqual(result.unchanged,[]);
});

test('overwrite is limited to fields explicitly selected by the administrator',()=>{
  const result=mergeSourceMetadata(current,{sourceRevision:'Revision 8'},true);
  assert.deepEqual(result.updated,{sourceRevision:'Revision 8'});
  assert.deepEqual(result.protectedFields,[]);
  const updated:Partial<SourceMetadata>=result.updated;
  assert.equal(updated.sourceDocument,undefined);
  assert.equal(updated.sourceLocation,undefined);
});

test('identical metadata is reported unchanged rather than rewritten',()=>{
  const result=mergeSourceMetadata(current,{sourceDocument:'BK117 C-2 CAT B1 / Fuselage'},true);
  assert.deepEqual(result.unchanged,['sourceDocument']);
  assert.deepEqual(result.updated,{});
});
