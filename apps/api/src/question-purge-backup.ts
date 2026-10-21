export type QuestionPurgeEligibility={id:string;canDelete:boolean};

export async function createBackupForEligibleQuestionPurge<T>(items:QuestionPurgeEligibility[],createBackup:()=>Promise<T>){
  const eligibleIds=items.filter(item=>item.canDelete).map(item=>item.id);
  if(eligibleIds.length===0)return{kind:'none_eligible' as const,eligibleIds};
  const backup=await createBackup();
  return{kind:'verified' as const,eligibleIds,backup};
}
