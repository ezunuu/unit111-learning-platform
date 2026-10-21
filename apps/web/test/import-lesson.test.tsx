import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import QuestionImport from '../src/QuestionImport.tsx';

test('CSV upload can create a lesson in the chosen chapter, with no partial request for missing placement',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});let view!:ReactTestRenderer;const imports:any[]=[];
 const api=async(path:string,options?:RequestInit)=>{
  if(path==='/admin/subjects')return {items:[{id:'aviation',title:'Нисэхийн мэдлэг'},{id:'military',title:'Цэргийн дүрэм'}]};
  if(path==='/admin/courses')return {items:[{id:'bk117',subjectId:'aviation',title:'BK117 C-2',status:'published',chapters:[{id:'general',title:'00 — General',status:'published'},{id:'archived',title:'Archived',status:'archived'}]}]};
  if(path==='/questions/import/preview')return {rows:[],readyCount:1};
  if(path==='/questions/import'){imports.push(JSON.parse(options!.body as string));return {count:1,status:'draft',lessonId:'new-lesson'}};
  throw Error(path);
 };
 const settle=async()=>{for(let i=0;i<3;i++)await act(async()=>{await new Promise(r=>setTimeout(r,0))})};
 const button=(text:string)=>view.root.findAllByType('button').find(n=>n.children.join('')===text)!;
 try{
  await act(async()=>{view=create(<MemoryRouter><QueryClientProvider client={client}><QuestionImport api={api as any} categories={[{id:'category',name:'General'}]}/></QueryClientProvider></MemoryRouter>)});
  const csv='category,questionText,questionType,difficulty,options,correctIndexes,explanation\nGeneral,Uploaded independent question,single_choice,medium,A response|B response|C response|D response,2,Learning note';
  await act(async()=>view.root.findByProps({type:'file'}).props.onChange({target:{files:[{name:'questions.csv',arrayBuffer:async()=>new TextEncoder().encode(csv).buffer}]}}));await settle();
  await act(async()=>view.root.findAllByProps({type:'checkbox'}).find(n=>typeof n.props.onChange==='function')!.props.onChange({target:{checked:true}}));await settle();
  await act(async()=>button('1 мөрийг давхардалтай тулгаж шалгах').props.onClick());await settle();
  await act(async()=>button('1 асуулттай хичээл үүсгэх').props.onClick());assert.equal(imports.length,0);
  const selects=()=>view.root.findAllByType('select');
  // Category selector is first; lesson placement selectors follow it.
  await act(async()=>selects()[1].props.onChange({target:{value:'aviation'}}));
  await act(async()=>selects()[2].props.onChange({target:{value:'bk117'}}));
  assert.ok(!JSON.stringify(selects()[3].children.map(n=>typeof n==='string'?n:n.props)).includes('Archived'));
  await act(async()=>selects()[3].props.onChange({target:{value:'general'}}));
  await act(async()=>view.root.findByProps({placeholder:'Жишээ: Ерөнхий танилцуулга'}).props.onChange({target:{value:'General introduction'}}));
  await act(async()=>button('1 асуулттай хичээл үүсгэх').props.onClick());await settle();
  assert.equal(imports.length,1);assert.deepEqual(imports[0].lesson,{title:'General introduction',chapterId:'general'});assert.equal(imports[0].questions[0].explanation,'Learning note');assert.equal(imports[0].questions[0].correctIndexes[0],2);
  assert.ok(JSON.stringify(view.toJSON()).includes('1 асуулттай ноорог хичээл үүслээ.'));
 }finally{if(view)await act(async()=>view.unmount());client.clear()}
});

test('chapter and lesson columns create a grouped plan while the old single-lesson import remains available',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});let view!:ReactTestRenderer;let payload:any;
 const api=async(path:string,options?:RequestInit)=>{
  if(path==='/admin/subjects')return {items:[{id:'aviation',title:'Нисэхийн мэдлэг'}]};
  if(path==='/admin/courses')return {items:[{id:'bk117',subjectId:'aviation',title:'BK117 C-2',status:'published',chapters:[{id:'general',title:'00 — General',status:'published'}]}]};
  if(path==='/questions/import/preview')return {rows:[],readyCount:3};
  if(path==='/questions/import'){payload=JSON.parse(options!.body as string);return {count:3,status:'draft',lessonId:null,createdLessons:[{id:'a',title:'Basics',chapterTitle:'00 — General',questionCount:2},{id:'b',title:'Structure',chapterTitle:'01 — Fuselage',questionCount:1}]}}
  throw Error(path);
 };
 const settle=async()=>{for(let i=0;i<3;i++)await act(async()=>{await new Promise(r=>setTimeout(r,0))})};
 const button=(label:string)=>view.root.findAllByType('button').find(n=>n.children.join('')===label)!;
 try{
  await act(async()=>{view=create(<MemoryRouter><QueryClientProvider client={client}><QuestionImport api={api as any} categories={[{id:'cat',name:'General'}]}/></QueryClientProvider></MemoryRouter>)});
  const csv='category,questionText,questionType,options,correctIndexes,Бүлэг,Хичээл\nGeneral,First independent question here,single_choice,A|B|C|D,0,00 — General,Basics\nGeneral,Unrelated technical knowledge question,single_choice,A|B|C|D,1,00 — General,Basics\nGeneral,Another entirely different item,single_choice,A|B|C|D,2,01 — Fuselage,Structure';
  await act(async()=>view.root.findByProps({type:'file'}).props.onChange({target:{files:[{name:'grouped.csv',arrayBuffer:async()=>new TextEncoder().encode(csv).buffer}]}}));await settle();
  const selects=()=>view.root.findAllByType('select');await act(async()=>selects()[1].props.onChange({target:{value:'aviation'}}));await act(async()=>selects()[2].props.onChange({target:{value:'bk117'}}));
  assert.ok(view.root.findByType('h4').children.join('').includes('2 хичээл'));assert.equal(selects().length,3);
  await act(async()=>button('3 мөрийг давхардалтай тулгаж шалгах').props.onClick());await settle();
  await act(async()=>button('2 хичээл үүсгэх').props.onClick());await settle();
  assert.deepEqual(payload.lessonGroups,{courseId:'bk117',groups:[{chapterTitle:'00 — General',lessonTitle:'Basics',questionIndexes:[0,1]},{chapterTitle:'01 — Fuselage',lessonTitle:'Structure',questionIndexes:[2]}]});assert.equal(payload.lesson,undefined);
  assert.ok(JSON.stringify(view.toJSON()).includes('3 асуулттай 2 ноорог хичээл үүслээ.'));
 }finally{if(view)await act(async()=>view.unmount());client.clear()}
});
