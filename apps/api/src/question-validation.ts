import {normalizeQuestionText} from './question-duplicates.js';

export type QuestionDraft={questionText:string;questionType:'single_choice'|'multiple_choice'|'true_false';options:{text:string}[];correctIndexes:number[]};

export function validateQuestionDraft(input:QuestionDraft):string|null{
  if(!input.questionText.trim())return 'Асуултын текст хоосон байж болохгүй.';
  if(input.options.length<2||input.options.length>8)return '2–8 хариултын сонголт оруулна уу.';
  const options=input.options.map(option=>normalizeQuestionText(option.text).replace(/[\p{P}\p{S}]/gu,'').trim());
  if(options.some((value,index)=>!value||options.indexOf(value)!==index))return 'Сонголтууд хоосон эсвэл давхардсан байна.';
  if(!input.correctIndexes.length||new Set(input.correctIndexes).size!==input.correctIndexes.length||input.correctIndexes.some(index=>!Number.isInteger(index)||index<0||index>=input.options.length))return 'Зөв хариултын сонголтыг шалгана уу.';
  if(input.questionType==='single_choice'&&input.correctIndexes.length!==1)return 'Нэг зөв хариулттай асуултад яг нэг сонголт тэмдэглэнэ үү.';
  if(input.questionType==='multiple_choice'&&input.correctIndexes.length<2)return 'Олон зөв хариулттай асуултад дор хаяж хоёр сонголт тэмдэглэнэ үү.';
  if(input.questionType==='true_false'&&(input.options.length!==2||input.correctIndexes.length!==1))return 'Үнэн/худал асуулт хоёр сонголт, нэг зөв хариулттай байна.';
  return null;
}

export function questionSimilarity(left:string,right:string):number{
  const a=normalizeQuestionText(left).replace(/[\p{P}\p{S}]/gu,' ').split(/\s+/u).filter(Boolean);
  const b=normalizeQuestionText(right).replace(/[\p{P}\p{S}]/gu,' ').split(/\s+/u).filter(Boolean);
  const aa=new Set(a),bb=new Set(b);if(!aa.size||!bb.size)return 0;
  const intersection=[...aa].filter(word=>bb.has(word)).length;
  return intersection/(aa.size+bb.size-intersection);
}
