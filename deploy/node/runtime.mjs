import {SQLiteBinding} from './database.mjs';
import path from 'node:path';
import os from 'node:os';
const key=Symbol.for('rockshowbot.sqlite');
export function localDatabase(){
  if(!globalThis[key]){
    const filename=process.env.DATABASE_PATH||path.join(os.homedir(),'.local/share/rockshowbot/web.db');
    globalThis[key]=new SQLiteBinding(filename);
  }
  return globalThis[key];
}
export const env=new Proxy({}, {get:(_target,key)=>key==='DB'?localDatabase():process.env[key]});
