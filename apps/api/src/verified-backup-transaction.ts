export async function runAfterVerifiedBackup<TBackup,TResult>(createBackup:()=>Promise<TBackup>,runTransaction:()=>Promise<TResult>){
  const backup=await createBackup();
  const result=await runTransaction();
  return{backup,result};
}
