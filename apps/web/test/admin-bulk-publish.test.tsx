import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import AdminManagement from '../src/AdminManagement.tsx';

test('bulk publish opens a visible preview, submits only ready questions, and keeps errors visible for retry',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});let view!:ReactTestRenderer;let failPublish=true;const submissions:any[]=[];
 const api=async(path:string,options?:RequestInit)=>{
  if(path==='/questions/bulk-publish/preview')return {total:2,readyCount:1,blockedCount:1,items:[{id:'draft',questionText:'Draft test question',status:'draft',ready:true,reasons:[]},{id:'published',questionText:'Published test question',status:'published',ready:false,reasons:['Аль хэдийн нийтлэгдсэн.']}]};
  if(path==='/questions/bulk-publish'){submissions.push(JSON.parse(options!.body as string));if(failPublish)throw Error('Тест серверийн алдаа');return {publishedCount:1,publishedIds:['draft'],blockedCount:0,blocked:[]}}
  if(path.startsWith('/questions?'))return {items:[{id:'draft',questionText:'Draft test question',status:'draft'},{id:'published',questionText:'Published test question',status:'published'}],total:2,page:1,limit:25};
  return {items:[]};
 };
 const settle=async()=>{for(let i=0;i<3;i++)await act(async()=>{await new Promise(r=>setTimeout(r,0))})};
 const button=(text:string)=>view.root.findAllByType('button').find(n=>n.children.join('')===text)!;
 try{
  await act(async()=>{view=create(<MemoryRouter><QueryClientProvider client={client}><AdminManagement api={api as any}/></QueryClientProvider></MemoryRouter>)});await settle();
  await act(async()=>button('Энэ хуудсыг сонгох').props.onClick());
  await act(async()=>button('Сонгосон асуултуудыг нийтлэх…').props.onClick());await settle();
  assert.equal(view.root.findAllByProps({role:'dialog'}).length,1);
  assert.ok(JSON.stringify(view.root.findByProps({role:'dialog'}).toJSON?.()??view.toJSON()).includes('Аль хэдийн нийтлэгдсэн.'));
  await act(async()=>button('1 асуултыг нийтлэх').props.onClick());await settle();
  assert.ok(view.root.findByProps({role:'dialog'}).findAllByProps({role:'alert'}).length);
  assert.deepEqual(submissions[0],{items:[{questionId:'draft',verificationNote:null}]});
  failPublish=false;await act(async()=>button('1 асуултыг нийтлэх').props.onClick());await settle();
  assert.equal(view.root.findAllByProps({role:'dialog'}).length,0);assert.ok(JSON.stringify(view.toJSON()).includes('1 асуулт нийтлэгдлээ.'));
 }finally{if(view)await act(async()=>view.unmount());client.clear()}
});
