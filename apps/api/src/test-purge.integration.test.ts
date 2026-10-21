import test from 'node:test';
import assert from 'node:assert/strict';
import express,{type Request} from 'express';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {adminContentRouter} from './admin-content.js';
import {db,pool} from './db.js';
import * as s from './schema.js';

test('admin test-purge routes integrate with PostgreSQL without performing a purge',{skip:process.env.UNIT111_TEST_DATABASE_INTEGRATION!=='1'},async t=>{
  const url=new URL(process.env.DATABASE_URL||'');
  assert.equal(url.pathname.replace(/^\//,''),'unit111_admin_test');
  assert.ok(['localhost','127.0.0.1','::1'].includes(url.hostname));
  const[admin]=await db.select({id:s.users.id}).from(s.users).where(eq(s.users.role,'admin')).limit(1);
  assert.ok(admin,'Integration test requires an administrator account in the local test database');
  const app=express();app.use(express.json());
  app.use((req:Request,_res,next)=>{const role=req.header('x-integration-role')==='employee'?'employee':'admin';req.user={id:admin.id,username:'integration-test',fullName:'Integration Test',role,mustChangePassword:false};next()});
  app.use(adminContentRouter);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.close();await once(server,'close');await pool.end()});
  const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  const list=await fetch(`${base}/admin/quizzes?status=archived`);assert.equal(list.status,200);const listBody=await list.json() as {items:{status:string;isTest:boolean}[]};assert.ok(listBody.items.every(item=>item.status==='archived'&&typeof item.isTest==='boolean'));
  const existingQuizId='4d0e58bc-b3a3-400b-9652-bad9623ed107';const previewExisting=await fetch(`${base}/admin/quizzes/${existingQuizId}/test-purge-preview`);assert.equal(previewExisting.status,200);const previewBody=await previewExisting.json() as {quiz:{id:string;isTest:boolean};attemptCount:number;competitionCount:number;unknownForeignKeyTables:string[]};assert.equal(previewBody.quiz.id,existingQuizId);assert.equal(typeof previewBody.quiz.isTest,'boolean');assert.ok(previewBody.attemptCount>=0);assert.ok(Array.isArray(previewBody.unknownForeignKeyTables));
  const missingId=randomUUID();const preview=await fetch(`${base}/admin/quizzes/${missingId}/test-purge-preview`);assert.equal(preview.status,404);
  const forbidden=await fetch(`${base}/admin/quizzes/${missingId}/purge-test`,{method:'POST',headers:{'content-type':'application/json','x-integration-role':'employee'},body:JSON.stringify({confirmationTitle:'x',confirmedTestOnly:true})});assert.equal(forbidden.status,403);
  const invalid=await fetch(`${base}/admin/quizzes/${missingId}/purge-test`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmationTitle:'x',confirmedTestOnly:false})});assert.equal(invalid.status,400);
});
