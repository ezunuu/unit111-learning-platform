import {z} from 'zod';

const optionalNote=z.string().trim().max(2000).nullable().optional();

export const singleQuestionReviewRequest=z.object({verificationNote:optionalNote}).strict();
export const singleQuestionPublishRequest=z.object({verificationNote:optionalNote}).strict();

function bulkRequestSchema(){
  return z.object({items:z.array(z.object({questionId:z.string().uuid(),verificationNote:optionalNote}).strict()).min(1).max(100)}).strict().superRefine((value,context)=>{
    if(new Set(value.items.map(item=>item.questionId)).size!==value.items.length)context.addIssue({code:z.ZodIssueCode.custom,path:['items'],message:'Асуултын ID давхардсан байна.'});
  });
}

export const bulkQuestionReviewRequest=bulkRequestSchema();
export const bulkQuestionPublishRequest=bulkRequestSchema();

export function normalizeReviewNote(value:string|null|undefined):string|null{
  return value?.trim()||null;
}
