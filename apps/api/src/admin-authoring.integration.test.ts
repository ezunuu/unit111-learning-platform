import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {hash} from '@node-rs/argon2';
import {db,pool} from './db.js';
import * as s from './schema.js';

test('admin authoring accepts source-free questions, advisory duplicates, and title-only draft lessons',{skip:process.env.UNIT111_TEST_DATABASE_INTEGRATION!=='1'},async(t)=>{
 const url=new URL(process.env.DATABASE_URL!);assert.match(url.pathname,/^\/unit111_it_\d{14}_[a-f0-9]{8}$/);assert.ok(['localhost','127.0.0.1','::1'].includes(url.hostname));
 process.env.UNIT111_API_NO_LISTEN='1';
 const {app}=await import('./index.js');
 const username=`authoring_${crypto.randomUUID()}`,password=crypto.randomUUID()+crypto.randomUUID();
 await db.insert(s.users).values({username,fullName:'Authoring test',passwordHash:await hash(password),role:'admin',mustChangePassword:false,isActive:true});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.close();await once(server,'close');await pool.end()});
 const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/api/v1`;
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:username,password})});assert.equal(login.status,200);
 const auth=await login.json() as {csrfToken:string};const cookie=login.headers.getSetCookie().map(item=>item.split(';')[0]).join('; ');assert.ok(cookie);
 const call=async(path:string,body:unknown,method='POST')=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',cookie,'x-csrf-token':auth.csrfToken},body:JSON.stringify(body)});return{status:r.status,data:await r.json() as any}};
 const input={questionText:`Independent admin prompt ${crypto.randomUUID()}`,options:['First','Second','Third','Fourth'].map(text=>({text})),correctIndexes:[0],status:'published'};
 const first=await call('/questions',input);assert.equal(first.status,201);assert.equal(first.data.question.status,'published');
 const edited=await call(`/questions/${first.data.question.id}`,{...input,questionText:input.questionText+' edited'},'PUT');assert.equal(edited.status,200);assert.equal(edited.data.status,'published');
 const again=await call('/questions',input);assert.equal(again.status,201);assert.ok(again.data.possibleDuplicates.length>0,'similarity is advisory instead of blocking');
 const invalid=await call('/questions',{...input,correctIndexes:[]});assert.equal(invalid.status,400);
 const lesson=await call('/lessons',{title:`Empty draft ${crypto.randomUUID()}`});assert.equal(lesson.status,201);assert.equal(lesson.data.lesson.status,'draft');
 const detail=await fetch(base+`/lessons/${lesson.data.lesson.id}`,{headers:{cookie}});assert.equal(detail.status,200);assert.deepEqual((await detail.json() as any).questionIds,[]);
 const blocked=await call(`/lessons/${lesson.data.lesson.id}`,{title:lesson.data.lesson.title,questionIds:[],status:'published'},'PUT');assert.equal(blocked.status,409,'empty lesson can be saved but cannot be exposed as an unusable practice');
 const catalogResponse=await fetch(base+'/learning/subjects',{headers:{cookie}});assert.equal(catalogResponse.status,200);const catalog=await catalogResponse.json() as any;assert.ok(catalog.items.some((item:any)=>item.title==='Нисэхийн мэдлэг'));assert.ok(catalog.items.some((item:any)=>item.title==='Улсын нисэхийн дүрэм'));assert.ok(catalog.items.some((item:any)=>item.title==='Цэргийн дүрэм'));
 const newSubject=await call('/admin/subjects',{title:'Independent learning '+crypto.randomUUID(),icon:'shield'});assert.equal(newSubject.status,201);
 const missingCsrf=await fetch(base+'/admin/subjects',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({title:'Must not be created'})});assert.equal(missingCsrf.status,403);
 const duplicateSubject=await call('/admin/subjects',{title:newSubject.data.item.title.toUpperCase()});assert.equal(duplicateSubject.status,409);
 const category=(await db.select().from(s.categories).limit(1))[0];
 const user=(await db.select().from(s.users).where((await import('drizzle-orm')).eq(s.users.username,username)).limit(1))[0];
 const fixtureLessons:{subjectId:string;id:string;courseId:string}[]=[];
 for(const subjectId of ['11100000-0000-4000-8000-000000000001',newSubject.data.item.id]){
  const [course]=await db.insert(s.courses).values({title:'Subject fixture '+crypto.randomUUID(),subjectId,status:'published',createdBy:user.id}).returning();
  const [chapter]=await db.insert(s.chapters).values({courseId:course.id,title:'Subject chapter',chapterOrder:123,status:'published'}).returning();
  const [item]=await db.insert(s.lessons).values({title:'Subject lesson',description:'',content:'',categoryId:category.id,chapterId:chapter.id,status:'published',createdBy:user.id}).returning();
  await db.insert(s.lessonQuestions).values({lessonId:item.id,questionId:first.data.question.id,questionOrder:0});fixtureLessons.push({subjectId,id:item.id,courseId:course.id});
 }
 const scopedResponse=await fetch(base+'/learning/path?subjectId='+newSubject.data.item.id,{headers:{cookie}});assert.equal(scopedResponse.status,200);const scoped=await scopedResponse.json() as any;
 assert.deepEqual(scoped.items.map((item:any)=>item.id),[fixtureLessons[1].id]);assert.equal(scoped.items[0].unlocked,true,'other subjects do not gate this subject');assert.equal(scoped.summary.totalLessons,1);assert.equal(scoped.summary.completedLessons,0);
 const aviationResponse=await fetch(base+'/learning/path?subjectId='+fixtureLessons[0].subjectId,{headers:{cookie}});const aviation=await aviationResponse.json() as any;assert.ok(aviation.items.some((item:any)=>item.id===fixtureLessons[0].id));assert.ok(!aviation.items.some((item:any)=>item.id===fixtureLessons[1].id));
 const moved=await call('/admin/courses/'+fixtureLessons[1].courseId+'/subject',{subjectId:fixtureLessons[0].subjectId},'PUT');assert.equal(moved.status,200);
 const afterMove=await fetch(base+'/learning/path?subjectId='+newSubject.data.item.id,{headers:{cookie}});assert.deepEqual((await afterMove.json() as any).items,[]);
 const invalidSubject=await fetch(base+'/learning/path?subjectId=invalid',{headers:{cookie}});assert.equal(invalidSubject.status,400);
 const forbiddenSubject=await fetch(base+'/admin/subjects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Forbidden'})});assert.ok([401,403].includes(forbiddenSubject.status));
 const noSession=await fetch(base+'/questions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});assert.ok([401,403].includes(noSession.status));
});
