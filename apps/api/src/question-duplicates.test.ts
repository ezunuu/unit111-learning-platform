import test from 'node:test';
import assert from 'node:assert/strict';
import {groupDuplicateQuestions,normalizeQuestionText} from './question-duplicates.js';

test('normalization folds Unicode compatibility forms, case, zero-width marks, and whitespace',()=>{
  assert.equal(normalizeQuestionText('  BK117　 Ｃ－２\u200b  '),normalizeQuestionText('bk117 c-2'));
});

test('duplicate grouping includes only pending review questions with equal normalized text',()=>{
  const groups=groupDuplicateQuestions([
    {id:'a',questionText:'BK117-ийн системийн тухай юу вэ?',status:'pending_review'},
    {id:'b',questionText:'  bk117-ийн　системийн тухай юу вэ? ',status:'pending_review'},
    {id:'c',questionText:'BK117-ийн системийн тухай юу вэ?',status:'published'},
    {id:'d',questionText:'Өөр асуулт байна',status:'pending_review'},
  ]);
  assert.equal(groups.length,1);
  assert.deepEqual(groups[0].items.map(item=>item.id),['a','b']);
});
