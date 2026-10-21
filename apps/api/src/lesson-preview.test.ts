import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminLessonPreview, type PreviewQuestionInput } from './lesson-preview.js';

const lesson={id:'lesson-1',title:'Draft lesson',status:'draft'};
function item(order:number,status='published',sourceRevision:string|null='BK117 C-2 Manual rev. 2018') : PreviewQuestionInput {
  return {id:`q-${order}`,questionOrder:order,questionText:`Question ${order}`,questionType:'single_choice',difficulty:'medium',status,xp:10,explanation:'Explanation',sourceDocument:'01 - Fuselage.pdf',sourceRevision,sourceLocation:`02-${order}`,options:['A','B','C','D'].map((option,index)=>({id:`o-${order}-${index}`,optionText:option})),correctOptionIds:[`o-${order}-1`]};
}

test('admin preview keeps workbook order and exposes reviewer source and correct answer without changing draft status',()=>{
  const result=buildAdminLessonPreview(lesson,[item(2),item(1)]);
  assert.deepEqual(result.questions.map(question=>question.questionOrder),[1,2]);
  assert.equal(result.questions[0].correctOptionTexts[0],'B');
  assert.equal(result.questions[0].sourceDocument,'01 - Fuselage.pdf');
  assert.equal(result.questions[0].sourceLocation,'02-1');
  assert.equal(result.lesson.status,'draft');
  assert.equal(result.mode,'read_only_preview');
});

test('a draft or invalid question set cannot pass readiness',()=>{
  assert.equal(buildAdminLessonPreview(lesson,Array.from({length:10},(_,i)=>item(i,i===0?'draft':'published'))).review.readyToPublish,false);
  const missingAnswer=Array.from({length:10},(_,i)=>item(i));missingAnswer[0]={...missingAnswer[0],correctOptionIds:[]};
  assert.equal(buildAdminLessonPreview(lesson,missingAnswer).review.readyToPublish,false);
  assert.equal(buildAdminLessonPreview(lesson,[]).review.readyToPublish,false);
});

test('one to one hundred published questions with four options and one answer meet readiness',()=>{
  const result=buildAdminLessonPreview(lesson,Array.from({length:10},(_,i)=>item(i)));
  assert.equal(result.review.allPublished,true);
  assert.equal(result.review.readyToPublish,true);
  assert.equal(buildAdminLessonPreview(lesson,[item(0,'published',null)]).review.readyToPublish,true);
});

test('lesson readiness does not require source version when other checks pass',()=>{
  const result=buildAdminLessonPreview(lesson,Array.from({length:10},(_,i)=>item(i,'published',null)));
  assert.equal(result.review.readyToPublish,true);
});
