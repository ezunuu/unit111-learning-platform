import {and,asc,desc,eq,inArray,isNull,sql} from 'drizzle-orm';
import * as s from './schema.js';
import {isTrainingQuiz,learnerVisibleQuizStatus} from './quiz-lifecycle.js';
import {attemptAllowance} from './attempt-retry-policy.js';

export function groupQuizQuestionRows<TQuestion extends {id:string},TOption>(rows:{question:TQuestion;option:TOption}[],expectedCount:number){
  if(expectedCount<1)return null;
  const grouped=new Map<string,{question:TQuestion;options:TOption[]}>();
  for(const row of rows){
    const group=grouped.get(row.question.id)||{question:row.question,options:[]};
    group.options.push(row.option);
    grouped.set(row.question.id,group);
  }
  if(grouped.size!==expectedCount||[...grouped.values()].some(group=>group.options.length===0||group.options.some(option=>option==null)))return null;
  return [...grouped.values()];
}

export async function startQuizForUser(quizId:string,userId:string,competitionId?:string){
  const {db}=await import('./db.js');
  try{return await db.transaction(async tx=>{
    const [quiz]=await tx.select().from(s.quizzes).where(and(eq(s.quizzes.id,quizId),eq(s.quizzes.status,learnerVisibleQuizStatus))).for('update').limit(1);
    if(!quiz||isTrainingQuiz(quiz.quizType,quiz.lessonId))return{kind:'not_found'} as const;
    if(quiz.chapterId){
      const [chapter]=await tx.select({id:s.chapters.id,courseId:s.chapters.courseId,status:s.chapters.status,chapterOrder:s.chapters.chapterOrder,requiredLessonsCompleted:s.chapters.requiredLessonsCompleted,courseStatus:s.courses.status,freeLearningMode:s.courses.freeLearningMode})
        .from(s.chapters).innerJoin(s.courses,eq(s.courses.id,s.chapters.courseId)).where(eq(s.chapters.id,quiz.chapterId)).limit(1);
      if(!chapter||chapter.status!=='published'||chapter.courseStatus!=='published')return{kind:'not_found'} as const;
      const chapterLessons=await tx.select({id:s.lessons.id}).from(s.lessons).where(and(eq(s.lessons.chapterId,chapter.id),eq(s.lessons.status,'published')));
      const priorChapters=await tx.select({id:s.chapters.id,chapterOrder:s.chapters.chapterOrder,requiredLessonsCompleted:s.chapters.requiredLessonsCompleted}).from(s.chapters).where(and(eq(s.chapters.courseId,chapter.courseId),sql`${s.chapters.chapterOrder} < ${chapter.chapterOrder}`,eq(s.chapters.status,'published'))).orderBy(asc(s.chapters.chapterOrder));
      const requiredChapterIds=[...priorChapters.map((item)=>item.id),chapter.id];
      const requiredLessons=await tx.select({id:s.lessons.id,chapterId:s.lessons.chapterId}).from(s.lessons).where(and(inArray(s.lessons.chapterId,requiredChapterIds),eq(s.lessons.status,'published')));
      const completed=await tx.select({lessonId:s.lessonProgress.lessonId}).from(s.lessonProgress).where(and(eq(s.lessonProgress.userId,userId),inArray(s.lessonProgress.lessonId,requiredLessons.map((item)=>item.id))));
      const completeSet=new Set(completed.map((item)=>item.lessonId));
      if(chapter.requiredLessonsCompleted&&chapterLessons.some((item)=>!completeSet.has(item.id)))return{kind:'chapter_locked'} as const;
      for(const prior of priorChapters){
        if(prior.requiredLessonsCompleted&&requiredLessons.filter((lesson)=>lesson.chapterId===prior.id).some((lesson)=>!completeSet.has(lesson.id)))return{kind:'chapter_locked'} as const;
        const [priorQuiz]=await tx.select({id:s.quizzes.id,passingPercentage:s.courses.chapterQuizPassPercentage,status:s.quizzes.status}).from(s.quizzes).innerJoin(s.chapters,eq(s.chapters.id,s.quizzes.chapterId)).innerJoin(s.courses,eq(s.courses.id,s.chapters.courseId)).where(and(eq(s.quizzes.chapterId,prior.id),eq(s.quizzes.status,'published'))).limit(1);
        if(priorQuiz){const [passed]=await tx.select({id:s.quizAttempts.id}).from(s.quizAttempts).where(and(eq(s.quizAttempts.quizId,priorQuiz.id),eq(s.quizAttempts.userId,userId),eq(s.quizAttempts.status,'submitted'),sql`${s.quizAttempts.accuracy} >= ${priorQuiz.passingPercentage}`)).limit(1);if(!passed)return{kind:'chapter_locked'} as const;}
      }
    }
    if(competitionId){
      const [competition]=await tx.select().from(s.competitions).where(and(eq(s.competitions.id,competitionId),eq(s.competitions.quizId,quiz.id))).limit(1);
      const now=new Date();
      if(!competition||now<competition.startsAt||now>competition.endsAt||!['scheduled','active'].includes(competition.status))return{kind:'competition_closed'} as const;
      const [participant]=await tx.select().from(s.competitionParticipants).where(and(eq(s.competitionParticipants.competitionId,competitionId),eq(s.competitionParticipants.userId,userId))).limit(1);
      if(!participant)return{kind:'not_registered'} as const;
      const restricted=await tx.select().from(s.competitionTeams).where(eq(s.competitionTeams.competitionId,competitionId));
      if(restricted.length){
        const memberships=await tx.select().from(s.teamMembers).where(and(eq(s.teamMembers.userId,userId),isNull(s.teamMembers.leftAt)));
        if(!memberships.some(member=>restricted.some(team=>team.teamId===member.teamId)))return{kind:'not_eligible'} as const;
      }
    }
    const prior=await tx.select({id:s.quizAttempts.id,status:s.quizAttempts.status,attemptNumber:s.quizAttempts.attemptNumber,startedAt:s.quizAttempts.startedAt}).from(s.quizAttempts).where(and(eq(s.quizAttempts.quizId,quiz.id),eq(s.quizAttempts.userId,userId),competitionId?eq(s.quizAttempts.competitionId,competitionId):isNull(s.quizAttempts.competitionId))).orderBy(desc(s.quizAttempts.startedAt));
    const active=prior.find(attempt=>attempt.status==='in_progress');
    const allowance=attemptAllowance(prior,quiz.attemptsAllowed,quiz.isTest);
    if(!active&&allowance.exhausted)return{kind:'attempts_exhausted',used:allowance.used,limit:quiz.attemptsAllowed,remaining:allowance.remaining} as const;
    let attempt=active;
    if(!attempt){
      const currentQuestions=await tx.select({questionId:s.quizQuestions.questionId,questionOrder:s.quizQuestions.questionOrder,points:s.quizQuestions.points})
        .from(s.quizQuestions).innerJoin(s.questions,eq(s.questions.id,s.quizQuestions.questionId))
        .where(and(eq(s.quizQuestions.quizId,quiz.id),eq(s.questions.status,'published')))
        .orderBy(asc(s.quizQuestions.questionOrder));
      if(currentQuestions.length!==quiz.questionCount)return{kind:'questions_changed'} as const;
      const[createdAttempt]=await tx.insert(s.quizAttempts).values({quizId:quiz.id,userId,competitionId,attemptNumber:allowance.nextAttemptNumber}).returning();
      if(!createdAttempt)throw new Error('QUIZ_ATTEMPT_CREATE_FAILED');
      attempt=createdAttempt;
      await tx.insert(s.quizAttemptQuestions).values(currentQuestions.map(question=>({attemptId:createdAttempt.id,...question})));
    }
    const rows=await tx.select({question:s.questions,option:s.questionOptions})
      .from(s.quizAttemptQuestions)
      .innerJoin(s.questions,eq(s.questions.id,s.quizAttemptQuestions.questionId))
      .innerJoin(s.questionOptions,eq(s.questionOptions.questionId,s.questions.id))
      .where(eq(s.quizAttemptQuestions.attemptId,attempt.id))
      .orderBy(asc(s.quizAttemptQuestions.questionOrder),asc(s.questionOptions.optionOrder))
      .for('share');
    const expectedCount=new Set(rows.map(row=>row.question.id)).size;
    if(expectedCount===0)return{kind:'questions_changed'} as const;
    const grouped=groupQuizQuestionRows(rows,expectedCount);
    if(!grouped)throw new Error('QUIZ_QUESTION_SET_CHANGED');
    return{kind:active?'resumed' as const:'started' as const,attempt,quiz,questions:grouped.map(group=>({id:group.question.id,text:group.question.questionText,type:group.question.questionType,options:group.options.map(option=>({id:option.id,text:option.optionText}))}))};
  });}catch(error){if(error instanceof Error&&error.message==='QUIZ_QUESTION_SET_CHANGED')return{kind:'questions_changed'} as const;throw error;}
}
