import {authHTML} from './auth-page.mjs';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
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
export function sessionStore(db){
  db.exec('CREATE TABLE IF NOT EXISTS node_sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)');
  return {
    create(username){const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM node_sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO node_sessions VALUES(?,?,?)').run(hashToken(token),username,Date.now()+7*86400000);return token;},
    find(token){return token?db.prepare('SELECT username FROM node_sessions WHERE token_hash=? AND expires>?').get(hashToken(token),Date.now())?.username:null;},
    revoke(token){if(token)db.prepare('DELETE FROM node_sessions WHERE token_hash=?').run(hashToken(token));},
  };
}
export function loginHTML(error='',returnTo='/',registrationEnabled=true){return authHTML({error,returnTo:safeReturn(returnTo),registrationEnabled});}
export function signupHTML(error=''){return authHTML({register:true,error});}
