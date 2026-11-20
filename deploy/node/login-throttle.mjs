import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
// An IPv6 visitor controls a whole /64, so the prefix is the source; IPv4-mapped addresses count as IPv4.
export function sourceBucket(ip){
 const value=String(ip).toLowerCase().split('%')[0],mapped=value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
 if(mapped)return mapped[1];
 if(isIP(value)!==6)return value;
 const [head,tail='']=value.split('::'),groups=part=>part?part.split(':').flatMap(group=>group.includes('.')?['0','0']:[group]):[];
 const start=groups(head),end=groups(tail),all=value.includes('::')?[...start,...Array(8-start.length-end.length).fill('0'),...end]:start;
 return all.slice(0,4).map(group=>parseInt(group,16).toString(16)).join(':')+'::/64';
}
// Persistent throttling per source and per source+username. Never lock the owner's account globally.
export function loginThrottle(db){
 db.exec('CREATE TABLE IF NOT EXISTS node_login_failures(source TEXT PRIMARY KEY,count INTEGER NOT NULL,blocked_until INTEGER NOT NULL,updated_at INTEGER NOT NULL)');
 const hash=value=>createHash('sha256').update(value).digest('hex');
 // The username row backs off after 3 attempts; the source row only after 20, so one source cannot cycle usernames for free.
 const keys=(ip,username)=>{const source=sourceBucket(ip);return [[hash(source+'\n'+String(username).toLowerCase()),3],[hash(source),20]];};
 const wait=key=>{const row=db.prepare('SELECT blocked_until FROM node_login_failures WHERE source=?').get(key);return row?Math.max(0,Math.ceil((row.blocked_until-Date.now())/1000)):0;};
 return {
  remaining(ip,username=''){return Math.max(...keys(ip,username).map(([key])=>wait(key)));},
  failed(ip,username=''){
   const now=Date.now();db.prepare('DELETE FROM node_login_failures WHERE updated_at<?').run(now-86400000);
   let longest=0;
   for(const [key,free] of keys(ip,username)){
    const old=db.prepare('SELECT count,updated_at FROM node_login_failures WHERE source=?').get(key);
    const count=old&&old.updated_at>now-3600000?old.count+1:1;
    const seconds=count<=free?0:Math.min(900,2**Math.min(10,count-free));
    db.prepare('INSERT INTO node_login_failures VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET count=excluded.count,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at').run(key,count,now+seconds*1000,now);
    longest=Math.max(longest,seconds);
   }
   db.exec('DELETE FROM node_login_failures WHERE source IN (SELECT source FROM node_login_failures ORDER BY updated_at DESC LIMIT -1 OFFSET 4096)');return longest;
  },
  // A login clears only its own username and returns to the source the attempt counted before the password check.
  success(ip,username=''){
   const [[pair],[source]]=keys(ip,username);
   db.prepare('DELETE FROM node_login_failures WHERE source=?').run(pair);
   db.prepare('UPDATE node_login_failures SET count=MAX(0,count-1),blocked_until=0 WHERE source=?').run(source);
  },
 };
}
