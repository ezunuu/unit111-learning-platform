import test from 'node:test';
import assert from 'node:assert/strict';
import express,{type Request} from 'express';
import {once} from 'node:events';
import {createQuizStartRouter} from './quiz-start-router.js';

test('attempt exhaustion response explains the cap and remaining count',async t=>{
  const start=async()=>({kind:'attempts_exhausted' as const,used:2,limit:2,remaining:0});
  const app=express();app.use((req:Request,_res,next)=>{req.user={id:'user-id',username:'learner',fullName:'Learner',role:'employee',mustChangePassword:false};next()});app.use(createQuizStartRouter(start as never));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.close();await once(server,'close')});
  const address=server.address();assert.ok(address&&typeof address==='object');
  const response=await fetch(`http://127.0.0.1:${address.port}/quizzes/quiz-id/start`,{method:'POST'});
  assert.equal(response.status,409);const body=await response.json() as {error:{code:string;message:string;remainingAttempts:number}};
  assert.equal(body.error.code,'ATTEMPTS_EXHAUSTED');assert.equal(body.error.remainingAttempts,0);assert.match(body.error.message,/2\/2/);assert.match(body.error.message,/Үлдсэн оролдлого: 0/);
});

test('resumed attempt is returned as HTTP 200 and marked as resumed',async t=>{
  const now=new Date().toISOString();
  const start=async()=>({kind:'resumed' as const,attempt:{id:'attempt-id',startedAt:now},quiz:{id:'quiz-id',title:'Quiz',timeLimitSeconds:null},questions:[{id:'question-id',text:'Question',type:'single_choice',options:[{id:'option-id',text:'Option'}]}]});
  const app=express();app.use((req:Request,_res,next)=>{req.user={id:'user-id',username:'learner',fullName:'Learner',role:'employee',mustChangePassword:false};next()});app.use(createQuizStartRouter(start as never));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.close();await once(server,'close')});
  const address=server.address();assert.ok(address&&typeof address==='object');
  const response=await fetch(`http://127.0.0.1:${address.port}/quizzes/quiz-id/start`,{method:'POST'});
  assert.equal(response.status,200);const body=await response.json() as {attempt:{id:string;resumed:boolean}};
  assert.deepEqual(body.attempt,{id:'attempt-id',startedAt:now,resumed:true});
});

test('start response exposes only the practice feedback setting and never answer data',async t=>{
  const start=async()=>({kind:'started' as const,attempt:{id:'attempt-id',startedAt:new Date()},quiz:{id:'quiz-id',title:'Practice',timeLimitSeconds:null,quizType:'practice',isTest:false,immediateFeedback:true},questions:[{id:'question-id',text:'Question',type:'single_choice',options:[{id:'option-id',text:'Option'}]}]});
  const app=express();app.use((req:Request,_res,next)=>{req.user={id:'user-id',username:'learner',fullName:'Learner',role:'employee',mustChangePassword:false};next()});app.use(createQuizStartRouter(start as never));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.close();await once(server,'close')});
  const address=server.address();assert.ok(address&&typeof address==='object');
  const response=await fetch(`http://127.0.0.1:${address.port}/quizzes/quiz-id/start`,{method:'POST'});const body=await response.json() as {quiz:{immediateFeedback:boolean};questions:{correctOptionIds?:unknown;explanation?:unknown}[]};
  assert.equal(body.quiz.immediateFeedback,true);assert.equal('correctOptionIds' in body.questions[0],false);assert.equal('explanation' in body.questions[0],false);
});

test('official exam cannot enable answer feedback even if a quiz row requests it',async t=>{
  const start=async()=>({kind:'started' as const,attempt:{id:'attempt-id',startedAt:new Date()},quiz:{id:'quiz-id',title:'Exam',timeLimitSeconds:null,quizType:'exam',isTest:false,immediateFeedback:true},questions:[{id:'question-id',text:'Question',type:'single_choice',options:[{id:'option-id',text:'Option'}]}]});
  const app=express();app.use((req:Request,_res,next)=>{req.user={id:'user-id',username:'learner',fullName:'Learner',role:'employee',mustChangePassword:false};next()});app.use(createQuizStartRouter(start as never));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.close();await once(server,'close')});
  const address=server.address();assert.ok(address&&typeof address==='object');
  const response=await fetch(`http://127.0.0.1:${address.port}/quizzes/quiz-id/start`,{method:'POST'});const body=await response.json() as {quiz:{immediateFeedback:boolean}};
  assert.equal(body.quiz.immediateFeedback,false);
});
