export type AttemptUsageRow={status:string;attemptNumber:number};

export function usedAttemptCount(attempts:AttemptUsageRow[]){
  return attempts.filter(attempt=>attempt.status!=='voided').length;
}

export function isUnlimitedTestQuiz(isTest:boolean,attemptsAllowed:number){
  return isTest&&attemptsAllowed===0;
}

export function attemptAllowance(attempts:AttemptUsageRow[],attemptsAllowed:number,isTest:boolean){
  const used=usedAttemptCount(attempts),unlimited=isUnlimitedTestQuiz(isTest,attemptsAllowed);
  const remaining=unlimited?null:Math.max(0,attemptsAllowed-used);
  const nextAttemptNumber=Math.max(0,...attempts.map(attempt=>attempt.attemptNumber))+1;
  return{used,remaining,unlimited,exhausted:!unlimited&&used>=attemptsAllowed,nextAttemptNumber};
}

export function canConfigureUnlimitedAttempts(isTest:boolean,attemptsAllowed:number){
  return attemptsAllowed===0?isTest:attemptsAllowed>=1&&attemptsAllowed<=20;
}
