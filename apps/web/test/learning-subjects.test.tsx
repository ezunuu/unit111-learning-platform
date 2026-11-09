import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {LearningSubjectProvider,AVIATION_SUBJECT,AVIATION_PILOT_SUBJECT} from '../src/LearningSubjects.tsx';
import {LearningPath} from '../src/LearningDashboard.tsx';

test('subject selection filters the real learning path and survives returning to the page',async()=>{
 const savedStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
 const pilot=AVIATION_PILOT_SUBJECT,requests:string[]=[];
 const api=async(path:string)=>{requests.push(path);if(path==='/learning/subjects')return {items:[{id:'11100000-0000-4000-8000-000000000003',parentId:null,title:'Цэргийн дүрэм',icon:'shield',sortOrder:0,lessonCount:0},{id:'11100000-0000-4000-8000-000000000002',parentId:null,title:'Улсийн нисэхийн хууль',icon:'book',sortOrder:1,lessonCount:0},{id:AVIATION_SUBJECT,parentId:null,title:'Нисэхийн мэдлэг',icon:'plane',sortOrder:2,lessonCount:5},{id:pilot,parentId:AVIATION_SUBJECT,title:'Нисгэгч',icon:'plane',sortOrder:0,lessonCount:0},{id:'11100000-0000-4000-8000-000000000005',parentId:AVIATION_SUBJECT,title:'Инженер',icon:'layers',sortOrder:1,lessonCount:5}]};return {items:[],courses:[],summary:{completedLessons:0,totalLessons:0,xp:0,currentStreak:0,todayActivityCount:0,weeklyActiveDays:0,weeklyXp:0}}};
 let view!:ReactTestRenderer;const clients:QueryClient[]=[];
 async function settle(){for(let i=0;i<3;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})}
 async function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);await act(async()=>{view=create(<MemoryRouter><QueryClientProvider client={client}><LearningSubjectProvider><LearningPath api={api as any}/></LearningSubjectProvider></QueryClientProvider></MemoryRouter>)});await settle()}
 try{
  await mount();assert.ok(requests.includes('/learning/path?subjectId='+AVIATION_SUBJECT));assert.ok(JSON.stringify(view.toJSON()).includes('Нисгэгч'));assert.ok(JSON.stringify(view.toJSON()).includes('Инженер'));
  const choice=view.root.findAllByType('button').find(node=>node.props.className?.includes('subject-choice')&&JSON.stringify(node.findAllByType('b')[0]?.children).includes('Нисгэгч'))!;assert.ok(choice);
  await act(async()=>choice.props.onClick());await settle();
  assert.ok(requests.includes('/learning/path?subjectId='+pilot));assert.ok(JSON.stringify(view.toJSON()).includes('Энэ чиглэлийн агуулга бэлтгэгдэж байна'));
  assert.equal(values.get('unit111-learning-subject-v2'),pilot);
  await act(async()=>view.unmount());await mount();
  const selected=view.root.findAllByType('button').filter(node=>node.props.className?.includes('subject-child')&&node.props['aria-pressed']===true);assert.equal(selected.length,1);assert.ok(JSON.stringify(selected[0].findByType('b').children).includes('Нисгэгч'));
 }finally{if(view)await act(async()=>view.unmount());clients.forEach(client=>client.clear());if(savedStorage)Object.defineProperty(globalThis,'localStorage',savedStorage);else delete(globalThis as any).localStorage}
});
