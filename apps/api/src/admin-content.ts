import {lessonGroupsInput,lessonGroupError,importTitleKey} from './import-lesson-plan.js';
import {Router} from 'express';
import {and,asc,desc,eq,inArray,ilike,isNull,sql} from 'drizzle-orm';
import {z} from 'zod';
import {canPermanentlyDeleteQuiz} from './quiz-lifecycle.js';
import {canVoidAttempt,isAttemptTimeExpired} from './attempt-management.js';
import {canMarkQuizAsTest,canPermanentlyPurgeTestQuiz} from './test-purge-policy.js';
import {createVerifiedTestDatabaseBackup} from './test-quiz-backup.js';
import {db} from './db.js';
import * as s from './schema.js';
import {requireAuth,requireRoles} from './auth.js';
import {groupDuplicateQuestions} from './question-duplicates.js';
import {normalizeQuestionText} from './question-duplicates.js';
import {validateQuestionDraft} from './question-validation.js';
import {questionSimilarity} from './question-validation.js';
import {inspectQuestionPurge} from './question-purge-data.js';
import {runAfterVerifiedBackup} from './verified-backup-transaction.js';
import {createBackupForEligibleQuestionPurge} from './question-purge-backup.js';
import {buildAdminLessonPreview} from './lesson-preview.js';
import {lessonPublishReasons,type LessonPublishInput} from './bulk-publish-policy.js';
import {mergeSourceMetadata,type SourceMetadataField} from './question-source-metadata.js';
import {decideTrainingQuizLink} from './training-quiz-link-policy.js';

export const adminContentRouter=Router();
const fail=(res:import('express').Response,status:number,code:string,message:string)=>res.status(status).json({error:{code,message}});
const quizInput=z.object({
  title:z.string().trim().min(3).max(200),
  description:z.string().trim().max(2000).nullable(),
  questionIds:z.array(z.string().uuid()).min(1).max(100),
  timeLimitSeconds:z.number().int().min(60).max(86400).nullable(),
  passingPercentage:z.number().int().min(0).max(100),
  attemptsAllowed:z.number().int().min(0).max(20),
  isTest:z.boolean().default(false),
  pointsPerQuestion:z.number().int().min(1).max(1000).default(100),
  status:z.enum(['draft','published']),
}).superRefine((value,context)=>{if(value.attemptsAllowed===0&&!value.isTest)context.addIssue({code:z.ZodIssueCode.custom,path:['attemptsAllowed'],message:'Хязгааргүй оролдлогыг зөвхөн туршилтын сорилд тохируулна.'});});
const questionInput=z.object({
  categoryId:z.string().uuid(),
  questionText:z.string().trim().min(10).max(3000),
  questionType:z.enum(['single_choice','multiple_choice','true_false']),
  difficulty:z.enum(['easy','medium','hard']),
  explanation:z.string().trim().max(3000).default(''),
  sourceDocument:z.string().trim().max(500).default(''),
  sourceRevision:z.string().trim().max(200).nullable().optional(),
  sourceSection:z.string().trim().max(200).nullable().optional(),
  sourceLocation:z.string().trim().max(200).default(''),
  sourceReference:z.string().trim().max(100).nullable().optional(),
  xp:z.number().int().min(0).max(1000).default(10),
  options:z.array(z.object({text:z.string().trim().min(1).max(1000)})).min(2).max(8),
  correctIndexes:z.array(z.number().int().min(0).max(7)).min(1).max(8),
  correctAnswerText:z.string().trim().max(1000).nullable().optional(),
});
const importQuestionInput=questionInput.extend({reuseQuestionId:z.string().uuid().optional()});
const questionEditInput=questionInput.extend({
  categoryId:z.string().uuid().optional(),
  questionText:z.string().trim().min(1).max(3000),
  questionType:z.enum(['single_choice','multiple_choice','true_false']).default('single_choice'),
  difficulty:z.enum(['easy','medium','hard']).default('medium'),
  explanation:z.string().trim().max(3000).default(''),
  sourceDocument:z.string().trim().max(500).nullable().optional(),
  sourceLocation:z.string().trim().max(200).nullable().optional(),
  options:z.array(z.object({text:z.string().trim().min(1).max(1000)})).length(4),
  correctIndexes:z.array(z.number().int().min(0).max(3)).length(1),
});
const hasUniqueIds=(ids:string[])=>new Set(ids).size===ids.length;

const normalizeImportValue=(value:string)=>value.normalize('NFKC').replace(/[\p{Cf}\s]+/gu,' ').trim().toLocaleLowerCase('mn');
async function loadImportReuseCandidate(query:any,id:string,lock=false){
  let statement=query.select({id:s.questions.id,questionText:s.questions.questionText,questionType:s.questions.questionType,difficulty:s.questions.difficulty,explanation:s.questions.explanation,status:s.questions.status,archivedAt:s.questions.archivedAt,duplicateOf:s.questions.duplicateOf,categoryId:s.questions.categoryId,sourceDocument:s.questions.sourceDocument,sourceRevision:s.questions.sourceRevision,sourceSection:s.questions.sourceSection,sourceLocation:s.questions.sourceLocation,xp:s.questions.xp}).from(s.questions).where(eq(s.questions.id,id)).limit(1);
  if(lock)statement=statement.for('update');
  const [question]=await statement;if(!question)return null;
  const options=await query.select({id:s.questionOptions.id,text:s.questionOptions.optionText}).from(s.questionOptions).where(eq(s.questionOptions.questionId,id)).orderBy(asc(s.questionOptions.optionOrder));
  const correct=await query.select({optionId:s.questionCorrectOptions.optionId}).from(s.questionCorrectOptions).where(eq(s.questionCorrectOptions.questionId,id));
  return{...question,options,correctIndexes:options.map((option:{id:string},index:number)=>correct.some((answer:{optionId:string})=>answer.optionId===option.id)?index:-1).filter((index:number)=>index>=0)};
}
function importReuseCheck(incoming:z.infer<typeof questionInput>,existing:NonNullable<Awaited<ReturnType<typeof loadImportReuseCandidate>>>){
  const samePrompt=normalizeImportValue(incoming.questionText)===normalizeImportValue(existing.questionText);
  const sameOptions=incoming.options.length===existing.options.length&&incoming.options.every((option,index)=>normalizeImportValue(option.text)===normalizeImportValue(existing.options[index]?.text??''));
  const sameCorrect=[...incoming.correctIndexes].sort((a,b)=>a-b).join(',')===[...existing.correctIndexes].sort((a,b)=>a-b).join(',');
  const sameExplanation=normalizeImportValue(incoming.explanation??'')===normalizeImportValue(existing.explanation??'');
  const sameCore=samePrompt&&incoming.questionType===existing.questionType&&incoming.difficulty===existing.difficulty&&incoming.xp===existing.xp&&sameOptions&&sameCorrect&&sameExplanation;
  const canReuse=existing.status!=='archived'&&!existing.archivedAt&&!existing.duplicateOf&&sameCore;
  const reason=existing.status==='archived'||existing.archivedAt||existing.duplicateOf?'Архивласан эсвэл давхардал гэж тэмдэглэсэн асуултыг дахин ашиглахгүй.':!samePrompt?'Асуултын текст яг таарахгүй; зөвхөн төстэй асуулт байна.':!sameOptions||!sameCorrect?'Сонголт эсвэл зөв хариулт зөрсөн тул дахин ашиглах боломжгүй.':!sameExplanation?'Тайлбар зөрсөн тул өмнөх асуултыг автоматаар ашиглахгүй.':!sameCore?'Асуултын төрөл, хүндрэл эсвэл XP зөрсөн тул өмнөх асуултыг ашиглахгүй.':'';
  const metadataDiffers=incoming.categoryId!==existing.categoryId||incoming.sourceDocument!==existing.sourceDocument||incoming.sourceRevision!==existing.sourceRevision||incoming.sourceSection!==existing.sourceSection||incoming.sourceLocation!==existing.sourceLocation||incoming.sourceReference!==existing.sourceReference;
  return{canReuse,reason,metadataDiffers};
}

const sourceMetadataIds=z.array(z.string().uuid()).min(1).max(100).refine(hasUniqueIds,'Давхардсан асуултын ID байна.');
const sourceMetadataPatch=z.object({sourceDocument:z.string().trim().min(3).max(500).optional(),sourceRevision:z.string().trim().min(1).max(200).optional(),sourceSection:z.string().trim().min(1).max(200).optional(),sourceLocation:z.string().trim().min(1).max(200).optional()}).strict().refine(value=>Object.values(value).some(field=>field!==undefined),'Шинэчлэх source талбараа сонгоно уу.');

adminContentRouter.post('/categories',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=z.object({name:z.string().trim().min(2).max(160),description:z.string().trim().max(2000).optional()}).strict().safeParse(req.body);
    if(!parsed.success)return fail(res,400,'VALIDATION','Ангиллын нэр 2–160 тэмдэгт байна.');
    const key=(value:string)=>normalizeQuestionText(value).replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/gu,' ').trim();
    const created=await db.transaction(async tx=>{
      const existing=await tx.select({id:s.categories.id,name:s.categories.name}).from(s.categories);
      const duplicate=existing.find(item=>key(item.name)===key(parsed.data.name));
      if(duplicate)return{kind:'duplicate' as const,item:duplicate};
      const[last]=await tx.select({sortOrder:s.categories.sortOrder}).from(s.categories).orderBy(desc(s.categories.sortOrder)).limit(1);
      const[item]=await tx.insert(s.categories).values({name:parsed.data.name,description:parsed.data.description??null,sortOrder:(last?.sortOrder??-1)+1,isActive:true}).returning({id:s.categories.id,name:s.categories.name});
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'category.created',entityType:'category',entityId:item.id,metadata:{name:item.name}});
      return{kind:'created' as const,item};
    });
    if(created.kind==='duplicate')return res.status(409).json({error:{code:'CATEGORY_EXISTS',message:`Ижил ангилал байна: ${created.item.name}`,item:created.item}});
    res.status(201).json({item:created.item});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/source-metadata/preview',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const p=z.object({questionIds:sourceMetadataIds}).safeParse(req.body);
    if(!p.success)return fail(res,400,'VALIDATION','1–100 давхардаагүй асуулт сонгоно уу.');
    const items=await db.select({id:s.questions.id,sourceReference:s.questions.sourceReference,questionText:s.questions.questionText,status:s.questions.status,sourceDocument:s.questions.sourceDocument,sourceRevision:s.questions.sourceRevision,sourceSection:s.questions.sourceSection,sourceLocation:s.questions.sourceLocation}).from(s.questions).where(inArray(s.questions.id,p.data.questionIds));
    const byId=new Map(items.map(item=>[item.id,item]));
    res.json({selectedCount:p.data.questionIds.length,foundCount:items.length,items:p.data.questionIds.map(id=>byId.get(id)??{id,missing:true})});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/source-metadata/bulk',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const p=z.object({questionIds:sourceMetadataIds,fields:sourceMetadataPatch,overwriteExisting:z.boolean().default(false),verificationNote:z.string().trim().min(30).max(2000)}).safeParse(req.body);
    if(!p.success)return fail(res,400,'VALIDATION','Сонгосон source талбар, асуултууд болон 30+ тэмдэгтийн эх сурвалж баталгаажуулалтын тэмдэглэлийг шалгана уу.');
    const result=await db.transaction(async tx=>{
      const updated:string[]=[],unchanged:{id:string;fields:SourceMetadataField[]}[]=[],protectedItems:{id:string;fields:SourceMetadataField[]}[]=[],missing:string[]=[];
      for(const id of [...p.data.questionIds].sort()){
        await tx.execute(sql`select id from questions where id=${id} for update`);
        const[q]=await tx.select({id:s.questions.id,sourceDocument:s.questions.sourceDocument,sourceRevision:s.questions.sourceRevision,sourceSection:s.questions.sourceSection,sourceLocation:s.questions.sourceLocation}).from(s.questions).where(eq(s.questions.id,id)).limit(1);
        if(!q){missing.push(id);continue;}
        const merged=mergeSourceMetadata(q,p.data.fields,p.data.overwriteExisting);
        if(!Object.keys(merged.updated).length){if(merged.unchanged.length)unchanged.push({id,fields:merged.unchanged});if(merged.protectedFields.length)protectedItems.push({id,fields:merged.protectedFields});continue;}
        const latest=await tx.select({revisionNumber:s.questionRevisions.revisionNumber}).from(s.questionRevisions).where(eq(s.questionRevisions.questionId,id)).orderBy(desc(s.questionRevisions.revisionNumber)).limit(1);
        const now=new Date();
        await tx.update(s.questions).set({...merged.updated,updatedAt:now}).where(eq(s.questions.id,id));
        await tx.insert(s.questionRevisions).values({questionId:id,revisionNumber:(latest[0]?.revisionNumber??0)+1,previousData:{type:'source_metadata',previous:{sourceDocument:q.sourceDocument,sourceRevision:q.sourceRevision,sourceSection:q.sourceSection,sourceLocation:q.sourceLocation},updated:merged.updated},changedBy:req.user!.id,changeReason:'Source metadata bulk update; reviewer attestation recorded in audit log.'});
        await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.source_metadata_updated',entityType:'question',entityId:id,metadata:{updatedFields:Object.keys(merged.updated),previous:{sourceDocument:q.sourceDocument,sourceRevision:q.sourceRevision,sourceSection:q.sourceSection,sourceLocation:q.sourceLocation},updated:merged.updated,overwriteExisting:p.data.overwriteExisting,verificationNote:p.data.verificationNote}});
        updated.push(id);
      }
      return{updated,unchanged,protectedItems,missing};
    });
    res.json({updatedCount:result.updated.length,updatedIds:result.updated,unchangedCount:result.unchanged.length,unchanged:result.unchanged,protectedCount:result.protectedItems.length,protected:result.protectedItems,missingCount:result.missing.length,missingIds:result.missing});
  }catch(e){next(e)}
});

adminContentRouter.get('/lessons',requireAuth,async(req,res,next)=>{
  try{
    const status=req.user!.role==='admin'||req.user!.role==='training_manager'?typeof req.query.status==='string'?req.query.status as 'draft'|'published'|'archived':undefined:'published';
    if(status&&!['draft','published','archived'].includes(status))return fail(res,400,'VALIDATION','Хичээлийн төлөв буруу байна.');
    const items=await db.select({id:s.lessons.id,title:s.lessons.title,categoryId:s.lessons.categoryId,description:s.lessons.description,status:s.lessons.status,lessonOrder:s.lessons.lessonOrder,updatedAt:s.lessons.updatedAt}).from(s.lessons).where(status?eq(s.lessons.status,status):undefined).orderBy(asc(s.lessons.lessonOrder),desc(s.lessons.updatedAt));
    const training=items.length?await db.select({lessonId:s.quizzes.lessonId,quizId:s.quizzes.id,quizTitle:s.quizzes.title,quizStatus:s.quizzes.status}).from(s.quizzes).where(and(eq(s.quizzes.quizType,'training'),inArray(s.quizzes.lessonId,items.map(item=>item.id)))):[];
    res.json({items:items.map(item=>({...item,trainingQuiz:training.find(quiz=>quiz.lessonId===item.id)??null}))});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/import',requireAuth,requireRoles('admin','training_manager'),async(req,res,next)=>{
  try{
    const body=z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/i),quizId:z.string().uuid().optional(),lesson:z.object({title:z.string().trim().min(1).max(200),chapterId:z.string().uuid()}).optional(),lessonGroups:lessonGroupsInput.optional(),sourceFormat:z.enum(['xlsx','csv']).optional(),questions:z.array(importQuestionInput).min(1).max(200)}).safeParse(req.body);
    if(!body.success)return fail(res,400,'VALIDATION','Импортын файлын мэдээлэл эсвэл мөрийн тоо буруу байна.');
    if(body.data.lessonGroups){if(body.data.lesson||body.data.quizId)return fail(res,400,'VALIDATION','Импортын нэг л горим сонгоно уу.');const issue=lessonGroupError(body.data.lessonGroups,body.data.questions.length);if(issue)return fail(res,400,'VALIDATION',issue);}
    if(body.data.lesson&&(body.data.quizId||body.data.questions.length>100))return fail(res,400,'VALIDATION','Нэг хичээлд 1–100 асуулт оруулна. Сорил болон шинэ хичээлийг зэрэг сонгож болохгүй.');
    if(body.data.quizId&&req.user!.role!=='admin')return fail(res,403,'FORBIDDEN','Нийтлэгдсэн сорилд асуулт холбохыг зөвхөн админ хийнэ.');
    const errors:{row:number;message:string}[]=[];
    body.data.questions.forEach((question,index)=>{const error=validateQuestionDraft(question);if(error)errors.push({row:index+2,message:error});if(question.correctAnswerText){const answer=question.options[question.correctIndexes[0]]?.text??'';const normalizeAnswer=(value:string)=>normalizeQuestionText(value).replace(/[\p{P}\p{S}\s]/gu,'');if(normalizeAnswer(question.correctAnswerText)!==normalizeAnswer(answer))errors.push({row:index+2,message:'Зөв хариултын тэмдэглэгээ болон текст таарахгүй байна.'});}if(body.data.sourceFormat==='xlsx'&&(question.options.length!==4||question.questionType!=='single_choice'||question.correctIndexes.length!==1))errors.push({row:index+2,message:'Excel асуулт дөрвөн сонголттой, A/B/C/D-ээс нэг зөв хариулттай байна.'});});
    if(errors.length)return res.status(400).json({error:{code:'ROW_VALIDATION',message:'Алдаатай мөрүүдийг засаж дахин импортлоно уу.'},rows:errors});
    if(body.data.questions.some(question=>question.reuseQuestionId)&&!body.data.lesson&&!body.data.lessonGroups&&!body.data.quizId)return fail(res,400,'REUSE_REQUIRES_TARGET','Өмнөх асуултыг дахин ашиглахдаа хичээл эсвэл сорилтой холбоно уу.');
    const categoryIds=[...new Set(body.data.questions.filter(question=>!question.reuseQuestionId).map(question=>question.categoryId))];
    const categories=await db.select({id:s.categories.id}).from(s.categories).where(and(inArray(s.categories.id,categoryIds),eq(s.categories.isActive,true)));
    if(categories.length!==categoryIds.length)return fail(res,400,'VALIDATION','Импортын мөрүүдэд байхгүй эсвэл идэвхгүй ангилал байна.');
    const existing=await db.select({id:s.questions.id,questionText:s.questions.questionText,sourceDocument:s.questions.sourceDocument,sourceReference:s.questions.sourceReference}).from(s.questions);
    const dupRows:{row:number;questionId:string;questionText:string;message?:string}[]=[];
    for(const[index,question]of body.data.questions.entries()){
      const sourceMatch=question.sourceReference?existing.find(item=>item.sourceReference===question.sourceReference&&item.sourceDocument===question.sourceDocument):undefined;
      const match=sourceMatch??existing.map(item=>({...item,similarity:questionSimilarity(item.questionText,question.questionText)})).find(item=>item.similarity>=0.82);
      if(question.reuseQuestionId){
        if(!match||question.reuseQuestionId!==match.id)dupRows.push({row:index+2,questionId:question.reuseQuestionId,questionText:question.questionText,message:'Сонгосон өмнөх асуулт олдсонгүй эсвэл энэ мөртэй таарахгүй байна.'});
        else {const candidate=await loadImportReuseCandidate(db,match.id);const reuse=candidate&&importReuseCheck(question,candidate);if(!reuse?.canReuse)dupRows.push({row:index+2,questionId:match.id,questionText:match.questionText,message:reuse?.reason||'Өмнөх асуултыг дахин ашиглах боломжгүй.'});}
      }
    }
    if(dupRows.length)return res.status(409).json({error:{code:'POSSIBLE_DUPLICATE',message:'Импортын зарим мөр өмнөх асуулттай төстэй байна. Эдгээрийг preview-гээс хасна уу.'},rows:dupRows});
    const result=await db.transaction(async tx=>{
      let linkStartOrder=0,linkPoints=100;
      const plan=body.data.lessonGroups;
      const [planCourse]=plan?await tx.select().from(s.courses).where(eq(s.courses.id,plan.courseId)).for('update').limit(1):[];
      const planChapters=planCourse?await tx.select().from(s.chapters).where(eq(s.chapters.courseId,planCourse.id)):[];
      if(plan&&(!planCourse||planCourse.status==='archived'||plan.groups.some(group=>{const matches=planChapters.filter(ch=>importTitleKey(ch.title)===importTitleKey(group.chapterTitle));return matches.length>1||matches.some(ch=>ch.status==='archived')})))return{kind:'placement_unavailable'} as const;
      const target=body.data.lesson?(await tx.select({id:s.chapters.id,status:s.chapters.status,courseStatus:s.courses.status,passPercentage:s.courses.defaultLessonPassPercentage,completionXp:s.courses.lessonCompletionXp,passXp:s.courses.lessonPassXp,perfectXp:s.courses.perfectPracticeXp}).from(s.chapters).innerJoin(s.courses,eq(s.courses.id,s.chapters.courseId)).where(eq(s.chapters.id,body.data.lesson.chapterId)).for('update').limit(1))[0]:null;
      if(body.data.lesson&&(!target||target.status==='archived'||target.courseStatus==='archived'))return{kind:'chapter_unavailable'} as const;
      if(body.data.quizId){
        const[quiz]=await tx.select({id:s.quizzes.id,status:s.quizzes.status}).from(s.quizzes).where(eq(s.quizzes.id,body.data.quizId)).for('update').limit(1);
        if(!quiz||quiz.status!=='published')return{kind:'quiz_unavailable'} as const;
        const links=await tx.select({questionOrder:s.quizQuestions.questionOrder,points:s.quizQuestions.points}).from(s.quizQuestions).where(eq(s.quizQuestions.quizId,quiz.id)).orderBy(asc(s.quizQuestions.questionOrder));
        linkStartOrder=(links.at(-1)?.questionOrder??-1)+1;linkPoints=links[0]?.points??100;
      }
      const reuseCandidates=new Map<string,Awaited<ReturnType<typeof loadImportReuseCandidate>>>();
      for(const[index,row]of body.data.questions.entries())if(row.reuseQuestionId){const candidate=await loadImportReuseCandidate(tx,row.reuseQuestionId,true);if(!candidate||!importReuseCheck(row,candidate).canReuse)return{kind:'reuse_changed',row:index+2,questionId:row.reuseQuestionId} as const;reuseCandidates.set(row.reuseQuestionId,candidate);}
      const[claim]=await tx.insert(s.questionImports).values({fingerprint:body.data.fingerprint,createdBy:req.user!.id,rowCount:body.data.questions.length}).onConflictDoNothing({target:s.questionImports.fingerprint}).returning({id:s.questionImports.id});
      if(!claim)return{kind:'already_imported'} as const;
      const created:string[]=[],resolved:string[]=[],reused:string[]=[];
      for(const[index,row]of body.data.questions.entries()){
        if(row.reuseQuestionId){const candidate=reuseCandidates.get(row.reuseQuestionId)!;const reuse=importReuseCheck(row,candidate!);resolved.push(row.reuseQuestionId);reused.push(row.reuseQuestionId);if(body.data.quizId)await tx.insert(s.quizQuestions).values({quizId:body.data.quizId,questionId:row.reuseQuestionId,questionOrder:linkStartOrder+index,points:linkPoints}).onConflictDoNothing();await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.reused_in_import',entityType:'question',entityId:row.reuseQuestionId,metadata:{importId:claim.id,quizId:body.data.quizId??null,sourceFormat:body.data.sourceFormat??null,metadataDiffers:reuse.metadataDiffers,existingCategoryId:candidate!.categoryId,requestedCategoryId:row.categoryId}});continue;}
        const duplicateReference=row.sourceReference?await tx.select({id:s.questions.id}).from(s.questions).where(and(eq(s.questions.sourceDocument,row.sourceDocument),eq(s.questions.sourceReference,row.sourceReference))).limit(1):[];
        const storedSourceReference=duplicateReference.length?null:row.sourceReference??null;
        const[question]=await tx.insert(s.questions).values({categoryId:row.categoryId,questionText:row.questionText,questionType:row.questionType,difficulty:row.difficulty,explanation:row.explanation,xp:row.xp,sourceReference:storedSourceReference,status:body.data.quizId?'pending_review':'draft',createdBy:req.user!.id,sourceDocument:row.sourceDocument,sourceRevision:row.sourceRevision??null,sourceSection:row.sourceSection??null,sourceLocation:row.sourceLocation}).returning();const options=await tx.insert(s.questionOptions).values(row.options.map((option,optionOrder)=>({questionId:question.id,optionText:option.text,optionOrder}))).returning({id:s.questionOptions.id});await tx.insert(s.questionCorrectOptions).values(row.correctIndexes.map(optionIndex=>({questionId:question.id,optionId:options[optionIndex].id})));await tx.insert(s.questionRevisions).values({questionId:question.id,revisionNumber:1,previousData:{questionText:question.questionText,options:row.options,sourceDocument:question.sourceDocument,sourceRevision:question.sourceRevision,sourceSection:question.sourceSection,sourceLocation:question.sourceLocation,sourceReference:question.sourceReference,importedSourceReference:row.sourceReference??null,xp:question.xp},changedBy:req.user!.id,changeReason:'CSV/XLSX batch import'});if(body.data.quizId)await tx.insert(s.quizQuestions).values({quizId:body.data.quizId,questionId:question.id,questionOrder:linkStartOrder+index,points:linkPoints});await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.imported',entityType:'question',entityId:question.id,metadata:{importId:claim.id,quizId:body.data.quizId??null,initialStatus:body.data.quizId?'pending_review':'draft',sourceReference:row.sourceReference??null,sourceReferenceStored:!!storedSourceReference}});created.push(question.id);resolved.push(question.id);
      }
      let lessonId:string|null=null;
      if(body.data.lesson&&target){
        const [last]=await tx.select({maxOrder:sql<number>`coalesce(max(lesson_order),-1)::int`}).from(s.lessons).where(eq(s.lessons.chapterId,target.id));
        const [lesson]=await tx.insert(s.lessons).values({title:body.data.lesson.title,chapterId:target.id,categoryId:body.data.questions[0].categoryId,description:'',content:'',status:'draft',lessonOrder:last.maxOrder+1,estimatedMinutes:Math.max(5,Math.ceil(created.length*.75)),passPercentage:target.passPercentage,completionXp:target.completionXp,passXp:target.passXp,perfectXp:target.perfectXp,createdBy:req.user!.id}).returning({id:s.lessons.id});
        lessonId=lesson.id;await tx.insert(s.lessonQuestions).values(resolved.map((questionId,questionOrder)=>({lessonId:lesson.id,questionId,questionOrder})));
        await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'lesson.created',entityType:'lesson',entityId:lesson.id,metadata:{importId:claim.id,questionCount:resolved.length,chapterId:target.id,status:'draft'}});
      }
      const createdLessons:{id:string;title:string;chapterTitle:string;questionCount:number}[]=[];
      if(plan&&planCourse){
        let chapterOrder=Math.max(-1,...planChapters.map(ch=>ch.chapterOrder))+1;
        for(const group of plan.groups){
          let chapter=planChapters.find(ch=>importTitleKey(ch.title)===importTitleKey(group.chapterTitle));
          if(!chapter){[chapter]=await tx.insert(s.chapters).values({courseId:planCourse.id,title:group.chapterTitle,status:'draft',chapterOrder:chapterOrder++}).returning();planChapters.push(chapter);await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'chapter.created',entityType:'chapter',entityId:chapter.id,metadata:{importId:claim.id,status:'draft'}});}
          const [last]=await tx.select({maxOrder:sql<number>`coalesce(max(lesson_order),-1)::int`}).from(s.lessons).where(eq(s.lessons.chapterId,chapter.id));
          const [row]=await tx.insert(s.lessons).values({title:group.lessonTitle,chapterId:chapter.id,categoryId:body.data.questions[group.questionIndexes[0]].categoryId,description:'',content:'',status:'draft',lessonOrder:last.maxOrder+1,estimatedMinutes:Math.max(5,Math.ceil(group.questionIndexes.length*.75)),passPercentage:planCourse.defaultLessonPassPercentage,completionXp:planCourse.lessonCompletionXp,passXp:planCourse.lessonPassXp,perfectXp:planCourse.perfectPracticeXp,createdBy:req.user!.id}).returning({id:s.lessons.id});
          await tx.insert(s.lessonQuestions).values(group.questionIndexes.map((index,questionOrder)=>({lessonId:row.id,questionId:resolved[index],questionOrder})));
          await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'lesson.created',entityType:'lesson',entityId:row.id,metadata:{importId:claim.id,status:'draft',questionCount:group.questionIndexes.length}});
          createdLessons.push({id:row.id,title:group.lessonTitle,chapterTitle:chapter.title,questionCount:group.questionIndexes.length});
        }
      }
      return{kind:'created',created,resolved,reused,quizId:body.data.quizId??null,lessonId,createdLessons} as const;
    });
    if(result.kind==='placement_unavailable')return fail(res,409,'PLACEMENT_UNAVAILABLE','Хөтөлбөр эсвэл бүлэг архивлагдсан, олдохгүй эсвэл нэр давхардсан байна.');
    if(result.kind==='chapter_unavailable')return fail(res,409,'CHAPTER_UNAVAILABLE','Сонгосон бүлэг олдсонгүй эсвэл архивлагдсан байна.');
    if(result.kind==='quiz_unavailable')return fail(res,409,'QUIZ_UNAVAILABLE','Асуулт холбох сорил нийтлэгдсэн эсэхийг шалгана уу.');
    if(result.kind==='already_imported')return fail(res,409,'FILE_ALREADY_IMPORTED','Энэ файлын мөрүүдийг өмнө нь импортолсон байна.');
    if(result.kind==='reuse_changed')return res.status(409).json({error:{code:'REUSE_VALIDATION_FAILED',message:'Импортын өмнөх асуултын шалгалт өөрчлөгдсөн байна. Preview-г дахин ажиллуулна уу.'},rows:[{row:result.row,questionId:result.questionId,questionText:'',message:'Асуулт өөрчлөгдсөн эсвэл дахин ашиглах боломжгүй болсон.'}]});
    res.status(201).json({status:result.quizId?'pending_review':'draft',quizId:result.quizId,count:result.resolved.length,createdCount:result.created.length,reusedCount:result.reused.length,questionIds:result.resolved,createdQuestionIds:result.created,reusedQuestionIds:result.reused,lessonId:result.lessonId,createdLessons:result.createdLessons});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/import/preview',requireAuth,requireRoles('admin','training_manager'),async(req,res,next)=>{
  try{
    const body=z.object({sourceFormat:z.enum(['xlsx','csv']).optional(),questions:z.array(importQuestionInput).min(1).max(200)}).safeParse(req.body);
    if(!body.success)return fail(res,400,'VALIDATION','Preview-ийн асуултын мэдээллийг шалгана уу.');
    const rows:{row:number;questionId?:string;questionText:string;message:string;canReuse?:boolean;reuseSelected?:boolean;metadataDiffers?:boolean;sourceDocument?:string;sourceLocation?:string;status?:string;blocking?:boolean}[]=[];
    const inputs=body.data.questions;
    for(const [index,question] of inputs.entries()){
      const validation=validateQuestionDraft(question);
      if(validation)rows.push({row:index+2,questionText:question.questionText,message:validation,blocking:true});
      if(question.correctAnswerText){const answer=question.options[question.correctIndexes[0]]?.text??'';const normalizeAnswer=(value:string)=>normalizeQuestionText(value).replace(/[\p{P}\p{S}\s]/gu,'');if(normalizeAnswer(question.correctAnswerText)!==normalizeAnswer(answer))rows.push({row:index+2,questionText:question.questionText,message:'Зөв хариултын тэмдэглэгээ болон текст таарахгүй байна.',blocking:true});}
      if(body.data.sourceFormat==='xlsx'&&(question.options.length!==4||question.questionType!=='single_choice'||question.correctIndexes.length!==1))rows.push({row:index+2,questionText:question.questionText,message:'Excel асуулт дөрвөн сонголттой, A/B/C/D-ээс нэг зөв хариулттай байна.',blocking:true});

    }
    const existing=await db.select({id:s.questions.id,questionText:s.questions.questionText,sourceDocument:s.questions.sourceDocument,sourceReference:s.questions.sourceReference}).from(s.questions);
    for(const[index,question]of inputs.entries()){
      const sourceMatch=question.sourceReference?existing.find(item=>item.sourceReference===question.sourceReference&&item.sourceDocument===question.sourceDocument):undefined;
      const match=sourceMatch??existing.find(item=>questionSimilarity(item.questionText,question.questionText)>=0.82);
      if(match){
        const candidate=await loadImportReuseCandidate(db,match.id),reuse=candidate&&importReuseCheck(question,candidate);
        if(question.reuseQuestionId===match.id&&reuse?.canReuse)rows.push({row:index+2,questionId:match.id,questionText:match.questionText,message:reuse.metadataDiffers?'Өмнөх асуултыг холбож болно. Одоо байгаа ангилал, эх сурвалж өөрчлөгдөхгүй.':'Яг ижил өмнөх асуултыг холбож болно.',canReuse:true,reuseSelected:true,metadataDiffers:reuse.metadataDiffers,sourceDocument:candidate?.sourceDocument??'',sourceLocation:candidate?.sourceLocation??'',status:candidate?.status??''});
        else {const reuseRequested=!!question.reuseQuestionId;rows.push({row:index+2,questionId:match.id,questionText:match.questionText,message:reuse?.canReuse?'Ижил асуулт байна. Та өмнөхийг ашиглах эсвэл шинэ давхардсан асуулт болгон импортлох боломжтой.':`${reuse?.reason||'Төстэй асуулт байна.'} Гэсэн ч шинэ бичлэг болгон импортолж болно.`,canReuse:!!reuse?.canReuse,reuseSelected:false,metadataDiffers:!!reuse?.metadataDiffers,sourceDocument:candidate?.sourceDocument??'',sourceLocation:candidate?.sourceLocation??'',status:candidate?.status??'',blocking:reuseRequested});}
      } else if(question.reuseQuestionId)rows.push({row:index+2,questionId:question.reuseQuestionId,questionText:question.questionText,message:'Сонгосон өмнөх асуулт олдсонгүй эсвэл мөртэй таарахгүй байна.',blocking:true});
    }
    const blocked=new Set(rows.filter(row=>row.blocking).map(row=>row.row));
    res.json({count:inputs.length,readyCount:inputs.length-blocked.size,invalidCount:blocked.size,rows});
  }catch(e){next(e)}
});

adminContentRouter.get('/lessons/:id',requireAuth,async(req,res,next)=>{try{const id=String(req.params.id),[lesson]=await db.select().from(s.lessons).where(eq(s.lessons.id,id)).limit(1);if(!lesson)return fail(res,404,'NOT_FOUND','Хичээл олдсонгүй.');const privileged=['admin','training_manager'].includes(req.user!.role);if(!privileged&&lesson.status!=='published')return fail(res,404,'NOT_FOUND','Нийтэлсэн хичээл олдсонгүй.');if(privileged){const links=await db.select({questionId:s.lessonQuestions.questionId}).from(s.lessonQuestions).where(eq(s.lessonQuestions.lessonId,id)).orderBy(asc(s.lessonQuestions.questionOrder));return res.json({lesson,questionIds:links.map(link=>link.questionId)})}const questions=await db.select({id:s.questions.id,questionText:s.questions.questionText,questionType:s.questions.questionType,difficulty:s.questions.difficulty}).from(s.lessonQuestions).innerJoin(s.questions,eq(s.questions.id,s.lessonQuestions.questionId)).where(and(eq(s.lessonQuestions.lessonId,id),eq(s.questions.status,'published'))).orderBy(asc(s.lessonQuestions.questionOrder));res.json({lesson,questions})}catch(e){next(e)}});

adminContentRouter.get('/lessons/:id/preview',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),[lesson]=await db.select().from(s.lessons).where(eq(s.lessons.id,id)).limit(1);
    if(!lesson)return fail(res,404,'NOT_FOUND','Хичээл олдсонгүй.');
    const linked=await db.select({question:s.questions,questionOrder:s.lessonQuestions.questionOrder}).from(s.lessonQuestions).innerJoin(s.questions,eq(s.questions.id,s.lessonQuestions.questionId)).where(eq(s.lessonQuestions.lessonId,id)).orderBy(asc(s.lessonQuestions.questionOrder));
    const questionIds=linked.map(item=>item.question.id);
    const options=questionIds.length?await db.select().from(s.questionOptions).where(inArray(s.questionOptions.questionId,questionIds)).orderBy(asc(s.questionOptions.optionOrder)):[];
    const correct=questionIds.length?await db.select().from(s.questionCorrectOptions).where(inArray(s.questionCorrectOptions.questionId,questionIds)):[];
    const items=linked.map(({question,questionOrder})=>{
      const questionOptions=options.filter(option=>option.questionId===question.id);
      const correctOptionIds=correct.filter(item=>item.questionId===question.id).map(item=>item.optionId);
      return {id:question.id,questionOrder,questionText:question.questionText,questionType:question.questionType,difficulty:question.difficulty,status:question.status,xp:question.xp,options:questionOptions.map(option=>({id:option.id,optionText:option.optionText})),correctOptionIds,explanation:question.explanation,sourceDocument:question.sourceDocument,sourceRevision:question.sourceRevision,sourceLocation:question.sourceLocation};
    });
    const blocks=await db.select().from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId,id)).orderBy(asc(s.lessonContentBlocks.blockOrder));
    const input=await readLessonPublishInput(db,id);const check=lessonPublishReasons(input!);
    const base=buildAdminLessonPreview(lesson,items);
    const placement=lesson.chapterId?(await db.select({chapterTitle:s.chapters.title,chapterStatus:s.chapters.status,courseTitle:s.courses.title,courseStatus:s.courses.status}).from(s.chapters).innerJoin(s.courses,eq(s.courses.id,s.chapters.courseId)).where(eq(s.chapters.id,lesson.chapterId)).limit(1))[0]:null;
    res.json({...base,contentBlocks:blocks,placement,review:{...base.review,readyToPublish:!check.reasons.length,reasons:check.reasons,blockingQuestions:check.blockingQuestions}});
  }catch(e){next(e)}
});

async function readLessonPublishInput(executor:any,id:string):Promise<LessonPublishInput|null>{
  const[lesson]=await executor.select({id:s.lessons.id,title:s.lessons.title,status:s.lessons.status,categoryId:s.lessons.categoryId,description:s.lessons.description,lessonOrder:s.lessons.lessonOrder,theoryRequired:s.lessons.theoryRequired}).from(s.lessons).where(eq(s.lessons.id,id)).limit(1);
  if(!lesson)return null;
  const linked=await executor.select({id:s.questions.id,status:s.questions.status,questionText:s.questions.questionText,questionType:s.questions.questionType}).from(s.lessonQuestions).innerJoin(s.questions,eq(s.questions.id,s.lessonQuestions.questionId)).where(eq(s.lessonQuestions.lessonId,id)).orderBy(asc(s.lessonQuestions.questionOrder));
  const[trainingQuiz]=await executor.select({id:s.quizzes.id}).from(s.quizzes).where(and(eq(s.quizzes.lessonId,id),eq(s.quizzes.quizType,'training'))).limit(1);
  const blocks=await executor.select({status:s.lessonContentBlocks.reviewStatus}).from(s.lessonContentBlocks).where(eq(s.lessonContentBlocks.lessonId,id));
  const ids=linked.map((q:{id:string})=>q.id);
  const allOptions=ids.length?await executor.select().from(s.questionOptions).where(inArray(s.questionOptions.questionId,ids)).orderBy(asc(s.questionOptions.optionOrder)):[];
  const allCorrect=ids.length?await executor.select().from(s.questionCorrectOptions).where(inArray(s.questionCorrectOptions.questionId,ids)):[];
  const validated=linked.map((q:{id:string;status:string;questionText:string;questionType:'single_choice'|'multiple_choice'|'true_false'})=>{const options=allOptions.filter((o:{questionId:string})=>o.questionId===q.id);const correctIds=new Set(allCorrect.filter((c:{questionId:string})=>c.questionId===q.id).map((c:{optionId:string})=>c.optionId));return {...q,validationError:validateQuestionDraft({questionText:q.questionText,questionType:q.questionType,options:options.map((o:{optionText:string})=>({text:o.optionText})),correctIndexes:options.flatMap((o:{id:string},i:number)=>correctIds.has(o.id)?[i]:[])})}});
  return{...lesson,trainingQuizLinked:!!trainingQuiz,linkedQuestions:validated,contentBlockStatuses:blocks.map((b:{status:string})=>b.status)};
}
const bulkLessonIds=z.array(z.string().uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length);
adminContentRouter.post('/lessons/bulk-training-quizzes',requireAuth,requireRoles('admin','training_manager'),async(req,res,next)=>{
  try{
    const p=z.object({lessonIds:bulkLessonIds}).safeParse(req.body);if(!p.success)return fail(res,400,'VALIDATION','Хичээлийн сонголтыг шалгана уу.');
    const result=await db.transaction(async tx=>{const linked:string[]=[],created:string[]=[],createdItems:{lessonId:string;quizId:string;title:string;status:string}[]=[],linkedItems:{lessonId:string;quizId:string}[]=[],blocked:{lessonId:string;reasons:string[]}[]=[];
      for(const lessonId of [...p.data.lessonIds].sort()){
        const[lesson]=await tx.select().from(s.lessons).where(eq(s.lessons.id,lessonId)).for('update').limit(1);
        if(!lesson){blocked.push({lessonId,reasons:['Хичээл олдсонгүй.']});continue;}
        const[existing]=await tx.select({id:s.quizzes.id,quizType:s.quizzes.quizType}).from(s.quizzes).where(eq(s.quizzes.lessonId,lessonId)).limit(1);
        const questions=await tx.select({questionId:s.lessonQuestions.questionId}).from(s.lessonQuestions).where(eq(s.lessonQuestions.lessonId,lessonId));
        const questionRows=questions.length?await tx.select({status:s.questions.status}).from(s.questions).where(inArray(s.questions.id,questions.map(question=>question.questionId))):[];
        const decision=decideTrainingQuizLink({lessonExists:!!lesson,lessonStatus:lesson?.status,questionStatuses:questionRows.map(question=>question.status),existingQuiz:existing??null});
        if(decision.kind==='missing_lesson'){blocked.push({lessonId,reasons:['Хичээл олдсонгүй.']});continue;}
        if(decision.kind==='already_linked'){linked.push(decision.quizId);linkedItems.push({lessonId,quizId:decision.quizId});continue;}
        if(decision.kind==='quiz_type_conflict'){blocked.push({lessonId,reasons:['Энэ хичээлд сургалтын бус сорил аль хэдийн холбогдсон байна.']});continue;}
        if(decision.kind==='question_count'){blocked.push({lessonId,reasons:[`Сургалтын сорил үүсгэхэд хичээлд 1–100 асуулт хэрэгтэй (одоогоор ${decision.actual}).`]});continue;}
        if(decision.kind==='published_questions_required'){blocked.push({lessonId,reasons:['Нийтэлсэн хичээлд зөвхөн нийтлэгдсэн асуулттай үед сургалтын сорил холбож болно.']});continue;}
        const title=`Их бие — Сорил ${String(lesson.lessonOrder).padStart(2,'0')}`;
        const[sameName]=await tx.select({id:s.quizzes.id,lessonId:s.quizzes.lessonId,quizType:s.quizzes.quizType}).from(s.quizzes).where(eq(s.quizzes.title,title)).limit(1);
        if(sameName){blocked.push({lessonId,reasons:[`“${title}” нэртэй сорил аль хэдийн байна. Давхардлыг автоматаар холбохгүй; админаар шалгуулна уу.`]});continue;}
        const[quiz]=await tx.insert(s.quizzes).values({title,description:lesson.description,quizType:'training',lessonId,categoryId:lesson.categoryId,questionCount:questions.length,passingPercentage:80,attemptsAllowed:1,createdBy:req.user!.id,status:lesson.status==='published'?'published':'draft'}).returning({id:s.quizzes.id});
        const quizStatus=lesson.status==='published'?'published':'draft';
        await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'training_quiz.linked',entityType:'lesson',entityId:lessonId,metadata:{quizId:quiz.id,questionCount:questions.length,status:quizStatus}});created.push(quiz.id);createdItems.push({lessonId,quizId:quiz.id,title,status:quizStatus});
      }
      return{linked,created,createdItems,linkedItems,blocked};
    });
    res.json({createdCount:result.created.length,createdQuizIds:result.created,createdItems:result.createdItems,alreadyLinkedCount:result.linked.length,alreadyLinkedQuizIds:result.linked,alreadyLinkedItems:result.linkedItems,blockedCount:result.blocked.length,blocked:result.blocked});
  }catch(e){next(e)}
});
adminContentRouter.post('/lessons/bulk-publish/preview',requireAuth,requireRoles('admin','training_manager'),async(req,res,next)=>{
  try{const p=z.object({lessonIds:bulkLessonIds}).safeParse(req.body);if(!p.success)return fail(res,400,'VALIDATION','Хичээлийн сонголтыг шалгана уу.');const items=[];for(const id of p.data.lessonIds){const lesson=await readLessonPublishInput(db,id);const result=lesson?lessonPublishReasons(lesson):{reasons:['Хичээл олдсонгүй.'],blockingQuestionIds:[],blockingQuestions:[]};items.push({id,title:lesson?.title,ready:!result.reasons.length,reasons:result.reasons,blockingQuestionIds:result.blockingQuestionIds,blockingQuestions:result.blockingQuestions})}res.json({total:items.length,readyCount:items.filter(item=>item.ready).length,blockedCount:items.filter(item=>!item.ready).length,items})}catch(e){next(e)}
});
adminContentRouter.post('/lessons/bulk-publish',requireAuth,requireRoles('admin','training_manager'),async(req,res,next)=>{
  try{const p=z.object({lessonIds:bulkLessonIds}).safeParse(req.body);if(!p.success)return fail(res,400,'VALIDATION','Хичээлийн сонголтыг шалгана уу.');const result=await db.transaction(async tx=>{const published:string[]=[],blocked:{id:string;title?:string;reasons:string[];blockingQuestionIds:string[]}[]=[];for(const id of [...p.data.lessonIds].sort()){await tx.execute(sql`select id from lessons where id=${id} for update`);const lesson=await readLessonPublishInput(tx,id);if(!lesson){blocked.push({id,reasons:['Хичээл олдсонгүй.'],blockingQuestionIds:[]});continue}const check=lessonPublishReasons(lesson);if(check.reasons.length){blocked.push({id,title:lesson.title,...check});continue}const now=new Date();await tx.update(s.lessons).set({status:'published',updatedAt:now}).where(and(eq(s.lessons.id,id),eq(s.lessons.status,'draft')));await tx.update(s.quizzes).set({status:'published',updatedAt:now}).where(and(eq(s.quizzes.lessonId,id),eq(s.quizzes.quizType,'training')));await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'lesson.published',entityType:'lesson',entityId:id,metadata:{bulk:true,lessonOrder:(await tx.select({lessonOrder:s.lessons.lessonOrder}).from(s.lessons).where(eq(s.lessons.id,id)).limit(1))[0]?.lessonOrder}});published.push(id)}return{published,blocked}});res.json({publishedCount:result.published.length,publishedIds:result.published,blockedCount:result.blocked.length,blocked:result.blocked})}catch(e){next(e)}
});

adminContentRouter.post('/lessons',requireAuth,requireRoles('admin','training_manager'),async(req,res,next)=>{
  try{
    const p=z.object({title:z.string().trim().min(1).max(200),categoryId:z.string().uuid().optional(),description:z.string().trim().max(2000).default(''),content:z.string().trim().max(30000).default(''),questionIds:z.array(z.string().uuid()).max(100).default([]),lessonOrder:z.number().int().min(0).max(10000).default(0)}).safeParse(req.body);
    if(!p.success)return fail(res,400,'VALIDATION','Хичээлийн гарчиг, ангилал, тайлбар, агуулгыг шалгана уу.');
    if(!hasUniqueIds(p.data.questionIds))return fail(res,400,'VALIDATION','Нэг асуултыг хичээлд давхар холбох боломжгүй.');
    const lesson=await db.transaction(async tx=>{const categoryId=p.data.categoryId??(await tx.select({id:s.categories.id}).from(s.categories).where(eq(s.categories.isActive,true)).orderBy(asc(s.categories.name)).limit(1))[0]?.id;if(!categoryId)throw Object.assign(new Error('Идэвхтэй ангилал олдсонгүй.'),{status:400});const selected=await tx.select({id:s.questions.id}).from(s.questions).where(inArray(s.questions.id,p.data.questionIds));if(selected.length!==p.data.questionIds.length)throw Object.assign(new Error('Зарим асуулт олдсонгүй.'),{status:400});const[row]=await tx.insert(s.lessons).values({title:p.data.title,categoryId,description:p.data.description,content:p.data.content,lessonOrder:p.data.lessonOrder,createdBy:req.user!.id}).returning();if(p.data.questionIds.length)await tx.insert(s.lessonQuestions).values(p.data.questionIds.map((questionId,questionOrder)=>({lessonId:row.id,questionId,questionOrder})));await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'lesson.created',entityType:'lesson',entityId:row.id});return row});
    res.status(201).json({lesson});
  }catch(e){next(e)}
});

adminContentRouter.put('/lessons/:id',requireAuth,requireRoles('admin','training_manager'),async(req,res,next)=>{
  try{
    const p=z.object({title:z.string().trim().min(1).max(200),categoryId:z.string().uuid().optional(),description:z.string().trim().max(2000).default(''),content:z.string().trim().max(30000).default(''),questionIds:z.array(z.string().uuid()).max(100).default([]),status:z.enum(['draft','published']),lessonOrder:z.number().int().min(0).max(10000).default(0)}).safeParse(req.body);
    if(!p.success)return fail(res,400,'VALIDATION','Хичээлийн мэдээллийг шалгана уу.');if(!hasUniqueIds(p.data.questionIds))return fail(res,400,'VALIDATION','Нэг асуултыг хичээлд давхар холбох боломжгүй.');
    const id=String(req.params.id),result=await db.transaction(async tx=>{const[old]=await tx.select().from(s.lessons).where(eq(s.lessons.id,id)).for('update').limit(1);if(!old)return'not_found' as const;const selected=p.data.questionIds.length?await tx.select({id:s.questions.id,status:s.questions.status}).from(s.questions).where(inArray(s.questions.id,p.data.questionIds)):[];if(selected.length!==p.data.questionIds.length)return'questions_missing' as const;if(p.data.status==='published'&&(selected.length<1||selected.length>100||selected.some(question=>question.status!=='published')))return'publish_questions_invalid' as const;const now=new Date();await tx.update(s.lessons).set({title:p.data.title,categoryId:p.data.categoryId,description:p.data.description,content:p.data.content,status:p.data.status,lessonOrder:p.data.lessonOrder,updatedAt:now}).where(eq(s.lessons.id,id));await tx.delete(s.lessonQuestions).where(eq(s.lessonQuestions.lessonId,id));if(p.data.questionIds.length)await tx.insert(s.lessonQuestions).values(p.data.questionIds.map((questionId,questionOrder)=>({lessonId:id,questionId,questionOrder})));await tx.update(s.quizzes).set({status:p.data.status,updatedAt:now,title:`Их бие — Сорил ${String(p.data.lessonOrder).padStart(2,'0')}`,description:p.data.description,questionCount:p.data.questionIds.length}).where(and(eq(s.quizzes.lessonId,id),eq(s.quizzes.quizType,'training')));await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'lesson.updated',entityType:'lesson',entityId:id,metadata:{previousStatus:old.status,newStatus:p.data.status,lessonOrder:p.data.lessonOrder}});return'updated' as const});
    if(result==='not_found')return fail(res,404,'NOT_FOUND','Хичээл олдсонгүй.');if(result==='questions_missing')return fail(res,400,'VALIDATION','Холбох асуултын нэг эсвэл хэд нь олдсонгүй.');if(result==='publish_questions_invalid')return fail(res,409,'LESSON_NOT_READY','Нийтлэхийн өмнө 1–100 нийтлэгдсэн асуултыг хичээлтэй холбоно уу.');res.json({status:'updated'});
  }catch(e){next(e)}
});

adminContentRouter.post('/lessons/:id/archive',requireAuth,requireRoles('admin'),async(req,res,next)=>{try{const id=String(req.params.id);const[lesson]=await db.transaction(async tx=>{const[row]=await tx.update(s.lessons).set({status:'archived',updatedAt:new Date()}).where(eq(s.lessons.id,id)).returning({id:s.lessons.id});if(row){await tx.update(s.quizzes).set({status:'archived',updatedAt:new Date()}).where(and(eq(s.quizzes.lessonId,id),eq(s.quizzes.quizType,'training')));await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'lesson.archived',entityType:'lesson',entityId:id})}return[row]});if(!lesson)return fail(res,404,'NOT_FOUND','Хичээл олдсонгүй.');res.json({status:'archived'})}catch(e){next(e)}});

adminContentRouter.get('/admin/quizzes',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const search=typeof req.query.q==='string'?req.query.q.trim():'';
    const status=typeof req.query.status==='string'?req.query.status:undefined;
    if(status&&!['draft','published','archived'].includes(status))return fail(res,400,'VALIDATION','Сорилын төлөв буруу байна.');
    const conditions=[isNull(s.quizzes.lessonId)];
    if(search)conditions.push(ilike(s.quizzes.title,`%${search}%`));
    if(status)conditions.push(eq(s.quizzes.status,status));
    const items=await db.select({id:s.quizzes.id,title:s.quizzes.title,description:s.quizzes.description,questionCount:s.quizzes.questionCount,timeLimitSeconds:s.quizzes.timeLimitSeconds,passingPercentage:s.quizzes.passingPercentage,attemptsAllowed:s.quizzes.attemptsAllowed,status:s.quizzes.status,isTest:s.quizzes.isTest,updatedAt:s.quizzes.updatedAt}).from(s.quizzes).where(conditions.length?and(...conditions):undefined).orderBy(desc(s.quizzes.updatedAt));
    res.json({items});
  }catch(e){next(e)}
});

adminContentRouter.get('/admin/quizzes/:id/test-purge-preview',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),[quiz]=await db.select({id:s.quizzes.id,title:s.quizzes.title,status:s.quizzes.status,isTest:s.quizzes.isTest,questionCount:s.quizzes.questionCount}).from(s.quizzes).where(eq(s.quizzes.id,id)).limit(1);
    if(!quiz)return fail(res,404,'NOT_FOUND','Сорил олдсонгүй.');
    const[attempts,questionLinks,answerRows,answerOptionRows,competitions,auditRows,foreignKeys]=await Promise.all([
      db.select({id:s.quizAttempts.id,status:s.quizAttempts.status,score:s.quizAttempts.score,userId:s.quizAttempts.userId,username:s.users.username,fullName:s.users.fullName,startedAt:s.quizAttempts.startedAt}).from(s.quizAttempts).innerJoin(s.users,eq(s.users.id,s.quizAttempts.userId)).where(eq(s.quizAttempts.quizId,id)),
      db.select({questionId:s.quizQuestions.questionId}).from(s.quizQuestions).where(eq(s.quizQuestions.quizId,id)),
      db.select({id:s.answers.id}).from(s.answers).innerJoin(s.quizAttempts,eq(s.quizAttempts.id,s.answers.attemptId)).where(eq(s.quizAttempts.quizId,id)),
      db.select({answerId:s.answerOptions.answerId}).from(s.answerOptions).innerJoin(s.answers,eq(s.answers.id,s.answerOptions.answerId)).innerJoin(s.quizAttempts,eq(s.quizAttempts.id,s.answers.attemptId)).where(eq(s.quizAttempts.quizId,id)),
      db.select({id:s.competitions.id,title:s.competitions.title,status:s.competitions.status}).from(s.competitions).where(eq(s.competitions.quizId,id)),
      db.select({id:s.auditLogs.id,action:s.auditLogs.action}).from(s.auditLogs).where(and(eq(s.auditLogs.entityType,'quiz'),eq(s.auditLogs.entityId,id))),
      db.execute(sql`SELECT DISTINCT referenced.relname AS table_name FROM pg_constraint fk JOIN pg_class referenced ON referenced.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=referenced.relnamespace JOIN pg_class target ON target.oid=fk.confrelid JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace WHERE fk.contype='f' AND ns.nspname='public' AND target_ns.nspname='public' AND target.relname='quizzes'`),
    ]);
    const unknownForeignKeyTables=foreignKeys.rows.map((row:Record<string,unknown>)=>String(row.table_name)).filter(table=>!['quiz_attempts','quiz_questions','competitions'].includes(table));
    const attemptAuditRows=attempts.length?await db.select({id:s.auditLogs.id,action:s.auditLogs.action}).from(s.auditLogs).where(and(eq(s.auditLogs.entityType,'quiz_attempt'),inArray(s.auditLogs.entityId,attempts.map(attempt=>attempt.id)))):[];
    const candidate={title:quiz.title,status:quiz.status,isTest:quiz.isTest},competitionCount=competitions.length;
    const statusCounts={in_progress:0,submitted:0,expired:0,voided:0};for(const attempt of attempts)statusCounts[attempt.status]++;
    const sharedQuestionCount=questionLinks.length?await db.select({questionId:s.quizQuestions.questionId}).from(s.quizQuestions).where(and(inArray(s.quizQuestions.questionId,questionLinks.map(link=>link.questionId)),sql`${s.quizQuestions.quizId} <> ${id}`)):[];
    res.json({quiz:{...quiz,quizQuestionLinkCount:questionLinks.length},attempts:attempts.map(({id,status,score,username,fullName,startedAt})=>({id,status,score,username,fullName,startedAt})),attemptCount:attempts.length,attemptsByStatus:statusCounts,attemptUserCount:new Set(attempts.map(attempt=>attempt.userId)).size,scoreTotal:attempts.reduce((sum,attempt)=>sum+attempt.score,0),answerCount:answerRows.length,answerOptionCount:answerOptionRows.length,competitionCount,competitions,auditLogCount:auditRows.length+attemptAuditRows.length,auditActions:[...new Set([...auditRows,...attemptAuditRows].map(row=>row.action))],sharedQuestionLinkCount:sharedQuestionCount.length,unknownForeignKeyTables,canMarkTest:canMarkQuizAsTest(candidate,competitionCount),canPurge:canPermanentlyPurgeTestQuiz({candidate,confirmedTestOnly:true,confirmationTitle:quiz.title,competitionCount,unknownForeignKeyTables})});
  }catch(e){next(e)}
});

adminContentRouter.post('/admin/quizzes/:id/mark-test',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=z.object({confirmationTitle:z.string().min(1).max(200),confirmedTestOnly:z.literal(true)}).safeParse(req.body);
    if(!parsed.success)return fail(res,400,'TEST_ATTESTATION_REQUIRED','Сорилыг туршилтынх гэж баталгаажуулна уу.');
    const result=await db.transaction(async tx=>{
      const id=String(req.params.id),[quiz]=await tx.select().from(s.quizzes).where(eq(s.quizzes.id,id)).for('update').limit(1);
      if(!quiz)return{kind:'not_found'} as const;
      const competitions=await tx.select({id:s.competitions.id}).from(s.competitions).where(eq(s.competitions.quizId,id));
      if(parsed.data.confirmationTitle!==quiz.title)return{kind:'title_mismatch'} as const;
      if(!canMarkQuizAsTest({title:quiz.title,status:quiz.status,isTest:quiz.isTest},competitions.length))return{kind:'not_eligible'} as const;
      await tx.update(s.quizzes).set({isTest:true,updatedAt:new Date()}).where(eq(s.quizzes.id,id));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'quiz.marked_test_only',entityType:'quiz',entityId:id,metadata:{title:quiz.title,competitionCount:competitions.length}});
      return{kind:'marked'} as const;
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Сорил олдсонгүй.');
    if(result.kind==='title_mismatch')return fail(res,409,'TITLE_MISMATCH','Сорилын нэр өөрчлөгдсөн байна. Жагсаалтыг шинэчлээд дахин шалгана уу.');
    if(result.kind==='not_eligible')return fail(res,409,'TEST_MARK_NOT_ALLOWED','Зөвхөн архивласан, уралдаантай холбоогүй, өмнө нь туршилт гэж тэмдэглээгүй сорилыг тэмдэглэнэ.');
    res.json({isTest:true,message:'Сорилыг админы баталгаатайгаар туршилтын гэж тэмдэглэлээ.'});
  }catch(e){next(e)}
});

adminContentRouter.post('/admin/quizzes/:id/purge-test',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=z.object({confirmationTitle:z.string().min(1).max(200),confirmedTestOnly:z.literal(true)}).safeParse(req.body);
    if(!parsed.success)return fail(res,400,'TEST_ATTESTATION_REQUIRED','Сорилын нэрийг яг хэвээр бичиж, туршилтын сорил гэдгийг баталгаажуулна уу.');
    const id=String(req.params.id),[preflight]=await db.select().from(s.quizzes).where(eq(s.quizzes.id,id)).limit(1);
    if(!preflight)return fail(res,404,'NOT_FOUND','Сорил олдсонгүй.');
    const competitionCount=(await db.select({id:s.competitions.id}).from(s.competitions).where(eq(s.competitions.quizId,id))).length;
    const fkResult=await db.execute(sql`SELECT DISTINCT referenced.relname AS table_name FROM pg_constraint fk JOIN pg_class referenced ON referenced.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=referenced.relnamespace JOIN pg_class target ON target.oid=fk.confrelid JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace WHERE fk.contype='f' AND ns.nspname='public' AND target_ns.nspname='public' AND target.relname='quizzes'`);
    const unknownForeignKeyTables=fkResult.rows.map((row:Record<string,unknown>)=>String(row.table_name)).filter(table=>!['quiz_attempts','quiz_questions','competitions'].includes(table));
    if(!canPermanentlyPurgeTestQuiz({candidate:{title:preflight.title,status:preflight.status,isTest:preflight.isTest},confirmedTestOnly:parsed.data.confirmedTestOnly,confirmationTitle:parsed.data.confirmationTitle,competitionCount,unknownForeignKeyTables}))return fail(res,409,'TEST_PURGE_BLOCKED','Устгал зөвхөн архивласан, туршилтын гэж тэмдэглэсэн, тэмцээнгүй бөгөөд бүх хамаарал нь танигдсан сорилд зөвшөөрөгдөнө.');
    let backup:{path:string;sizeBytes:number;verifiedAt:string};
    try{backup=await createVerifiedTestDatabaseBackup(process.env.DATABASE_URL||'',id);}catch(error){const code=error instanceof Error?error.message:'';return fail(res,503,'BACKUP_REQUIRED',code==='BACKUP_TOOL_MISSING'?'pg_dump эсвэл pg_restore олдсонгүй. Нөөц баталгаажих хүртэл устгал хийгдэхгүй.':'Өгөгдлийн сангийн нөөц хуулбар үүсгэж баталгаажуулж чадсангүй. Устгал хийгдээгүй.');}
    const result=await db.transaction(async tx=>{
      const[quiz]=await tx.select().from(s.quizzes).where(eq(s.quizzes.id,id)).for('update').limit(1);
      if(!quiz)return{kind:'not_found'} as const;
      const competitions=await tx.select({id:s.competitions.id}).from(s.competitions).where(eq(s.competitions.quizId,id));
      const fk=await tx.execute(sql`SELECT DISTINCT referenced.relname AS table_name FROM pg_constraint fk JOIN pg_class referenced ON referenced.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=referenced.relnamespace JOIN pg_class target ON target.oid=fk.confrelid JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace WHERE fk.contype='f' AND ns.nspname='public' AND target_ns.nspname='public' AND target.relname='quizzes'`);
      const unknown= fk.rows.map((row:Record<string,unknown>)=>String(row.table_name)).filter(table=>!['quiz_attempts','quiz_questions','competitions'].includes(table));
      if(!canPermanentlyPurgeTestQuiz({candidate:{title:quiz.title,status:quiz.status,isTest:quiz.isTest},confirmedTestOnly:parsed.data.confirmedTestOnly,confirmationTitle:parsed.data.confirmationTitle,competitionCount:competitions.length,unknownForeignKeyTables:unknown}))return{kind:'changed'} as const;
      const attempts=await tx.select({id:s.quizAttempts.id,score:s.quizAttempts.score}).from(s.quizAttempts).where(eq(s.quizAttempts.quizId,id)).for('update');
      const attemptIds=attempts.map(attempt=>attempt.id);
      const answers=attemptIds.length?await tx.select({id:s.answers.id}).from(s.answers).where(inArray(s.answers.attemptId,attemptIds)):[];
      const answerOptions=answers.length?await tx.select({answerId:s.answerOptions.answerId}).from(s.answerOptions).where(inArray(s.answerOptions.answerId,answers.map(answer=>answer.id))):[];
      const links=await tx.select({id:s.quizQuestions.id,questionId:s.quizQuestions.questionId}).from(s.quizQuestions).where(eq(s.quizQuestions.quizId,id));
      const sharedQuestionLinks=links.length?await tx.select({id:s.quizQuestions.id}).from(s.quizQuestions).where(and(inArray(s.quizQuestions.questionId,links.map(link=>link.questionId)),sql`${s.quizQuestions.quizId} <> ${id}`)):[];
      const quizAuditRows=await tx.select({id:s.auditLogs.id}).from(s.auditLogs).where(and(eq(s.auditLogs.entityType,'quiz'),eq(s.auditLogs.entityId,id)));
      const attemptAuditRows=attemptIds.length?await tx.select({id:s.auditLogs.id}).from(s.auditLogs).where(and(eq(s.auditLogs.entityType,'quiz_attempt'),inArray(s.auditLogs.entityId,attemptIds))):[];
      if(answers.length)await tx.delete(s.answers).where(inArray(s.answers.id,answers.map(answer=>answer.id)));
      if(attemptIds.length)await tx.delete(s.quizAttempts).where(inArray(s.quizAttempts.id,attemptIds));
      if(links.length)await tx.delete(s.quizQuestions).where(eq(s.quizQuestions.quizId,id));
      if(attemptAuditRows.length)await tx.delete(s.auditLogs).where(inArray(s.auditLogs.id,attemptAuditRows.map(row=>row.id)));
      if(quizAuditRows.length)await tx.delete(s.auditLogs).where(inArray(s.auditLogs.id,quizAuditRows.map(row=>row.id)));
      await tx.delete(s.quizzes).where(eq(s.quizzes.id,id));
      const counts={quizzes:1,attempts:attemptIds.length,scoreRecords:attempts.length,answers:answers.length,answerOptions:answerOptions.length,quizQuestionLinks:links.length,quizAuditLogs:quizAuditRows.length,attemptAuditLogs:attemptAuditRows.length,questions:0,sharedQuestionLinksPreserved:sharedQuestionLinks.length};
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'quiz.test_purged',entityType:'quiz_deletion',entityId:id,metadata:{quizId:id,title:quiz.title,deletedAt:new Date().toISOString(),counts,backupPath:backup.path,backupSizeBytes:backup.sizeBytes,backupVerifiedAt:backup.verifiedAt}});
      return{kind:'purged',counts} as const;
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Сорил олдсонгүй.');
    if(result.kind==='changed')return fail(res,409,'TEST_PURGE_BLOCKED','Устгах урьдчилсан нөхцөл өөрчлөгдсөн байна. Нөөцийн хуулбар хадгалагдсан, өгөгдөл устгаагүй.');
    res.json({status:'deleted',backup,counts:result.counts,message:'Баталгаажсан нөөцийн дараа зөвхөн сонгосон туршилтын сорил болон холбоотой оролдлогыг устгалаа. Асуултууд хадгалагдсан.'});
  }catch(e){next(e)}
});

adminContentRouter.get('/admin/attempts',requireAuth,requireRoles('admin'),async(_req,res,next)=>{
  try{
    const rows=await db.select({id:s.quizAttempts.id,quizId:s.quizAttempts.quizId,quizTitle:s.quizzes.title,userId:s.quizAttempts.userId,username:s.users.username,fullName:s.users.fullName,status:s.quizAttempts.status,startedAt:s.quizAttempts.startedAt,submittedAt:s.quizAttempts.submittedAt,score:s.quizAttempts.score,timeLimitSeconds:s.quizzes.timeLimitSeconds}).from(s.quizAttempts).innerJoin(s.quizzes,eq(s.quizzes.id,s.quizAttempts.quizId)).innerJoin(s.users,eq(s.users.id,s.quizAttempts.userId)).orderBy(desc(s.quizAttempts.startedAt)).limit(300);
    const now=new Date();
    res.json({items:rows.map(row=>({...row,elapsedSeconds:Math.max(0,Math.floor((now.getTime()-row.startedAt.getTime())/1000)),timeExpired:row.status==='in_progress'&&isAttemptTimeExpired(row.startedAt,row.timeLimitSeconds,now),canVoid:canVoidAttempt(row.status)}))});
  }catch(e){next(e)}
});

adminContentRouter.post('/admin/attempts/:id/void',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=z.object({reason:z.string().trim().min(5).max(500)}).safeParse(req.body);
    if(!parsed.success)return fail(res,400,'VALIDATION','Хүчингүй болгох 5–500 тэмдэгтийн үндэслэл оруулна уу.');
    const result=await db.transaction(async tx=>{
      const id=String(req.params.id),[peek]=await tx.select({quizId:s.quizAttempts.quizId}).from(s.quizAttempts).where(eq(s.quizAttempts.id,id)).limit(1);
      if(!peek)return{kind:'not_found'} as const;
      await tx.select({id:s.quizzes.id}).from(s.quizzes).where(eq(s.quizzes.id,peek.quizId)).for('update').limit(1);
      const[attempt]=await tx.select().from(s.quizAttempts).where(eq(s.quizAttempts.id,id)).for('update').limit(1);
      if(!attempt)return{kind:'not_found'} as const;
      if(!canVoidAttempt(attempt.status))return{kind:'not_voidable',status:attempt.status} as const;
      await tx.update(s.quizAttempts).set({status:'voided'}).where(and(eq(s.quizAttempts.id,id),eq(s.quizAttempts.status,'in_progress')));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'attempt.voided',entityType:'quiz_attempt',entityId:id,metadata:{quizId:attempt.quizId,previousStatus:attempt.status,reason:parsed.data.reason}});
      return{kind:'voided'} as const;
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Оролдлого олдсонгүй.');
    if(result.kind==='not_voidable')return fail(res,409,'ATTEMPT_NOT_VOIDABLE',result.status==='submitted'?'Илгээсэн оролдлогыг хүчингүй болгох боломжгүй.':'Зөвхөн дуусаагүй оролдлогыг хүчингүй болгоно.');
    res.json({status:'voided',message:'Сонгосон оролдлогыг хүчингүй болгож, хариулт болон түүхийг хадгаллаа.'});
  }catch(e){next(e)}
});

adminContentRouter.post('/quizzes/:id/archive',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const result=await db.transaction(async tx=>{
      const id=String(req.params.id),[quiz]=await tx.select().from(s.quizzes).where(eq(s.quizzes.id,id)).for('update').limit(1);
      if(!quiz)return{kind:'not_found'} as const;
      if(quiz.status==='archived')return{kind:'already_archived'} as const;
      const active=await tx.select({id:s.quizAttempts.id}).from(s.quizAttempts).where(and(eq(s.quizAttempts.quizId,id),eq(s.quizAttempts.status,'in_progress'))).limit(1);
      if(active.length)return{kind:'in_progress'} as const;
      const competition=await tx.select({id:s.competitions.id}).from(s.competitions).where(and(eq(s.competitions.quizId,id),inArray(s.competitions.status,['scheduled','active']))).limit(1);
      if(competition.length)return{kind:'competition_active'} as const;
      await tx.update(s.quizzes).set({status:'archived',updatedAt:new Date()}).where(eq(s.quizzes.id,id));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'quiz.archived',entityType:'quiz',entityId:id});
      return{kind:'archived'} as const;
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Сорил олдсонгүй.');
    if(result.kind==='already_archived')return fail(res,409,'ALREADY_ARCHIVED','Сорил өмнө нь архивлагдсан байна.');
    if(result.kind==='in_progress')return fail(res,409,'ACTIVE_ATTEMPTS','Идэвхтэй оролдлого дууссаны дараа сорилыг архивлана уу.');
    if(result.kind==='competition_active')return fail(res,409,'ACTIVE_COMPETITION','Явагдаж буй эсвэл товлосон уралдаантай сорилыг архивлах боломжгүй.');
    res.json({status:'archived'});
  }catch(e){next(e)}
});

adminContentRouter.post('/quizzes/:id/restore',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),now=new Date();
    const[quiz]=await db.update(s.quizzes).set({status:'draft',updatedAt:now}).where(and(eq(s.quizzes.id,id),eq(s.quizzes.status,'archived'))).returning({id:s.quizzes.id});
    if(!quiz)return fail(res,404,'ARCHIVED_NOT_FOUND','Архивласан сорил олдсонгүй.');
    await db.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'quiz.restored',entityType:'quiz',entityId:id});
    res.json({status:'draft',message:'Сорилыг ноорог төлөвт сэргээлээ. Суралцагчдад харагдуулахын тулд дахин нийтэлнэ үү.'});
  }catch(e){next(e)}
});

adminContentRouter.get('/admin/quizzes/:id',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),[quiz]=await db.select().from(s.quizzes).where(eq(s.quizzes.id,id)).limit(1);
    if(!quiz)return fail(res,404,'NOT_FOUND','Сорил олдсонгүй.');
    const links=await db.select({questionId:s.quizQuestions.questionId,questionOrder:s.quizQuestions.questionOrder,points:s.quizQuestions.points,status:s.questions.status}).from(s.quizQuestions).innerJoin(s.questions,eq(s.questions.id,s.quizQuestions.questionId)).where(eq(s.quizQuestions.quizId,id)).orderBy(asc(s.quizQuestions.questionOrder));
    const attempts=await db.select({id:s.quizAttempts.id,status:s.quizAttempts.status}).from(s.quizAttempts).where(eq(s.quizAttempts.quizId,id));
    res.json({quiz:{...quiz,pointsPerQuestion:links[0]?.points??100},questionIds:links.filter(link=>link.status==='published').map(link=>link.questionId),pendingQuestionCount:links.filter(link=>link.status==='pending_review').length,attemptCount:attempts.length,inProgressCount:attempts.filter(attempt=>attempt.status==='in_progress').length});
  }catch(e){next(e)}
});

adminContentRouter.put('/quizzes/:id',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=quizInput.safeParse(req.body);
    if(!parsed.success)return fail(res,400,'VALIDATION','Сорилын нэр, асуулт, хугацаа, тэнцэх босго болон төлөвийг шалгана уу.');
    const input=parsed.data;
    if(!hasUniqueIds(input.questionIds))return fail(res,400,'VALIDATION','Нэг асуултыг сорилд давхар оруулах боломжгүй.');
    const result=await db.transaction(async tx=>{
      const id=String(req.params.id),[quiz]=await tx.select().from(s.quizzes).where(eq(s.quizzes.id,id)).for('update').limit(1);
      if(!quiz)return{kind:'not_found'} as const;
      if(quiz.status==='archived')return{kind:'restore_required'} as const;
      if(input.isTest&&!quiz.isTest&&quiz.status!=='draft'&&input.status!=='draft')return{kind:'test_requires_draft'} as const;
      const competition=await tx.select({id:s.competitions.id}).from(s.competitions).where(and(eq(s.competitions.quizId,id),inArray(s.competitions.status,['scheduled','active']))).limit(1);
      if(competition.length)return{kind:'competition_active'} as const;
      const oldLinks=await tx.select({questionId:s.quizQuestions.questionId,questionOrder:s.quizQuestions.questionOrder,points:s.quizQuestions.points,status:s.questions.status}).from(s.quizQuestions).innerJoin(s.questions,eq(s.questions.id,s.quizQuestions.questionId)).where(eq(s.quizQuestions.quizId,id)).orderBy(asc(s.quizQuestions.questionOrder));
      const preservedUnpublishedLinks=oldLinks.filter(link=>link.status!=='published');
      const nextIds=[...input.questionIds,...preservedUnpublishedLinks.map(link=>link.questionId)];
      const oldIds=oldLinks.map(link=>link.questionId);
      const questionSetChanged=oldIds.length!==nextIds.length||oldIds.some((questionId,index)=>questionId!==nextIds[index]);
      const selected=await tx.select({id:s.questions.id}).from(s.questions).where(and(inArray(s.questions.id,input.questionIds),eq(s.questions.status,'published')));
      if(selected.length!==input.questionIds.length)return{kind:'questions_unavailable'} as const;
      await tx.update(s.quizzes).set({title:input.title,description:input.description,questionCount:input.questionIds.length,timeLimitSeconds:input.timeLimitSeconds,passingPercentage:input.passingPercentage,attemptsAllowed:input.attemptsAllowed,isTest:input.isTest,status:input.status,updatedAt:new Date()}).where(eq(s.quizzes.id,id));
      if(questionSetChanged){
        await tx.delete(s.quizQuestions).where(eq(s.quizQuestions.quizId,id));
        await tx.insert(s.quizQuestions).values(nextIds.map((questionId,index)=>({quizId:id,questionId,questionOrder:index,points:input.pointsPerQuestion})));
      }else await tx.update(s.quizQuestions).set({points:input.pointsPerQuestion}).where(eq(s.quizQuestions.quizId,id));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'quiz.updated',entityType:'quiz',entityId:id,metadata:{questionSetChanged,previousStatus:quiz.status,newStatus:input.status}});
      return{kind:'updated'} as const;
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Сорил олдсонгүй.');
    if(result.kind==='restore_required')return fail(res,409,'ARCHIVED','Өөрчлөхийн өмнө сорилыг сэргээнэ үү.');
    if(result.kind==='test_requires_draft')return fail(res,409,'TEST_QUIZ_REQUIRES_DRAFT','Сорилыг эхлээд ноорог төлөвт оруулсны дараа туршилтын гэж тэмдэглэнэ үү.');
    if(result.kind==='competition_active')return fail(res,409,'ACTIVE_COMPETITION','Төлөвлөсөн эсвэл явагдаж буй уралдаантай холбогдсон сорилыг одоогоор засах боломжгүй.');
    if(result.kind==='questions_unavailable')return fail(res,409,'QUESTIONS_UNAVAILABLE','Зөвхөн нийтэлсэн асуултуудыг сонгоно уу.');
    res.json({status:'updated'});
  }catch(e){next(e)}
});

adminContentRouter.delete('/quizzes/:id',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const result=await db.transaction(async tx=>{
      const id=String(req.params.id),[quiz]=await tx.select().from(s.quizzes).where(eq(s.quizzes.id,id)).for('update').limit(1);
      if(!quiz)return{kind:'not_found'} as const;
      if(quiz.status!=='archived')return{kind:'must_archive'} as const;
      const attempts=await tx.select({id:s.quizAttempts.id,status:s.quizAttempts.status}).from(s.quizAttempts).where(eq(s.quizAttempts.quizId,id)).limit(1);
      if(attempts.length)return{kind:'attempt_history'} as const;
      const competitions=await tx.select({id:s.competitions.id,status:s.competitions.status}).from(s.competitions).where(eq(s.competitions.quizId,id));
      if(!canPermanentlyDeleteQuiz(quiz.status,attempts.length,competitions.length))return{kind:competitions.length?'competition_history':'attempt_history'} as const;
      await tx.delete(s.quizzes).where(eq(s.quizzes.id,id));
      return{kind:'deleted'} as const;
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Сорил олдсонгүй.');
    if(result.kind==='must_archive')return fail(res,409,'ARCHIVE_FIRST','Бүр мөсөн устгахын өмнө сорилыг архивлана уу.');
    if(result.kind==='attempt_history')return fail(res,409,'ATTEMPT_HISTORY','Оролдлого эсвэл онооны түүхтэй сорилыг бүр мөсөн устгах боломжгүй. Түүхийг хадгалж архивлана уу.');
    if(result.kind==='competition_history')return fail(res,409,'COMPETITION_HISTORY','Уралдааны бүртгэлтэй сорилыг бүр мөсөн устгах боломжгүй.');
    res.status(204).end();
  }catch(e){next(e)}
});

adminContentRouter.get('/questions/duplicates',requireAuth,requireRoles('admin'),async(_req,res,next)=>{
  try{
    const pending=await db.select({id:s.questions.id,questionText:s.questions.questionText,status:s.questions.status,createdBy:s.questions.createdBy,createdAt:s.questions.createdAt}).from(s.questions).where(eq(s.questions.status,'pending_review')).orderBy(asc(s.questions.createdAt));
    res.json({groups:groupDuplicateQuestions(pending)});
  }catch(e){next(e)}
});

const purgeQuestionIds=z.array(z.string().uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length,'Асуултын ID давхардаж болохгүй.');
async function getQuestionPurgePreview(executor:typeof db|Parameters<Parameters<typeof db.transaction>[0]>[0],ids:string[]){
  const items=[];
  for(const id of ids){
    const item=await inspectQuestionPurge(executor,id);
    items.push(item??{id,question_text:'',status:'missing',quiz_links:[],lesson_links:[],attempt_count:0,answer_count:0,snapshot_count:0,competition_count:0,revision_count:0,audit_count:0,duplicate_reference_count:0,option_count:0,correct_option_count:0,canDelete:false,reasons:['Асуулт олдсонгүй.'],quizLinksToDetach:0,unknownForeignKeyTables:[]});
  }
  return items;
}
function publicQuestionPurgeItem(item:Awaited<ReturnType<typeof getQuestionPurgePreview>>[number]){
  return{id:item.id,questionText:item.question_text,status:item.status,canDelete:item.canDelete,reasons:item.reasons,quizLinks:item.quiz_links,lessonLinks:item.lesson_links,attemptCount:Number(item.attempt_count),answerCount:Number(item.answer_count),snapshotCount:Number(item.snapshot_count),competitionCount:Number(item.competition_count),revisionCount:Number(item.revision_count),auditCount:Number(item.audit_count),duplicateReferenceCount:Number(item.duplicate_reference_count),ownedOptionCount:Number(item.option_count),correctOptionCount:Number(item.correct_option_count),unknownForeignKeyTables:item.unknownForeignKeyTables,quizLinksToDetach:item.quizLinksToDetach};
}
adminContentRouter.post('/questions/permanent-delete/preview',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=purgeQuestionIds.safeParse(req.body?.questionIds);
    if(!parsed.success)return fail(res,400,'VALIDATION','1–100 давхардаагүй асуултын ID сонгоно уу.');
    const items=await getQuestionPurgePreview(db,parsed.data),publicItems=items.map(publicQuestionPurgeItem);
    res.json({selectedCount:items.length,eligibleCount:items.filter(item=>item.canDelete).length,blockedCount:items.filter(item=>!item.canDelete).length,quizLinksToDetach:items.filter(item=>item.canDelete).reduce((total,item)=>total+item.quizLinksToDetach,0),items:publicItems});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/permanent-delete/backup',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=purgeQuestionIds.safeParse(req.body?.questionIds);
    if(!parsed.success)return fail(res,400,'VALIDATION','1–100 давхардаагүй асуултын ID сонгоно уу.');
    const items=await getQuestionPurgePreview(db,parsed.data);
    const result=await createBackupForEligibleQuestionPurge(items,()=>createVerifiedTestDatabaseBackup(process.env.DATABASE_URL||'','question-preflight','question-purge'));
    if(result.kind==='none_eligible')return res.status(409).json({error:{code:'QUESTION_NOT_DELETABLE',message:'Сонгосон асуултуудын аль нь ч аюулгүй устгах нөхцөл хангаагүй.'},eligibleCount:0,blockedCount:items.length,items:items.map(publicQuestionPurgeItem)});
    res.json({status:'verified',verifiedQuestionIds:result.eligibleIds,eligibleCount:result.eligibleIds.length,blockedCount:items.length-result.eligibleIds.length,backup:result.backup});
  }catch(e){
    if(e instanceof Error&&['TEST_DATABASE_ONLY','BACKUP_TOOL_MISSING','BACKUP_FAILED','BACKUP_COMMAND_FAILED','BACKUP_CONTENT_CHECK_FAILED','BACKUP_TOO_SMALL'].includes(e.message))return fail(res,503,'BACKUP_FAILED','Нөөц хуулбар үүсгэж шалгаж чадсангүй. Асуултууд өөрчлөгдөөгүй; устгал идэвхжихгүй.');
    next(e);
  }
});

async function permanentlyDeleteQuestionBatch(questionIds:string[],actorUserId:string){
  const initial=await getQuestionPurgePreview(db,questionIds);
  if(!initial.some(item=>item.canDelete))return{kind:'none_eligible' as const,items:initial.map(publicQuestionPurgeItem)};
  const {backup,result}=await runAfterVerifiedBackup(
    ()=>createVerifiedTestDatabaseBackup(process.env.DATABASE_URL||'','question-batch','question-purge'),
    ()=>db.transaction(async tx=>{
    await tx.select({id:s.questions.id}).from(s.questions).where(inArray(s.questions.id,questionIds)).orderBy(asc(s.questions.id)).for('update');
    let current=await getQuestionPurgePreview(tx,questionIds);
    const quizIds=[...new Set(current.filter(item=>item.canDelete).flatMap(item=>item.quiz_links.map(quiz=>quiz.id)))];
    if(quizIds.length)await tx.select({id:s.quizzes.id}).from(s.quizzes).where(inArray(s.quizzes.id,quizIds)).orderBy(asc(s.quizzes.id)).for('update');
    current=await getQuestionPurgePreview(tx,questionIds);
    const deletable=current.filter(item=>item.canDelete);
    const skipped=current.filter(item=>!item.canDelete);
    const affectedQuizIds=[...new Set(deletable.flatMap(item=>item.quiz_links.map(quiz=>quiz.id)))];
    const deletedIds:string[]=[];
    let detachedQuizLinks=0,deletedOptions=0,deletedCorrectOptions=0;
    for(const item of deletable){
      const id=item.id;
      const links=await tx.delete(s.quizQuestions).where(eq(s.quizQuestions.questionId,id)).returning({id:s.quizQuestions.id});
      detachedQuizLinks+=links.length;
      deletedOptions+=Number(item.option_count);
      deletedCorrectOptions+=Number(item.correct_option_count);
      const[deleted]=await tx.delete(s.questions).where(and(eq(s.questions.id,id),eq(s.questions.status,'archived'))).returning({id:s.questions.id});
      if(!deleted)throw Object.assign(new Error('Асуултын төлөв өөрчлөгдсөн тул устгал цуцлагдлаа.'),{status:409});
      deletedIds.push(id);
      await tx.insert(s.auditLogs).values({actorUserId,action:'question.permanently_deleted',entityType:'question',entityId:id,metadata:{questionText:item.question_text,status:item.status,quizLinksDetached:links.length,optionsDeleted:Number(item.option_count),correctOptionsDeleted:Number(item.correct_option_count),auditHistoryRetained:Number(item.audit_count)}});
    }
    for(const quizId of affectedQuizIds){
      const publishedLinks=await tx.select({count:sql<number>`count(*)::int`}).from(s.quizQuestions).innerJoin(s.questions,eq(s.questions.id,s.quizQuestions.questionId)).where(and(eq(s.quizQuestions.quizId,quizId),eq(s.questions.status,'published')));
      await tx.update(s.quizzes).set({questionCount:publishedLinks[0]?.count??0,updatedAt:new Date()}).where(eq(s.quizzes.id,quizId));
    }
    return{deletedIds,skipped,detachedQuizLinks,deletedOptions,deletedCorrectOptions};
    }),
  );
  return{kind:'completed' as const,backup,...result,items:result.skipped.map(publicQuestionPurgeItem)};
}
adminContentRouter.post('/questions/:id/permanent-delete',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),body=z.object({confirmation:z.literal('УСТГАХ')}).safeParse(req.body);
    if(!z.string().uuid().safeParse(id).success)return fail(res,400,'VALIDATION','Асуултын ID буруу байна.');
    if(!body.success)return fail(res,400,'CONFIRMATION_REQUIRED','Устгахын тулд “УСТГАХ” гэж баталгаажуулна уу.');
    const result=await permanentlyDeleteQuestionBatch([id],req.user!.id);
    if(result.kind==='none_eligible')return res.status(409).json({error:{code:'QUESTION_NOT_DELETABLE',message:'Асуултыг аюулгүй устгах боломжгүй.'},deletedCount:0,skippedCount:result.items.length,failedCount:0,items:result.items});
    res.json({status:'completed',deletedCount:result.deletedIds.length,skippedCount:result.skipped.length,failedCount:0,deletedIds:result.deletedIds,detachedQuizLinks:result.detachedQuizLinks,deletedOptions:result.deletedOptions,deletedCorrectOptions:result.deletedCorrectOptions,backup:result.backup,items:result.items});
  }catch(e){next(e)}
});
adminContentRouter.post('/questions/permanent-delete',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=z.object({questionIds:purgeQuestionIds,confirmation:z.literal('УСТГАХ')}).safeParse(req.body);
    if(!parsed.success)return fail(res,400,'CONFIRMATION_REQUIRED','1–100 асуулт сонгож, “УСТГАХ” гэж баталгаажуулна уу.');
    const result=await permanentlyDeleteQuestionBatch(parsed.data.questionIds,req.user!.id);
    if(result.kind==='none_eligible')return res.status(409).json({error:{code:'QUESTION_NOT_DELETABLE',message:'Сонгосон асуултуудын аль нь ч аюулгүй устгах нөхцөл хангаагүй.'},deletedCount:0,skippedCount:result.items.length,failedCount:0,items:result.items});
    res.json({status:'completed',deletedCount:result.deletedIds.length,skippedCount:result.skipped.length,failedCount:0,deletedIds:result.deletedIds,detachedQuizLinks:result.detachedQuizLinks,deletedOptions:result.deletedOptions,deletedCorrectOptions:result.deletedCorrectOptions,backup:result.backup,items:result.items});
  }catch(e){next(e)}
});

adminContentRouter.get('/questions/:id',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),[question]=await db.select().from(s.questions).where(eq(s.questions.id,id)).limit(1);
    if(!question)return fail(res,404,'NOT_FOUND','Асуулт олдсонгүй.');
    const options=await db.select().from(s.questionOptions).where(eq(s.questionOptions.questionId,id)).orderBy(asc(s.questionOptions.optionOrder));
    const correct=await db.select({optionId:s.questionCorrectOptions.optionId}).from(s.questionCorrectOptions).where(eq(s.questionCorrectOptions.questionId,id));
    const revisions=await db.select().from(s.questionRevisions).where(eq(s.questionRevisions.questionId,id)).orderBy(desc(s.questionRevisions.revisionNumber));
    res.json({question,options,correctOptionIds:correct.map(item=>item.optionId),revisions});
  }catch(e){next(e)}
});

adminContentRouter.put('/questions/:id',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const parsed=questionEditInput.safeParse(req.body);
    if(!parsed.success)return fail(res,400,'VALIDATION','Асуултын текст, ангилал, сонголт, тайлбар болон эх сурвалжийг шалгана уу.');
    const input=parsed.data;
    const validation=validateQuestionDraft(input);
    if(validation)return fail(res,400,'VALIDATION',validation);
    if(!hasUniqueIds(input.correctIndexes.map(String))||input.correctIndexes.some(index=>index>=input.options.length))return fail(res,400,'VALIDATION','Зөв сонголтын дугаар буруу эсвэл давхардсан байна.');
    if(input.questionType==='single_choice'&&input.correctIndexes.length!==1)return fail(res,400,'VALIDATION','Нэг сонголтот асуулт яг нэг зөв хариулттай байна.');
    const result=await db.transaction(async tx=>{
      const id=String(req.params.id),[question]=await tx.select().from(s.questions).where(eq(s.questions.id,id)).for('update').limit(1);
      if(!question)return{kind:'not_found'} as const;
      if(question.status==='archived')return{kind:'archived'} as const;
      const uses=await tx.select({attemptId:s.quizAttempts.id}).from(s.quizQuestions).innerJoin(s.quizAttempts,eq(s.quizAttempts.quizId,s.quizQuestions.quizId)).where(eq(s.quizQuestions.questionId,id)).limit(1);
      if(uses.length)return{kind:'history_locked'} as const;
      const competition=await tx.select({id:s.competitions.id}).from(s.quizQuestions).innerJoin(s.competitions,eq(s.competitions.quizId,s.quizQuestions.quizId)).where(and(eq(s.quizQuestions.questionId,id),inArray(s.competitions.status,['scheduled','active']))).limit(1);
      if(competition.length)return{kind:'history_locked'} as const;
      const oldOptions=await tx.select().from(s.questionOptions).where(eq(s.questionOptions.questionId,id)).orderBy(asc(s.questionOptions.optionOrder));
      const oldCorrect=await tx.select({optionId:s.questionCorrectOptions.optionId}).from(s.questionCorrectOptions).where(eq(s.questionCorrectOptions.questionId,id));
      const latest=await tx.select({revisionNumber:s.questionRevisions.revisionNumber}).from(s.questionRevisions).where(eq(s.questionRevisions.questionId,id)).orderBy(desc(s.questionRevisions.revisionNumber)).limit(1);
      await tx.insert(s.questionRevisions).values({questionId:id,revisionNumber:(latest[0]?.revisionNumber??0)+1,previousData:{question,options:oldOptions,correctOptionIds:oldCorrect.map(item=>item.optionId)},changedBy:req.user!.id,changeReason:'Админы удирдлагын хэсгээс засварлав.'});
      const now=new Date();
      await tx.update(s.questions).set({categoryId:input.categoryId,questionText:input.questionText,questionType:input.questionType,difficulty:input.difficulty,explanation:input.explanation,sourceDocument:input.sourceDocument,sourceRevision:input.sourceRevision,sourceSection:input.sourceSection??null,sourceLocation:input.sourceLocation,status:question.status==='published'?'published':'draft',reviewedBy:null,approvedAt:null,lastReviewedAt:now,updatedAt:now}).where(eq(s.questions.id,id));
      await tx.delete(s.questionCorrectOptions).where(eq(s.questionCorrectOptions.questionId,id));
      await tx.delete(s.questionOptions).where(eq(s.questionOptions.questionId,id));
      const options=await tx.insert(s.questionOptions).values(input.options.map((option,optionOrder)=>({questionId:id,optionText:option.text,optionOrder}))).returning({id:s.questionOptions.id});
      await tx.insert(s.questionCorrectOptions).values(input.correctIndexes.map(index=>({questionId:id,optionId:options[index].id})));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.updated',entityType:'question',entityId:id,metadata:{previousStatus:question.status,newStatus:question.status==='published'?'published':'draft'}});
      return{kind:'updated',status:question.status==='published'?'published':'draft'} as const;
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Асуулт олдсонгүй.');
    if(result.kind==='archived')return fail(res,409,'ARCHIVED','Архивласан асуултыг эхлээд сэргээнэ үү.');
    if(result.kind==='history_locked')return fail(res,409,'ATTEMPT_HISTORY','Оролдлогын түүхтэй асуултыг засварлах боломжгүй.');
    res.json({status:result.status,message:'Хадгаллаа.'});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/:id/reject',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const p=z.object({reason:z.string().trim().max(1000).default('')}).safeParse(req.body??{});
    if(!p.success)return fail(res,400,'VALIDATION','Буцаах тайлбар хэт урт байна.');
    const id=String(req.params.id),now=new Date();
    const[result]=await db.transaction(async tx=>{
      const[q]=await tx.select().from(s.questions).where(eq(s.questions.id,id)).for('update').limit(1);
      if(!q)return[{kind:'not_found'} as const];
      if(q.status!=='pending_review')return[{kind:'workflow'} as const];
      await tx.update(s.questions).set({status:'rejected',reviewedBy:req.user!.id,lastReviewedAt:now,updatedAt:now}).where(eq(s.questions.id,id));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.rejected',entityType:'question',entityId:id,metadata:{reason:p.data.reason}});
      return[{kind:'rejected'} as const];
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Асуулт олдсонгүй.');
    if(result.kind==='workflow')return fail(res,409,'WORKFLOW','Зөвхөн хяналтад байгаа асуултыг буцааж болно.');
    res.json({status:'rejected'});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/:id/return',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),now=new Date();
    const[result]=await db.transaction(async tx=>{
      const[q]=await tx.select().from(s.questions).where(eq(s.questions.id,id)).for('update').limit(1);
      if(!q)return[{kind:'not_found'} as const];
      if(q.status!=='pending_review')return[{kind:'workflow'} as const];
      await tx.update(s.questions).set({status:'draft',reviewedBy:req.user!.id,lastReviewedAt:now,updatedAt:now}).where(eq(s.questions.id,id));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.returned_to_draft',entityType:'question',entityId:id});
      return[{kind:'returned'} as const];
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Асуулт олдсонгүй.');
    if(result.kind==='workflow')return fail(res,409,'WORKFLOW','Зөвхөн хяналтад байгаа асуултыг буцаана.');
    res.json({status:'draft'});
  }catch(e){next(e)}
});

adminContentRouter.delete('/questions/:id',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),now=new Date();
    const[result]=await db.transaction(async tx=>{
      const[q]=await tx.select().from(s.questions).where(eq(s.questions.id,id)).for('update').limit(1);
      if(!q)return[{kind:'not_found'} as const];
      if(q.status==='archived')return[{kind:'archived'} as const];
      const active=await tx.select({id:s.quizAttempts.id}).from(s.quizQuestions).innerJoin(s.quizAttempts,eq(s.quizAttempts.quizId,s.quizQuestions.quizId)).where(and(eq(s.quizQuestions.questionId,id),eq(s.quizAttempts.status,'in_progress'))).limit(1);
      if(active.length)return[{kind:'in_progress'} as const];
      const competition=await tx.select({id:s.competitions.id}).from(s.quizQuestions).innerJoin(s.competitions,eq(s.competitions.quizId,s.quizQuestions.quizId)).where(and(eq(s.quizQuestions.questionId,id),inArray(s.competitions.status,['scheduled','active']))).limit(1);
      if(competition.length)return[{kind:'competition_active'} as const];
      await tx.update(s.questions).set({status:'archived',archivedAt:now,duplicateOf:null,updatedAt:now}).where(eq(s.questions.id,id));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.archived',entityType:'question',entityId:id,metadata:{previousStatus:q.status}});
      return[{kind:'archived'} as const];
    });
    if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Асуулт олдсонгүй.');
    if(result.kind==='archived')return fail(res,409,'ARCHIVED','Асуулт өмнө нь архивлагдсан байна.');
    if(result.kind==='in_progress')return fail(res,409,'ACTIVE_ATTEMPTS','Идэвхтэй сорилд байгаа асуултыг архивлах боломжгүй.');
    if(result.kind==='competition_active')return fail(res,409,'ACTIVE_COMPETITION','Төлөвлөсөн эсвэл явагдаж буй уралдаанд холбогдсон асуултыг архивлах боломжгүй.');
    res.status(200).json({status:'archived',message:'Асуултыг өгөгдлийг хадгалан архивлалаа.'});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/:id/restore',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const id=String(req.params.id),now=new Date();
    const[q]=await db.update(s.questions).set({status:'draft',archivedAt:null,duplicateOf:null,reviewedBy:null,approvedAt:null,lastReviewedAt:now,updatedAt:now}).where(and(eq(s.questions.id,id),eq(s.questions.status,'archived'))).returning({id:s.questions.id});
    if(!q)return fail(res,404,'NOT_FOUND','Архивласан асуулт олдсонгүй.');
    await db.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.restored',entityType:'question',entityId:id});
    res.json({status:'draft',message:'Асуултыг ноорог төлөвт сэргээлээ.'});
  }catch(e){next(e)}
});

adminContentRouter.post('/questions/:id/duplicate',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  try{
    const p=z.object({duplicateOf:z.string().uuid()}).safeParse(req.body);
    if(!p.success)return fail(res,400,'VALIDATION','Хадгалж үлдэх асуултын ID-г сонгоно уу.');
    const id=String(req.params.id),targetId=p.data.duplicateOf;
    if(id===targetId)return fail(res,400,'VALIDATION','Асуултыг өөртэй нь давхардсан гэж тэмдэглэх боломжгүй.');
    const result=await db.transaction(async tx=>{
      const rows=await tx.select().from(s.questions).where(inArray(s.questions.id,[id,targetId])).orderBy(asc(s.questions.id)).for('update');
      const duplicate=rows.find(row=>row.id===id),target=rows.find(row=>row.id===targetId);
      if(!duplicate||!target)return'not_found' as const;
      if(duplicate.status!=='pending_review'||target.status!=='pending_review')return'workflow' as const;
      if(normalizeQuestionText(duplicate.questionText)!==normalizeQuestionText(target.questionText))return'not_duplicate' as const;
      const now=new Date();
      await tx.update(s.questions).set({status:'archived',archivedAt:now,duplicateOf:targetId,reviewedBy:req.user!.id,lastReviewedAt:now,updatedAt:now}).where(and(eq(s.questions.id,id),eq(s.questions.status,'pending_review')));
      await tx.insert(s.auditLogs).values({actorUserId:req.user!.id,action:'question.duplicate_marked',entityType:'question',entityId:id,metadata:{duplicateOf:targetId}});
      return'marked' as const;
    });
    if(result==='not_found')return fail(res,404,'NOT_FOUND','Сонгосон асуултуудын нэг олдсонгүй.');
    if(result==='workflow')return fail(res,409,'WORKFLOW','Зөвхөн хяналтад байгаа асуултуудыг давхардалд хамруулна.');
    if(result==='not_duplicate')return fail(res,409,'NOT_DUPLICATE','Сонгосон асуултын текст нормчилсны дараа таарахгүй байна.');
    res.json({status:'archived',duplicateOf:targetId});
  }catch(e){next(e)}
});
