import {createHash} from 'node:crypto';
// Persistent, per-source throttling. Never lock the owner's account globally.
export function loginThrottle(db){
 db.exec('CREATE TABLE IF NOT EXISTS node_login_failures(source TEXT PRIMARY KEY,count INTEGER NOT NULL,blocked_until INTEGER NOT NULL,updated_at INTEGER NOT NULL)');
 const key=ip=>createHash('sha256').update(String(ip)).digest('hex');
 return {
  remaining(ip){const row=db.prepare('SELECT blocked_until FROM node_login_failures WHERE source=?').get(key(ip));return row?Math.max(0,Math.ceil((row.blocked_until-Date.now())/1000)):0;},
  failed(ip){
   const now=Date.now();db.prepare('DELETE FROM node_login_failures WHERE updated_at<?').run(now-86400000);
   const old=db.prepare('SELECT count,updated_at FROM node_login_failures WHERE source=?').get(key(ip));
   const count=old&&old.updated_at>now-3600000?old.count+1:1;
   const seconds=count<4?0:Math.min(900,2**Math.min(10,count-3));
   db.prepare('INSERT INTO node_login_failures VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET count=excluded.count,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at').run(key(ip),count,now+seconds*1000,now);
   db.exec('DELETE FROM node_login_failures WHERE source IN (SELECT source FROM node_login_failures ORDER BY updated_at DESC LIMIT -1 OFFSET 4096)');return seconds;
  },
  success(ip){db.prepare('DELETE FROM node_login_failures WHERE source=?').run(key(ip));},
 };
}
