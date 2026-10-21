import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import LessonPublicationPreview from '../src/LessonPublicationPreview.tsx';

test('lesson preview walks through theory and feedback without learning writes, then handles mocked publication failures',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});let view!:ReactTestRenderer;const requests:{path:string;options?:RequestInit}[]=[];let published=false,fail=true;
 const api=async(path:string,options?:RequestInit)=>{requests.push({path,options});
  if(path==='/lessons/lesson/preview')return {lesson:{id:'lesson',title:'General preview',status:published?'published':'draft',description:'Short introduction',content:''},contentBlocks:[{id:'block',blockOrder:0,blockType:'text',content:{text:'Theory content'},reviewStatus:'approved'}],placement:{courseTitle:'BK117',chapterTitle:'General',courseStatus:'published',chapterStatus:'published'},questions:[{id:'q',questionText:'Preview test question?',questionType:'single_choice',status:'published',options:[{id:'a',optionText:'Correct choice'},{id:'b',optionText:'Other choice'}],correctOptionIds:['a'],correctOptionTexts:['Correct choice'],explanation:'Explanation content'}],review:{readyToPublish:!published,reasons:[],blockingQuestions:[]}};
  if(path==='/lessons/bulk-publish'){assert.deepEqual(JSON.parse(options!.body as string),{lessonIds:['lesson']});if(fail)throw Error('Mock network failure');published=true;return {publishedCount:1,blocked:[]}}
  throw Error('Unexpected request '+path);
 };
 const settle=async()=>{for(let i=0;i<3;i++)await act(async()=>{await new Promise(r=>setTimeout(r,0))})};
 const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?text(node.children):'';
 const button=(label:string)=>view.root.findAllByType('button').find(n=>text(n.children)===label)!;
 try{
  await act(async()=>{view=create(<MemoryRouter><QueryClientProvider client={client}><LessonPublicationPreview id="lesson" api={api as any} categories={[]} onClose={()=>{}} onEditLesson={()=>{}}/></QueryClientProvider></MemoryRouter>)});await settle();
  assert.ok(JSON.stringify(view.toJSON()).includes('Theory content'));
  await act(async()=>button('Дадлага эхлүүлэх ').props.onClick());
  await act(async()=>view.root.findAllByType('button').find(n=>text(n.children).includes('Correct choice'))!.props.onClick());
  await act(async()=>button('Хариултыг шалгах').props.onClick());assert.ok(JSON.stringify(view.toJSON()).includes('Explanation content'));
  await act(async()=>button('Дуусгах').props.onClick());assert.ok(JSON.stringify(view.toJSON()).includes('Бодит оноо, XP, ахиц хадгалаагүй.'));
  assert.ok(requests.every(r=>!r.options?.method||r.options.method==='GET'));
  await act(async()=>button('Хичээлийг нийтлэх').props.onClick());await settle();assert.ok(JSON.stringify(view.toJSON()).includes('Mock network failure'));
  fail=false;await act(async()=>button('Хичээлийг нийтлэх').props.onClick());await settle();assert.ok(JSON.stringify(view.toJSON()).includes('Хичээл нийтлэгдлээ.'));
  assert.ok(!requests.some(r=>r.path.includes('/learning/')||r.path.includes('/start')));
 }finally{if(view)await act(async()=>view.unmount());client.clear()}
});
