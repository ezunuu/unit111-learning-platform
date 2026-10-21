import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import LoginPage from '../src/LoginPage.tsx';

test('redesigned login preserves credentials, reports errors, and supports password visibility',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{appearance:'light'}}}});
 let view!:ReactTestRenderer,fail=true,signedIn=0;const payloads:any[]=[];
 const api=async(path:string,options?:RequestInit)=>{assert.equal(path,'/auth/login');payloads.push(JSON.parse(options!.body as string));if(fail)throw Error('Нэвтрэх мэдээлэл буруу');return {csrfToken:'mock'}};
 try{
  await act(async()=>{view=create(<LoginPage api={api as any} onSignedIn={()=>{signedIn++}}/>)});
  await act(async()=>view.root.findByProps({id:'login-name'}).props.onChange({target:{value:' test-user '}}));
  await act(async()=>view.root.findByProps({id:'login-password'}).props.onChange({target:{value:' test-password '}}));
  await act(async()=>view.root.findByProps({'aria-label':'Нууц үг харуулах'}).props.onClick());assert.equal(view.root.findByProps({id:'login-password'}).props.type,'text');
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(view.root.findByProps({role:'alert'}).children[0],'Нэвтрэх мэдээлэл буруу');assert.equal(signedIn,0);
  fail=false;await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(signedIn,1);assert.deepEqual(payloads[1],{login:'test-user',password:' test-password '});
 }finally{if(view)await act(async()=>view.unmount());if(original)Object.defineProperty(globalThis,'document',original);else delete(globalThis as any).document}
});

test('registration uses only name/email/password and reset errors remain honest when email is unavailable',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{appearance:'light'}}}});
 let view!:ReactTestRenderer;const calls:{path:string;body:any}[]=[];
 const api=async(path:string,options?:RequestInit)=>{calls.push({path,body:JSON.parse(options!.body as string)});if(path==='/auth/forgot-password')throw Error('Одоогоор сэргээх и-мэйл илгээх боломжгүй.');return {ok:true}};
 const button=(text:string)=>view.root.findAllByType('button').find(n=>n.children.join('')===text)!;
 try{
  await act(async()=>{view=create(<LoginPage api={api as any} onSignedIn={()=>{}}/>)});
  await act(async()=>button('Бүртгэл үүсгэх').props.onClick());
  await act(async()=>view.root.findByProps({id:'register-name'}).props.onChange({target:{value:'Learner'}}));
  await act(async()=>view.root.findByProps({id:'login-name'}).props.onChange({target:{value:'learner@example.com'}}));
  await act(async()=>view.root.findByProps({id:'login-password'}).props.onChange({target:{value:'long learner password'}}));
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.deepEqual(calls[0],{path:'/auth/register',body:{fullName:'Learner',email:'learner@example.com',password:'long learner password'}});assert.ok(view.root.findByProps({role:'status'}));
  await act(async()=>button('Нууц үгээ мартсан уу?').props.onClick());assert.equal(view.root.findAllByProps({id:'login-password'}).length,0);
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.ok(view.root.findByProps({role:'alert'}).children.join('').includes('илгээх боломжгүй'));assert.deepEqual(calls[1].body,{email:'learner@example.com'});
 }finally{if(view)await act(async()=>view.unmount());if(original)Object.defineProperty(globalThis,'document',original);else delete(globalThis as any).document}
});
