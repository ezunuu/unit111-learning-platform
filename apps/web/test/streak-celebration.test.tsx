import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act,type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import StreakCelebration,{streakTransition} from '../src/StreakCelebration.tsx';

test('streak celebration waits for a new active day and never repeats a celebrated date',()=>{
 const baseline=streakTransition(null,'2026-10-20',4,0);assert.equal(baseline.celebrate,false);
 const next=streakTransition(baseline.snapshot,'2026-10-20',5,1);assert.equal(next.celebrate,true);
 assert.equal(streakTransition(next.snapshot,'2026-10-20',5,2).celebrate,false);
 assert.equal(streakTransition(next.snapshot,'2026-10-21',5,0).celebrate,false);
 assert.equal(streakTransition(next.snapshot,'2026-10-21',6,1).celebrate,true);
 assert.equal(streakTransition(null,'2026-10-20',5,1).celebrate,false);
 assert.equal(streakTransition(next.snapshot,'2026-10-21',0,0).celebrate,false);
});

test('streak growth shows a dismissible celebration without writes and stays dismissed after remount',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),storage=new Map<string,string>();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}});
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});let view!:ReactTestRenderer;
 const summary=(currentStreak:number,todayActivityCount:number)=>({summary:{activityDate:'2026-10-20',currentStreak,todayActivityCount}});
 client.setQueryData(['learning-path',''],summary(4,0));const calls:string[]=[];
 const api=async(path:string)=>{calls.push(path);return summary(4,0)};
 const mount=async()=>{await act(async()=>{view=create(<QueryClientProvider client={client}><StreakCelebration userId="test-user" api={api as any}/></QueryClientProvider>)})};
 try{
  await mount();assert.equal(view.toJSON(),null);
  await act(async()=>{client.setQueryData(['learning-path',''],summary(5,1));await new Promise(r=>setTimeout(r,0))});
  assert.equal(view.root.findAllByProps({role:'status'}).length,1);assert.ok(JSON.stringify(view.toJSON()).includes('өдрийн цуврал!'));
  await act(async()=>view.root.findByType('button').props.onClick());assert.equal(view.toJSON(),null);
  await act(async()=>view.unmount());await mount();assert.equal(view.toJSON(),null);
  assert.ok(storage.get('unit111-streak-celebration:test-user')?.includes('2026-10-20'));assert.equal(calls.length,0);
 }finally{if(view)await act(async()=>view.unmount());client.clear();if(original)Object.defineProperty(globalThis,'localStorage',original);else delete(globalThis as any).localStorage}
});
