export function normalizeQuestionText(text:string):string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu,'').toLocaleLowerCase('mn').replace(/\s+/gu,' ').trim();
}

export type DuplicateQuestion = {id:string;questionText:string;status:string};

export function groupDuplicateQuestions(questions:DuplicateQuestion[]) {
  const groups=new Map<string,DuplicateQuestion[]>();
  for(const question of questions) {
    if(question.status!=='pending_review')continue;
    const normalized=normalizeQuestionText(question.questionText);
    if(!normalized)continue;
    const group=groups.get(normalized)??[];
    group.push(question);
    groups.set(normalized,group);
  }
  return [...groups.entries()]
    .filter(([,group])=>group.length>1)
    .map(([normalizedText,items])=>({normalizedText,items}))
    .sort((a,b)=>a.normalizedText.localeCompare(b.normalizedText,'mn'));
}
