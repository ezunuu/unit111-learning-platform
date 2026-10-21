export const learnerVisibleQuizStatus='published' as const;
export function isTrainingQuiz(quizType:string,lessonId:string|null){return quizType==='training'||lessonId!==null;}
export function isVisibleTrainingLesson(lessonStatus:string,quizStatus:string,questionCount:number,publishedQuestionCount:number){return lessonStatus==='published'&&quizStatus==='published'&&questionCount>=1&&questionCount<=100&&publishedQuestionCount===questionCount;}

export function canPermanentlyDeleteQuiz(status:string,attemptCount:number,competitionCount:number){
  return status==='archived'&&attemptCount===0&&competitionCount===0;
}
