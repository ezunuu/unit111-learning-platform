import {createHash,randomBytes} from 'node:crypto';
import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import {hash} from '@node-rs/argon2';
import {and,eq,gt,isNull,sql,desc} from 'drizzle-orm';
import {db} from './db.js';
import * as s from './schema.js';

const emailSchema=z.string().trim().email().max(255).transform(value=>value.toLowerCase());
export const registerInput=z.object({fullName:z.string().trim().min(2).max(200),email:emailSchema,password:z.string().min(12).max(200)}).strict();
export const resetInput=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),newPassword:z.string().min(12).max(200)}).strict();
export const resetTokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
const fail=(res:import('express').Response,status:number,code:string,message:string)=>res.status(status).json({error:{code,message}});
const limiter=(limit:number)=>rateLimit({windowMs:60*60*1000,limit,standardHeaders:true,legacyHeaders:false,message:{error:{code:'RATE_LIMIT',message:'Олон удаа хүсэлт илгээсэн байна. Түр хүлээгээд дахин оролдоно уу.'}}});
type Mail={to:string;resetUrl:string};
const origin=()=>process.env.PASSWORD_RESET_ORIGIN||process.env.APP_ORIGIN?.split(',')[0]||'http://localhost:5173';
export const resetMailReady=()=>!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM);
async function sendResetMail({to,resetUrl}:Mail){
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[to],subject:'Сургалтын платформ — Нууц үг сэргээх',text:`Нууц үгээ шинэчлэх холбоос (30 минут хүчинтэй, нэг удаа ашиглана):\n\n${resetUrl}\n\nТа хүсэлт гаргаагүй бол энэ и-мэйлийг үл хэрэгсэнэ үү.`}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('RESET_MAIL_DELIVERY_FAILED');
}
export function createSelfServiceAuthRouter(options:{sendMail?:(mail:Mail)=>Promise<void>;mailReady?:()=>boolean;resetOrigin?:()=>string}={}){
 const router=Router(),sendMail=options.sendMail??sendResetMail,mailReady=options.mailReady??resetMailReady;
 router.post('/auth/register',limiter(5),async(req,res,next)=>{try{
  const p=registerInput.safeParse(req.body);if(!p.success)return fail(res,400,'VALIDATION','Нэр, зөв и-мэйл, 12-оос доошгүй тэмдэгттэй нууц үг оруулна уу.');
  const passwordHash=await hash(p.data.password);
  const user=await db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${p.data.email}))`);
   const existing=await tx.select({id:s.users.id}).from(s.users).where(sql`lower(trim(${s.users.email}))=${p.data.email} or lower(${s.users.username})=${p.data.email}`).limit(1);if(existing.length)return null;
   const [user]=await tx.insert(s.users).values({username:'member_'+randomBytes(10).toString('hex'),email:p.data.email,fullName:p.data.fullName,passwordHash,role:'employee',isActive:true,mustChangePassword:false}).returning({id:s.users.id});
   await tx.insert(s.auditLogs).values({actorUserId:user.id,action:'user.self_registered',entityType:'user',entityId:user.id});return user;
  });
  if(!user)return fail(res,409,'EMAIL_EXISTS','Энэ и-мэйлээр бүртгэл үүссэн байна. Нэвтрэх эсвэл нууц үгээ сэргээнэ үү.');
  res.status(201).json({ok:true});
 }catch(e){if((e as any)?.code==='23505'||(e as any)?.cause?.code==='23505')return fail(res,409,'EMAIL_EXISTS','Энэ и-мэйлээр бүртгэл үүссэн байна.');next(e)}});
 router.post('/auth/forgot-password',limiter(8),async(req,res,next)=>{try{
  const p=z.object({email:emailSchema}).strict().safeParse(req.body);if(!p.success)return fail(res,400,'VALIDATION','Зөв и-мэйл хаяг оруулна уу.');
  if(!mailReady())return fail(res,503,'RESET_UNAVAILABLE','Одоогоор сэргээх и-мэйл илгээх боломжгүй. Администраторт хандана уу.');
  const resetOrigin=new URL((options.resetOrigin??origin)());if(!['http:','https:'].includes(resetOrigin.protocol)||(process.env.NODE_ENV==='production'&&resetOrigin.protocol!=='https:'))throw Error('INVALID_RESET_ORIGIN');
  const [user]=await db.select({id:s.users.id}).from(s.users).where(and(sql`lower(trim(${s.users.email}))=${p.data.email}`,eq(s.users.isActive,true))).limit(1);
  if(user)await db.transaction(async tx=>{
   await tx.execute(sql`select id from users where id=${user.id} for update`);
   const [latest]=await tx.select().from(s.passwordResetTokens).where(eq(s.passwordResetTokens.userId,user.id)).orderBy(desc(s.passwordResetTokens.createdAt)).limit(1);
   if(latest&&Date.now()-latest.createdAt.getTime()<60000)return;
   const token=randomBytes(32).toString('hex'),now=new Date();
   await tx.update(s.passwordResetTokens).set({usedAt:now}).where(and(eq(s.passwordResetTokens.userId,user.id),isNull(s.passwordResetTokens.usedAt)));
   await tx.insert(s.passwordResetTokens).values({userId:user.id,tokenHash:resetTokenHash(token),expiresAt:new Date(Date.now()+30*60*1000)});
   const url=new URL('/reset-password',resetOrigin);url.hash='token='+token;
   await sendMail({to:p.data.email,resetUrl:url.toString()});
  });
  res.json({ok:true,message:'Энэ и-мэйлээр бүртгэл байгаа бол нууц үг сэргээх холбоос илгээлээ. И-мэйл болон Spam хавтсаа шалгана уу.'});
 }catch(e){if((e as Error).message==='RESET_MAIL_DELIVERY_FAILED'||(e as Error).name==='TimeoutError')return fail(res,503,'RESET_UNAVAILABLE','Сэргээх и-мэйл илгээж чадсангүй. Түр хүлээгээд дахин оролдоно уу.');next(e)}});
 router.post('/auth/reset-password',limiter(12),async(req,res,next)=>{try{
  const p=resetInput.safeParse(req.body);if(!p.success)return fail(res,400,'VALIDATION','Холбоос болон 12-оос доошгүй тэмдэгттэй шинэ нууц үгээ шалгана уу.');
  const passwordHash=await hash(p.data.newPassword);
  const ok=await db.transaction(async tx=>{
   const [token]=await tx.select().from(s.passwordResetTokens).where(and(eq(s.passwordResetTokens.tokenHash,resetTokenHash(p.data.token)),isNull(s.passwordResetTokens.usedAt),gt(s.passwordResetTokens.expiresAt,new Date()))).limit(1);if(!token)return false;
   const [user]=await tx.select({id:s.users.id,isActive:s.users.isActive}).from(s.users).where(eq(s.users.id,token.userId)).for('update').limit(1);if(!user?.isActive)return false;
   const [valid]=await tx.select({id:s.passwordResetTokens.id}).from(s.passwordResetTokens).where(and(eq(s.passwordResetTokens.id,token.id),isNull(s.passwordResetTokens.usedAt),gt(s.passwordResetTokens.expiresAt,new Date()))).for('update').limit(1);if(!valid)return false;
   await tx.update(s.users).set({passwordHash,mustChangePassword:false,authVersion:sql`${s.users.authVersion}+1`,updatedAt:new Date()}).where(eq(s.users.id,user.id));
   await tx.update(s.passwordResetTokens).set({usedAt:new Date()}).where(and(eq(s.passwordResetTokens.userId,user.id),isNull(s.passwordResetTokens.usedAt)));
   await tx.insert(s.auditLogs).values({actorUserId:user.id,action:'password.reset',entityType:'user',entityId:user.id});return true;
  });
  if(!ok)return fail(res,400,'INVALID_RESET_TOKEN','Холбоосын хугацаа дууссан эсвэл ашиглагдсан байна. Шинэ холбоос авна уу.');
  res.json({ok:true});
 }catch(e){next(e)}});
 return router;
}
export const selfServiceAuthRouter=createSelfServiceAuthRouter();
