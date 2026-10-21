export type QuizPurgeCandidate={title:string;status:string;isTest:boolean};

export function canMarkQuizAsTest(candidate:QuizPurgeCandidate,competitionCount:number){
  return candidate.status==='archived'&&!candidate.isTest&&competitionCount===0;
}

export function canPermanentlyPurgeTestQuiz(input:{candidate:QuizPurgeCandidate;confirmedTestOnly:boolean;confirmationTitle:string;competitionCount:number;unknownForeignKeyTables:string[]}){
  return input.candidate.status==='archived'&&input.candidate.isTest&&input.confirmedTestOnly&&input.confirmationTitle===input.candidate.title&&input.competitionCount===0&&input.unknownForeignKeyTables.length===0;
}
