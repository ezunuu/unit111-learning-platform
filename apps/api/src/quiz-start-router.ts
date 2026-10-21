import {Router} from 'express';
import {requireAuth} from './auth.js';
import {startQuizForUser} from './start-quiz.js';
import {mayReturnImmediateFeedback} from './quiz-practice-feedback.js';

type StartQuiz=typeof startQuizForUser;
const fail=(res:import('express').Response,status:number,code:string,message:string)=>res.status(status).json({error:{code,message}});

export function createQuizStartRouter(startQuiz:StartQuiz=startQuizForUser){
  const router=Router();
  router.post('/quizzes/:id/start',requireAuth,async(req,res,next)=>{
    try{
      const competitionId=typeof req.query.competitionId==='string'?req.query.competitionId:undefined;
      const result=await startQuiz(String(req.params.id),req.user!.id,competitionId);
      if(result.kind==='not_found')return fail(res,404,'NOT_FOUND','Шалгалт олдсонгүй эсвэл нийтлэгдээгүй байна.');
      if(result.kind==='chapter_locked')return fail(res,403,'CHAPTER_LOCKED','Өмнөх бүлгийн шаардлагатай хичээл, эцсийн сорилыг амжилттай дуусгасны дараа нээгдэнэ.');
      if(result.kind==='competition_closed')return fail(res,409,'COMPETITION_CLOSED','Уралдаан эхлээгүй эсвэл дууссан байна.');
      if(result.kind==='not_registered')return fail(res,403,'NOT_REGISTERED','Уралдаанд эхлээд бүртгүүлнэ үү.');
      if(result.kind==='not_eligible')return fail(res,403,'NOT_ELIGIBLE','Энэ баг оролцох эрхгүй.');
      if(result.kind==='attempts_exhausted')return res.status(409).json({error:{code:'ATTEMPTS_EXHAUSTED',message:`Оролдох дээд хязгаарт хүрсэн (${result.used}/${result.limit}). Үлдсэн оролдлого: ${result.remaining}.`,usedAttempts:result.used,attemptsAllowed:result.limit,remainingAttempts:result.remaining}});
      if(result.kind==='questions_changed')return fail(res,409,'QUESTIONS_CHANGED','Сорилын асуултууд өөрчлөгдсөн байна. Админд хандана уу.');
      res.status(result.kind==='resumed'?200:201).json({attempt:{id:result.attempt.id,startedAt:result.attempt.startedAt,resumed:result.kind==='resumed'},quiz:{id:result.quiz.id,title:result.quiz.title,timeLimitSeconds:result.quiz.timeLimitSeconds,immediateFeedback:mayReturnImmediateFeedback(result.quiz)},questions:result.questions});
    }catch(error){next(error)}
  });
  return router;
}
