import test from 'node:test';
import assert from 'node:assert/strict';
import {questionSimilarity,validateQuestionDraft} from './question-validation.js';

const base={questionText:'Нислэгийн үед ямар арга хэмжээ авах вэ?',questionType:'single_choice' as const,options:[{text:'Эхний сонголт'},{text:'Хоёр дахь сонголт'}],correctIndexes:[0]};
test('accepts a complete single choice question',()=>assert.equal(validateQuestionDraft(base),null));
test('rejects duplicate normalized options',()=>assert.match(validateQuestionDraft({...base,options:[{text:'Зөв.'},{text:' зөв '} ]})||'',/давхардсан/));
test('requires multiple correct answers for multiple choice',()=>assert.match(validateQuestionDraft({...base,questionType:'multiple_choice'})||'',/дор хаяж хоёр/));
test('requires exactly one true-false answer and two options',()=>assert.match(validateQuestionDraft({...base,questionType:'true_false',options:[{text:'Үнэн'},{text:'Худал'}],correctIndexes:[0,1]})||'',/нэг зөв/));
test('rejects correct indexes that do not point at an option',()=>assert.match(validateQuestionDraft({...base,correctIndexes:[2]})||'',/шалгана/));
test('detects likely near duplicates without deleting either question',()=>assert.ok(questionSimilarity('Нислэгийн үед ямар арга хэмжээ авах вэ?', 'Нислэгийн үед ямар арга хэмжээ авах ёстой вэ?')>0.6));
