export type PreviewOption={id:string;optionText:string};
export type PreviewQuestionInput={
  id:string;questionOrder:number;questionText:string;questionType:string;difficulty:string;status:string;xp:number;
  explanation:string;sourceDocument:string|null;sourceRevision:string|null;sourceLocation:string|null;
  options:PreviewOption[];correctOptionIds:string[];
};

export function buildAdminLessonPreview<T extends {id:string;title:string;status:string}>(lesson:T,questions:PreviewQuestionInput[]){
  const items=[...questions].sort((a,b)=>a.questionOrder-b.questionOrder).map(question=>({
    ...question,
    options:question.options.map(option=>({id:option.id,optionText:option.optionText})),
    correctOptionIds:[...question.correctOptionIds],
    correctOptionTexts:question.options.filter(option=>question.correctOptionIds.includes(option.id)).map(option=>option.optionText),
  }));
  const allPublished=items.length>=1&&items.length<=100&&items.every(question=>question.status==='published');
  const readyToPublish=allPublished&&items.every(question=>question.questionText.trim().length>0&&question.options.length===4&&question.correctOptionIds.length===1);
  return {lesson,questions:items,review:{questionCount:items.length,allPublished,readyToPublish},mode:'read_only_preview' as const};
}
