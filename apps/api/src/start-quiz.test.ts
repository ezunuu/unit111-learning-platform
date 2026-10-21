import test from 'node:test';
import assert from 'node:assert/strict';
import {groupQuizQuestionRows} from './start-quiz.js';

test('quiz start payload groups options by question and preserves the row order',()=>{
  const payload=groupQuizQuestionRows([
    {question:{id:'q1',text:'one'},option:{id:'o1',text:'A'}},
    {question:{id:'q1',text:'one'},option:{id:'o2',text:'B'}},
    {question:{id:'q2',text:'two'},option:{id:'o3',text:'C'}},
  ],2);
  assert.deepEqual(payload,[
    {question:{id:'q1',text:'one'},options:[{id:'o1',text:'A'},{id:'o2',text:'B'}]},
    {question:{id:'q2',text:'two'},options:[{id:'o3',text:'C'}]},
  ]);
});

test('quiz start rejects a question set that does not match the configured count',()=>{
  assert.equal(groupQuizQuestionRows([{question:{id:'q1'},option:{id:'o1'}}],2),null);
});

test('quiz start rejects an empty attempt snapshot',()=>{
  assert.equal(groupQuizQuestionRows([],0),null);
});

test('quiz start rejects questions with no selectable options',()=>{
  assert.equal(groupQuizQuestionRows([{question:{id:'q1'},option:null}],1),null);
});
