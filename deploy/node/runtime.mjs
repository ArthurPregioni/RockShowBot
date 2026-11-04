import {SQLiteBinding} from './database.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import path from 'node:path';
import os from 'node:os';
const key=Symbol.for('rockshowbot.sqlite.runtime');
const state=globalThis[key]??= {databases:new Map(),owners:new AsyncLocalStorage()};
export function localDatabase(owner=state.owners.getStore()||'local-owner'){
  if(owner!=='local-owner'&&!/^[a-f0-9-]{36}$/.test(owner))throw new Error('Invalid account ID');
  if(!state.databases.has(owner)){
    const base=process.env.DATABASE_PATH||path.join(os.homedir(),'.local/share/rockshowbot/web.db');
    const filename=owner==='local-owner'?base:path.join(path.dirname(base),'users',owner+'.db');
    state.databases.set(owner,new SQLiteBinding(filename));
  }
  return state.databases.get(owner);
}
export const runForOwner=(owner,callback)=>state.owners.run(owner,callback);
export const env=new Proxy({}, {get:(_target,key)=>key==='DB'?localDatabase():process.env[key]});
