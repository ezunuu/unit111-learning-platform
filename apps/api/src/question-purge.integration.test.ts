import test from 'node:test';
import assert from 'node:assert/strict';
import express,{type Request} from 'express';
import {once} from 'node:events';
import {eq} from 'drizzle-orm';
import {adminContentRouter} from './admin-content.js';
import {db,pool} from './db.js';
import * as s from './schema.js';

test('question purge preview and protected-record response are read-only and admin-only',{skip:process.env.UNIT111_TEST_DATABASE_INTEGRATION!=='1'},async t=>{
  const url=new URL(process.env.DATABASE_URL||'');
  assert.equal(url.pathname.replace(/^\//,''),'unit111_admin_test');
  assert.ok(['localhost','127.0.0.1','::1'].includes(url.hostname));
  const[admin]=await db.select({id:s.users.id}).from(s.users).where(eq(s.users.role,'admin')).limit(1);
  const[question]=await db.select({id:s.questions.id,status:s.questions.status}).from(s.questions).where(eq(s.questions.sourceDocument,'01 - Fuselage.pdf')).limit(1);
  assert.ok(admin);assert.ok(question);assert.notEqual(question.status,'archived');
  const app=express();app.use(express.json());
  app.use((req:Request,_res,next)=>{const role=req.header('x-integration-role')==='employee'?'employee':'admin';req.user={id:admin.id,username:'integration-test',fullName:'Integration Test',role,mustChangePassword:false};next()});
  app.use(adminContentRouter);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.close();await once(server,'close');await pool.end()});
  const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  const forbidden=await fetch(`${base}/questions/permanent-delete/preview`,{method:'POST',headers:{'content-type':'application/json','x-integration-role':'employee'},body:JSON.stringify({questionIds:[question.id]})});assert.equal(forbidden.status,403);
  const preview=await fetch(`${base}/questions/permanent-delete/preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({questionIds:[question.id]})});assert.equal(preview.status,200);const report=await preview.json() as {selectedCount:number;eligibleCount:number;blockedCount:number;items:{status:string;canDelete:boolean;reasons:string[];revisionCount:number;quizLinks:{title:string}[]}[]};assert.equal(report.selectedCount,1);assert.equal(report.eligibleCount,0);assert.equal(report.blockedCount,1);assert.equal(report.items[0].status,question.status);assert.equal(report.items[0].canDelete,false);assert.ok(report.items[0].revisionCount>0);assert.ok(report.items[0].quizLinks.some(link=>link.title==='Chapter 1'));
  const blockedBackup=await fetch(`${base}/questions/permanent-delete/backup`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({questionIds:[question.id]})});assert.equal(blockedBackup.status,409);const blockedBody=await blockedBackup.json() as {eligibleCount:number;blockedCount:number};assert.equal(blockedBody.eligibleCount,0);assert.equal(blockedBody.blockedCount,1);
  const deniedDelete=await fetch(`${base}/questions/permanent-delete`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({questionIds:[question.id],confirmation:'УСТГАХ'})});assert.equal(deniedDelete.status,409);
  const[stillThere]=await db.select({id:s.questions.id,status:s.questions.status}).from(s.questions).where(eq(s.questions.id,question.id)).limit(1);assert.deepEqual(stillThere,question);
});
