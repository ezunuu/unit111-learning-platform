import dotenv from 'dotenv';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {drizzle} from 'drizzle-orm/node-postgres';import pg from 'pg';import * as schema from './schema.js';
const packageDirectory=dirname(fileURLToPath(import.meta.url));
dotenv.config({path:resolve(packageDirectory,'../../../.env')});
dotenv.config({path:resolve(packageDirectory,'../.env'),override:false});
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL тохируулаагүй байна');
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:true}:undefined,max:10});export const db=drizzle(pool,{schema});
