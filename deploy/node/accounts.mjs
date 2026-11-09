import {randomUUID,randomBytes} from 'node:crypto';
import {passwordHash} from './session.mjs';
export function accountStore(db){
 db.exec('CREATE TABLE IF NOT EXISTS node_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE NOT NULL,email TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 return {
  initialize(username,email,hash){db.prepare("INSERT OR IGNORE INTO node_accounts(id,username,email,password_hash,role) VALUES('local-owner',?,?,?,'admin')").run(username,email,hash);},
  find(username){return db.prepare('SELECT * FROM node_accounts WHERE username=? COLLATE NOCASE').get(username);},
  byId(id){return db.prepare('SELECT * FROM node_accounts WHERE id=?').get(id);},
  list(){return db.prepare('SELECT id,username,email,role FROM node_accounts ORDER BY username').all();},
  async create(username,email,password=randomBytes(20).toString('base64url')){
   if(!/^[a-zA-Z0-9._-]{3,40}$/.test(username))throw new Error('Use de 3 a 40 letras, números, ponto, hífen ou sublinhado.');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Error('Informe um e-mail válido.');
   if(password.length<16||password.length>512)throw new Error('Use uma senha de 16 a 512 caracteres.');
   if(this.find(username))throw new Error('Esse usuário já existe.');
   const id=randomUUID();
   const hash=await passwordHash(password);
   // Check again after scrypt yields so concurrent signups get the same safe error.
   if(this.find(username))throw new Error('Esse usuário já existe.');
   db.prepare("INSERT INTO node_accounts(id,username,email,password_hash,role) VALUES(?,?,?,?,'user')").run(id,username,email,hash);
   return {id,username,password};
  },
  async changePassword(id,password){
   if(password.length<16||password.length>512)throw new Error('Use uma senha de 16 a 512 caracteres.');
   db.prepare('UPDATE node_accounts SET password_hash=? WHERE id=?').run(await passwordHash(password),id);
  },
 };
}
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accountHTML(accounts,admin,notice='',personalTargets=null){
 const rows=admin?`<p><a href="/admin/email">Configurar remetente de e-mail</a></p><h2>Contas desta instalação</h2><ul>${accounts.map(a=>`<li>${esc(a.username)} — ${esc(a.email)} (${a.role==='admin'?'administrador':'usuário'})</li>`).join('')}</ul><h2>Criar conta</h2><p>Cada conta terá seus próprios artistas, preferências, histórico e e-mail de alertas.</p><form method="post" action="/admin/users"><label>Usuário<input name="username" required minlength="3" maxlength="40" autocomplete="off"></label><label>E-mail<input name="email" required type="email" autocomplete="off"></label><button>Criar conta e gerar senha</button></form>`:'';
 return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conta · RockShowBot</title><style>body{max-width:760px;margin:40px auto;padding:24px;background:#101114;color:#f2eff4;font:16px system-ui;line-height:1.6}a{color:#ff8295}h1{color:#ff687e}input{display:block;background:#1b202a;color:white;border:1px solid #566070;border-radius:8px;padding:12px;margin:8px 0 20px;width:min(90%,420px)}button{border:0;border-radius:8px;background:#ff687e;color:#301521;padding:12px 20px;cursor:pointer}pre{white-space:pre-wrap;border:1px solid #566070;border-radius:8px;padding:16px}form{margin-bottom:40px}</style><a href="/">← Voltar ao radar</a><h1>Sua conta no RockShowBot</h1>${notice?`<pre role="status">${esc(notice)}</pre>`:''}${personalTargets?`<h2>Suas centrais pessoais</h2><p>${Object.entries(personalTargets).map(([name,url])=>`<a href="${esc(url)}">${name==='casahub'?'CasaHub':'Finanças'}</a>`).join(' · ')} · <a href="${esc(new URL('/access',personalTargets.casahub||personalTargets.financas).href)}">Aparelhos conectados</a></p><p>O mesmo login abre as três centrais. Sair de uma encerra esta sessão nas três.</p>`:''}${rows}<h2>Alterar minha senha</h2><form method="post" action="/account/password"><label>Senha atual<input name="current" type="password" autocomplete="current-password" required></label><label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="16" maxlength="512" required></label><button>Alterar senha</button></form><form method="post" action="/signout-with-chatgpt"><button>Sair</button></form></html>`;
}
