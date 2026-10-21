import {z} from 'zod';
export const lessonGroupsInput=z.object({courseId:z.string().uuid(),groups:z.array(z.object({chapterTitle:z.string().trim().min(1).max(200),lessonTitle:z.string().trim().min(1).max(200),questionIndexes:z.array(z.number().int().min(0)).min(1).max(100)})).min(1).max(100)});
export const importTitleKey=(title:string)=>title.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('mn');
export function lessonGroupError(plan:z.infer<typeof lessonGroupsInput>,questionCount:number){
 const indexes=plan.groups.flatMap(g=>g.questionIndexes);
 if(indexes.length!==questionCount||new Set(indexes).size!==questionCount||indexes.some(i=>i>=questionCount))return 'Асуулт бүр яг нэг хичээлд хамаарах ёстой.';
 const keys=plan.groups.map(g=>JSON.stringify([importTitleKey(g.chapterTitle),importTitleKey(g.lessonTitle)]));
 return new Set(keys).size!==keys.length?'Ижил бүлэг, хичээлийн нэр давхардсан байна.':null;
}
