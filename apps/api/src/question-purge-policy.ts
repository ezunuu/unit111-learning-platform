export type QuestionPurgeDependencies={
  quizLinkCount:number;
  lessonLinkCount:number;
  attemptCount:number;
  answerCount:number;
  snapshotCount:number;
  competitionCount:number;
  revisionCount:number;
  duplicateReferenceCount:number;
  unknownForeignKeyTables:string[];
};

export function assessQuestionPurge(status:string,dependencies:QuestionPurgeDependencies){
  const reasons:string[]=[];
  if(status!=='archived')reasons.push('Зөвхөн архивласан асуултыг бүр мөсөн устгана.');
  if(dependencies.attemptCount)reasons.push('Холбогдсон сорил оролдлогын түүхтэй.');
  if(dependencies.answerCount)reasons.push('Хэрэглэгчийн хадгалсан хариулт байна.');
  if(dependencies.snapshotCount)reasons.push('Оролдлогын асуултын snapshot байна.');
  if(dependencies.competitionCount)reasons.push('Тэмцээний түүх эсвэл холбоос байна.');
  if(dependencies.lessonLinkCount)reasons.push('Хичээлтэй холбоос байна; эхлээд хичээлээс салгана уу.');
  if(dependencies.revisionCount)reasons.push('Засварын түүхийг хадгалах шаардлагатай тул устгахгүй.');
  if(dependencies.duplicateReferenceCount)reasons.push('Өөр асуулт энэ асуултыг давхардлын эх сурвалж болгосон байна.');
  if(dependencies.unknownForeignKeyTables.length)reasons.push(`Танигдаагүй foreign key хамаарал байна: ${dependencies.unknownForeignKeyTables.join(', ')}.`);
  return{canDelete:reasons.length===0,reasons,quizLinksToDetach:reasons.length===0?dependencies.quizLinkCount:0};
}
