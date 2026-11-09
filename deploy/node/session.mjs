import {authHTML} from './auth-page.mjs';
import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const sessionCookie='rockshowbot_session';
export const hashToken=value=>createHash('sha256').update(value).digest('hex');
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);return `scrypt:${salt}:${key.toString('hex')}`;}
export async function verifyPassword(password,encoded){
  const [algorithm,salt,digest]=String(encoded||'').split(':');
  if(algorithm!=='scrypt'||!salt||!digest)return false;
  const expected=Buffer.from(digest,'hex'),actual=await scrypt(password,salt,64);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function safeReturn(value){try{const u=new URL(value||'/','https://local.invalid');return u.origin==='https://local.invalid'&&!['/login','/register','/signin-with-chatgpt','/signout-with-chatgpt'].includes(u.pathname)?u.pathname+u.search:'/';}catch{return '/';}}
export function cookies(value=''){return Object.fromEntries(value.split(';').map(part=>{const i=part.indexOf('=');return i<0?['','']:[part.slice(0,i).trim(),part.slice(i+1).trim()];}));}
export const SESSION_SECONDS=180*86400;
export function sessionStore(db){
  db.exec('CREATE TABLE IF NOT EXISTS node_sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)');
  const columns=new Set(db.prepare('PRAGMA table_info(node_sessions)').all().map(r=>r.name));
  for(const [name,type] of [['id','TEXT'],['created_at','INTEGER'],['last_seen','INTEGER'],['agent','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE node_sessions ADD COLUMN ${name} ${type}`);
  // Migrate existing sessions without changing tokens or extending expired sessions.
  const now=Date.now();
  for(const row of db.prepare('SELECT token_hash FROM node_sessions WHERE id IS NULL').all())db.prepare('UPDATE node_sessions SET id=?,created_at=?,last_seen=?,agent=? WHERE token_hash=?').run(randomUUID(),null,0,'Navegador já conectado',row.token_hash);
  return {
    create(username,agent=''){
      const now=Date.now(),token=randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM node_sessions WHERE expires<=?').run(now);
      db.prepare('INSERT INTO node_sessions(token_hash,username,expires,id,created_at,last_seen,agent) VALUES(?,?,?,?,?,?,?)').run(hashToken(token),username,now+SESSION_SECONDS*1000,randomUUID(),now,now,String(agent).slice(0,256));return token;
    },
    find(token){return token?db.prepare('SELECT username FROM node_sessions WHERE token_hash=? AND expires>?').get(hashToken(token),Date.now())?.username:null;},
    touch(token){
      if(!token)return false;const now=Date.now(),row=db.prepare('SELECT expires,last_seen FROM node_sessions WHERE token_hash=? AND expires>?').get(hashToken(token),now);if(!row)return false;
      const renew=row.expires<now+(SESSION_SECONDS-86400)*1000;
      if(renew||row.last_seen<now-300000)db.prepare('UPDATE node_sessions SET expires=?,last_seen=? WHERE token_hash=? AND expires>?').run(renew?now+SESSION_SECONDS*1000:row.expires,now,hashToken(token),now);
      return renew;
    },
    revoke(token){if(token)db.prepare('DELETE FROM node_sessions WHERE token_hash=?').run(hashToken(token));},
  };
}
export function loginHTML(error='',returnTo='/',registrationEnabled=true){return authHTML({error,returnTo:safeReturn(returnTo),registrationEnabled});}
export function signupHTML(error=''){return authHTML({register:true,error});}
