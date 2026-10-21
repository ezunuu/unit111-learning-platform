import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create, act, type ReactTestRenderer} from 'react-test-renderer';
import {MemoryRouter, Routes, Route, useNavigate} from 'react-router-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import LearningLessonPlayer from '../src/LearningLessonPlayer.tsx';

const question={id:'q1',text:'Fixture question',type:'single_choice',xp:10,options:[{id:'right',text:'Right'},{id:'wrong',text:'Wrong'}]};
function pack(id:string,mode:'lesson'|'review',status='in_progress'){
 return {attempt:{id,mode,status,currentQuestionOrder:status==='in_progress'?0:1,correctCount:status==='in_progress'?0:1,earnedXp:0},lesson:{id:'lesson',title:'Fixture lesson',lessonOrder:1},questions:[question],answers:status==='in_progress'?[]:[{questionId:'q1',selectedOptionIds:['right'],isCorrect:true}]};
}
function textOf(node:any):string{return typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(textOf).join(''):node?.children?textOf(node.children):node?.props?.children?textOf(node.props.children):''}
async function mount(initial:string,api:any){
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 let navigate:any;let view!:ReactTestRenderer;
 function Harness(){navigate=useNavigate();return <Routes><Route path="/lesson/:id" element={<LearningLessonPlayer api={api}/>}/><Route path="/learning-review/:id" element={<LearningLessonPlayer api={api}/>}/></Routes>}
 await act(async()=>{view=create(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]} future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Harness/></MemoryRouter></QueryClientProvider>)});
 const click=async(label:string)=>{const button=view.root.findAllByType('button').find(item=>textOf(item.props.children).trim()===label);assert.ok(button,`missing button ${label}`);assert.ok(!button.props.disabled,`disabled ${label}`);await act(async()=>{button.props.onClick()})};
 return {view,click,navigate:async(path:string)=>{await act(async()=>{navigate(path)})},close:async()=>{await act(async()=>{view.unmount()});client.clear()}};
}

test('wrong answer → mini lesson → Retry clears old feedback without a page reload; review grants no preview XP',async()=>{
 let reviewNumber=0;
 const api=async(path:string,options?:RequestInit)=>{
  if(path.endsWith('/theory'))return {ready:false,theoryRequired:false};
  if(path==='/learning/lessons/lesson/start')return pack('lesson-attempt','lesson');
  if(path==='/learning/review-queue/start')return pack(`review-${++reviewNumber}`,'review');
  if(path.startsWith('/learning/attempts/')&&path.endsWith('/answer')){
   const correct=JSON.parse(options!.body as string).optionIds[0]==='right';
   return {correct,correctOptionTexts:['Right'],explanation:'Verified explanation',xpPotential:path.includes('review-')?0:correct?10:0};
  }
  if(path.startsWith('/learning/attempts/'))return pack(path.split('/')[3],'review');
  throw Error(`unexpected ${path}`);
 };
 const ui=await mount('/lesson/lesson',api);
 try{
  await ui.click('BWrong');await ui.click('Шалгах');await ui.click('Хичээлээ үзэх');
  assert.equal(ui.view.root.findAllByProps({'aria-label':'Асуултын богино хичээл'}).length,1);
  await ui.click('Дахин оролдох');
  assert.equal(ui.view.root.findByProps({'aria-label':'Сорилын ахиц'}).props['aria-valuenow'],0);
  assert.ok(!textOf(ui.view.toJSON()).includes('Буруу хариуллаа!'));
  assert.equal(ui.view.root.findAllByProps({'aria-label':'Асуултын богино хичээл'}).length,0);
  await ui.click('BWrong');await ui.click('Шалгах');await ui.click('Дахин оролдох');
  assert.equal(reviewNumber,2);assert.equal(ui.view.root.findByProps({'aria-label':'Сорилын ахиц'}).props['aria-valuenow'],0);
  await ui.click('ARight');await ui.click('Шалгах');
  const badge=ui.view.root.findByProps({className:'quiz-xp-badge'});
  assert.equal(textOf(badge.props.children),'0 XP боломж');
 }finally{await ui.close()}
});

test('refresh of completed review restores saved result instead of offering another completion',async()=>{
 const ui=await mount('/learning-review/done',async()=>pack('done','review','review_completed'));
 try{const text=textOf(ui.view.toJSON());assert.ok(text.includes('Сайн давтлаа!'));assert.ok(text.includes('100%'));assert.ok(!text.includes('Дүн гаргах'))}finally{await ui.close()}
});

test('a delayed lesson start cannot replace a newer review route',async()=>{
 let finish!:(value:any)=>void;
 const waiting=new Promise(resolve=>{finish=resolve});
 const ui=await mount('/lesson/lesson',async(path:string)=>{
  if(path.endsWith('/theory'))return {ready:false,theoryRequired:false};
  if(path.endsWith('/start'))return waiting;
  return pack('new-review','review');
 });
 try{
  await ui.navigate('/learning-review/new-review');
  await act(async()=>{finish({...pack('old-lesson','lesson'),lesson:{id:'old',title:'OLD LESSON',lessonOrder:1}})});
  const text=textOf(ui.view.toJSON());assert.ok(text.includes('ДАВТЛАГЫН ГОРИМ'));assert.ok(!text.includes('OLD LESSON'));
 }finally{await ui.close()}
});

test('a failed answer request preserves selection and allows retry without advancing',async()=>{
 let requests=0;
 const ui=await mount('/learning-review/network',async(path:string)=>{
  if(path.endsWith('/answer')){if(++requests===1)throw Error('Connection interrupted');return {correct:true,correctOptionTexts:['Right'],explanation:'Verified explanation',xpPotential:0}}
  return pack('network','review');
 });
 try{
  await ui.click('ARight');await ui.click('Шалгах');
  assert.ok(textOf(ui.view.toJSON()).includes('Connection interrupted'));
  assert.equal(ui.view.root.findByProps({'aria-label':'Сорилын ахиц'}).props['aria-valuenow'],0);
  await ui.click('Шалгах');
  assert.equal(requests,2);assert.ok(textOf(ui.view.toJSON()).includes('Зөв хариуллаа!'));
  assert.equal(ui.view.root.findByProps({'aria-label':'Сорилын ахиц'}).props['aria-valuenow'],100);
 }finally{await ui.close()}
});
