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
export function safeReturn(value){try{const u=new URL(value||'/','https://local.invalid');return u.origin==='https://local.invalid'&&!['/login','/signin-with-chatgpt','/signout-with-chatgpt'].includes(u.pathname)?u.pathname+u.search:'/';}catch{return '/';}}
export function cookies(value=''){return Object.fromEntries(value.split(';').map(part=>{const i=part.indexOf('=');return i<0?['','']:[part.slice(0,i).trim(),part.slice(i+1).trim()];}));}
export function sessionStore(db){
  db.exec('CREATE TABLE IF NOT EXISTS node_sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)');
  return {
    create(username){const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM node_sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO node_sessions VALUES(?,?,?)').run(hashToken(token),username,Date.now()+7*86400000);return token;},
    find(token){return token?db.prepare('SELECT username FROM node_sessions WHERE token_hash=? AND expires>?').get(hashToken(token),Date.now())?.username:null;},
    revoke(token){if(token)db.prepare('DELETE FROM node_sessions WHERE token_hash=?').run(hashToken(token));},
  };
}
export function loginHTML(error='',returnTo='/'){
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar · RockShowBot</title><link rel="icon" href="/favicon.svg"><style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#101114;color:#f2eff4;font:16px system-ui,sans-serif;padding:24px}main{width:min(100%,420px)}.brand{color:#ff687e;font-size:28px;font-weight:750;margin-bottom:42px}h1{font-size:34px;margin:0 0 10px}p{color:#a4acb9;line-height:1.6}form{background:#191b21;border:1px solid #343944;border-radius:16px;padding:28px;margin-top:26px}label{display:block;margin:0 0 8px;font-size:14px}input{width:100%;padding:13px;border-radius:8px;border:1px solid #424958;background:#10141b;color:#fff;font:inherit;margin-bottom:22px}button{width:100%;border:0;border-radius:8px;padding:14px;background:#ff687e;color:#2f1420;font:700 15px system-ui;cursor:pointer}:focus-visible{outline:2px solid #ff9db0;outline-offset:3px}.error{color:#ffb5cd}footer{font-size:13px;color:#7e8b9e;margin-top:24px}</style></head><body><main><div class="brand">RockShowBot.</div><h1>Seu radar de shows.</h1><p>Entre para acompanhar seus artistas e administrar seus alertas.</p><form method="post" action="/login"><input type="hidden" name="return_to" value="${escape(safeReturn(returnTo))}">${error?`<p role="alert" class="error">${escape(error)}</p>`:''}<label for="username">Usuário</label><input id="username" name="username" autocomplete="username" required autofocus maxlength="100"><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="512"><button type="submit">Entrar</button></form><footer>Sua conta é administrada pelo responsável por esta instalação.</footer></main></body></html>`;
}
