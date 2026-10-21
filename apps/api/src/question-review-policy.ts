import {validateQuestionDraft} from './question-validation.js';

export type ReviewCandidate={
  status:string;
  questionText:string;
  questionType:'single_choice'|'multiple_choice'|'true_false';
  explanation:string;
  sourceDocument:string|null;
  sourceRevision:string|null;
  sourceSection?:string|null;
  sourceLocation:string|null;
  options:{text:string}[];
  correctIndexes:number[];
};

export function questionReviewReasons(question:ReviewCandidate):string[]{
  const reasons:string[]=[];
  if(question.status!=='pending_review')reasons.push('Зөвхөн хяналтад байгаа асуултыг батална.');
  if(question.options.length!==4)reasons.push(`Мэргэжлийн хяналтад яг 4 сонголт шаардлагатай (одоогоор ${question.options.length}).`);
  const invalid=validateQuestionDraft({questionText:question.questionText,questionType:question.questionType,options:question.options,correctIndexes:question.correctIndexes});
  if(invalid)reasons.push(invalid);
  return [...new Set(reasons)];
}
