export function canVoidAttempt(status:string){return status==='in_progress';}

export function isAttemptTimeExpired(startedAt:Date,timeLimitSeconds:number|null,now=new Date()){
  return timeLimitSeconds!==null&&now.getTime()>=startedAt.getTime()+timeLimitSeconds*1000;
}
