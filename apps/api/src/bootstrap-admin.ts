import 'dotenv/config';
import {createInterface} from 'node:readline/promises';
import {stdin as input,stdout as output} from 'node:process';
import {hash} from '@node-rs/argon2';
import {sql} from 'drizzle-orm';
import {db,pool} from './db.js';
import {users,auditLogs} from './schema.js';

async function readHidden(prompt:string):Promise<string>{
  if(!input.isTTY||typeof input.setRawMode!=='function')throw new Error('Админыг зөвхөн нууцлалтай интерактив терминалаас bootstrap хийнэ үү.');
  output.write(prompt);
  const wasRaw=input.isRaw??false;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const cleanup=()=>{input.off('data',onData);input.setRawMode(wasRaw);output.write('\n');};
    const onData=(chunk:Buffer|string)=>{
      const key=chunk.toString();
      if(key==='\u0003'){cleanup();reject(new Error('Bootstrap цуцлагдлаа.'));return;}
      if(key==='\r'||key==='\n'){cleanup();resolve(value);return;}
      if(key==='\u007f'||key==='\b'){value=value.slice(0,-1);return;}
      value+=key;
    };
    input.on('data',onData);
  });
}

const rl=createInterface({input,output});
try{
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('unit111.bootstrap-admin'))`);
    const exists=await tx.select({id:users.id}).from(users).limit(1);
    if(exists.length)throw new Error('Хэрэглэгч аль хэдийн бүртгэгдсэн. Bootstrap нэг удаа ажиллана.');
    const username=(await rl.question('Админы нэвтрэх нэр: ')).trim();
    const fullName=(await rl.question('Бүтэн нэр: ')).trim();
    rl.close();
    const password=await readHidden('Түр нууц үг (12+ тэмдэгт; бичихэд харагдахгүй): ');
    if(username.length<3||fullName.length<2||password.length<12)throw new Error('Нэр болон нууц үгийн шаардлагыг шалгана уу.');
    const [user]=await tx.insert(users).values({username,fullName,passwordHash:await hash(password),role:'admin',mustChangePassword:true}).returning({id:users.id});
    await tx.insert(auditLogs).values({action:'bootstrap.admin_created',entityType:'user',entityId:user.id,metadata:{username}});
  });
  console.log('Анхны админ үүслээ. Эхний нэвтрэлтээр нууц үгээ солино.');
}finally{
  rl.close();
  await pool.end();
}
