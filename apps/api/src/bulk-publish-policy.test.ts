import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonPublishReasons, questionPublishReasons } from './bulk-publish-policy.js';

const validQuestion = { id: 'q', status: 'approved', questionText: 'BK117 fuselage inspection question?', questionType: 'single_choice' as const, explanation: 'Refer to the specified manual section.', sourceDocument: 'BK117 C-2 Manual', sourceRevision: 'Revision 2018', sourceLocation: 'Chapter 1, page 3', options: ['A', 'B', 'C', 'D'].map((text, index) => ({ id: String(index), text })), correctOptionIds: ['0'] };
test('admin question bulk publish allows draft and missing optional metadata while retaining answer and option gates', () => {
  assert.deepEqual(questionPublishReasons(validQuestion), []);
  assert.deepEqual(questionPublishReasons({ ...validQuestion, sourceRevision: null }), []);
  assert.deepEqual(questionPublishReasons({ ...validQuestion, sourceRevision: '   ' }), []);
  assert.deepEqual(questionPublishReasons({ ...validQuestion, status: 'draft', sourceDocument:null, sourceLocation:null, explanation:'' }), []);
  assert.ok(questionPublishReasons({ ...validQuestion, status: 'archived' }).some(reason => reason.includes('Архивласан')));
  assert.ok(questionPublishReasons({ ...validQuestion, options: validQuestion.options.slice(0, 3) }).some(reason => reason.includes('Яг 4')));
  assert.ok(questionPublishReasons({ ...validQuestion, correctOptionIds: [] }).some(reason => reason.includes('Зөв хариултын сонголтыг шалгана')));
});

test('lesson publish allows one to one hundred published linked questions and reports blockers', () => {
  const ten = Array.from({ length: 10 }, (_, index) => ({ id: `q${index}`, status: 'published' }));
  assert.deepEqual(lessonPublishReasons({ id: 'l', title: 'Lesson 1', status: 'draft', trainingQuizLinked:true, linkedQuestions: ten }), { reasons: [], blockingQuestionIds: [], blockingQuestions:[] });
  assert.deepEqual(lessonPublishReasons({ id: 'l', title: 'Lesson 1', status: 'draft', trainingQuizLinked:false, linkedQuestions: ten }).reasons, []);
  const result = lessonPublishReasons({ id: 'l', title: 'Lesson 1', status: 'draft', trainingQuizLinked:true, linkedQuestions: ten.map((question, index) => index === 4 ? { ...question, status: 'draft' } : question) });
  assert.deepEqual(result.blockingQuestionIds, ['q4']);
  assert.deepEqual(result.blockingQuestions, [{id:'q4',reason:'Нийтлэгдээгүй (төлөв: draft).'}]);
  assert.ok(result.reasons.some(reason => reason.includes('нийтлэгдээгүй')));
  assert.ok(lessonPublishReasons({ id: 'l', title: 'Lesson 1', status: 'draft', trainingQuizLinked:false, linkedQuestions: [] }).reasons.some(reason => reason.includes('1–100')));
});

test('lesson publication checks theory and invalid answers as well as published status',()=>{
 const lesson={id:'l',title:'Draft',status:'draft',trainingQuizLinked:false,linkedQuestions:[{id:'q',status:'published'}]};
 assert.ok(lessonPublishReasons({...lesson,theoryRequired:true,contentBlockStatuses:[]}).reasons.some(reason=>reason.includes('блок алга')));
 assert.ok(lessonPublishReasons({...lesson,contentBlockStatuses:['draft']}).reasons.some(reason=>reason.includes('баталгаажуулна')));
 assert.deepEqual(lessonPublishReasons({...lesson,theoryRequired:true,contentBlockStatuses:['approved']}).reasons,[]);
 const invalid=lessonPublishReasons({...lesson,linkedQuestions:[{id:'q',status:'published',validationError:'Missing answer'}]});
 assert.equal(invalid.blockingQuestions[0].reason,'Missing answer');assert.ok(invalid.reasons.length);
});
