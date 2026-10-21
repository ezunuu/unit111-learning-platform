import {spawn} from 'node:child_process';
import {mkdir,rename,stat,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';

function run(binary:string,args:string[],env:NodeJS.ProcessEnv){
  return new Promise<string>((resolvePromise,reject)=>{
    const child=spawn(binary,args,{env,windowsHide:true,stdio:['ignore','pipe','ignore']});
    let stdout='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>stdout+=chunk);
    const timer=setTimeout(()=>child.kill(),5*60*1000);
    child.once('error',error=>{clearTimeout(timer);reject(error)});
    child.once('close',code=>{clearTimeout(timer);if(code===0)resolvePromise(stdout);else reject(new Error('BACKUP_COMMAND_FAILED'))});
  });
}

export async function createVerifiedTestDatabaseBackup(databaseUrl:string,backupTarget:string,backupKind:'test-quiz-purge'|'question-purge'='test-quiz-purge'){
  const parsed=new URL(databaseUrl),database=decodeURIComponent(parsed.pathname.replace(/^\//,''));
  if(database!=='unit111_admin_test'||!['localhost','127.0.0.1','::1'].includes(parsed.hostname))throw new Error('TEST_DATABASE_ONLY');
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(backupTarget))throw new Error('INVALID_BACKUP_TARGET');
  const env={...process.env,PGHOST:parsed.hostname,PGPORT:parsed.port||'5432',PGUSER:decodeURIComponent(parsed.username),PGPASSWORD:decodeURIComponent(parsed.password),PGDATABASE:database,PGSSLMODE:parsed.searchParams.get('sslmode')||'disable'};
  const toolDirectory=process.env.PG_BIN_DIR||resolve(process.env.ProgramFiles||'C:\\Program Files','PostgreSQL','17','bin');
  const pgDump=existsSync(resolve(toolDirectory,'pg_dump.exe'))?resolve(toolDirectory,'pg_dump.exe'):'pg_dump';
  const pgRestore=existsSync(resolve(toolDirectory,'pg_restore.exe'))?resolve(toolDirectory,'pg_restore.exe'):'pg_restore';
  const outputDirectory=resolve(dirname(fileURLToPath(import.meta.url)),`../../../backups/${backupKind}`);
  await mkdir(outputDirectory,{recursive:true});
  const fileName=`unit111_admin_test_${new Date().toISOString().replace(/[:.]/g,'-')}_${backupTarget}.dump`;
  const finalPath=resolve(outputDirectory,fileName),partialPath=`${finalPath}.partial`;
  try{
    await run(pgDump,['--format=custom','--no-owner','--no-acl','--file',partialPath,'--dbname',database],env);
    const size=(await stat(partialPath)).size;
    if(size<1024)throw new Error('BACKUP_TOO_SMALL');
    const toc=await run(pgRestore,['--list',partialPath],env);
    const required=['TABLE public quizzes','TABLE public quiz_attempts','TABLE public answers','TABLE public quiz_questions','TABLE public audit_logs','TABLE public questions','TABLE public lesson_questions','TABLE public quiz_attempt_questions','TABLE public question_revisions'];
    if(required.some(entry=>!toc.includes(entry)))throw new Error('BACKUP_CONTENT_CHECK_FAILED');
    await rename(partialPath,finalPath);
    return{path:finalPath,sizeBytes:size,verifiedAt:new Date().toISOString()};
  }catch(error){
    await unlink(partialPath).catch(()=>{});
    if(error instanceof Error&&['TEST_DATABASE_ONLY','INVALID_BACKUP_TARGET','BACKUP_TOO_SMALL','BACKUP_CONTENT_CHECK_FAILED'].includes(error.message))throw error;
    if((error as NodeJS.ErrnoException).code==='ENOENT')throw new Error('BACKUP_TOOL_MISSING');
    throw new Error('BACKUP_FAILED');
  }
}
