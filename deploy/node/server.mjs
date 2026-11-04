import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {mailHTML,saveMailConfig} from './mail-config.mjs';
import {accountStore,accountHTML} from './accounts.mjs';
import {passwordHash,verifyPassword,sessionStore,sessionCookie,cookies,safeReturn,loginHTML,signupHTML} from './session.mjs';

if(process.env.ROCKSHOWBOT_ENV_FILE){const values=parseEnv(readFileSync(process.env.ROCKSHOWBOT_ENV_FILE,'utf8'));for(const [key,value]of Object.entries(values))process.env[key]=value;}
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const username=process.env.APP_USER||'admin';
let encoded=process.env.APP_PASSWORD_HASH;
if(!encoded&&process.env.APP_PASSWORD?.length>=16)encoded=await passwordHash(process.env.APP_PASSWORD);
if(!encoded)throw new Error('Configure APP_PASSWORD_HASH ou uma APP_PASSWORD com pelo menos 16 caracteres.');
const origin=new URL(process.env.ROCKSHOWBOT_SITE_ORIGIN||'http://127.0.0.1:8765');
if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))throw new Error('Use HTTPS para acesso externo.');
process.env.ROCKSHOWBOT_SITE_ORIGIN=origin.origin;
const {localDatabase,runForOwner}=await import('./runtime.mjs');
const binding=localDatabase();binding.migrate(path.join(root,'drizzle'));
const accounts=accountStore(binding.connection);accounts.initialize(username,process.env.ADMIN_EMAIL||`${username}@localhost`,encoded);
const sessions=sessionStore(binding.connection),attempts=new Map();
const registrationEnabled=process.env.ROCKSHOWBOT_REGISTRATION_ENABLED!=='false';
const loginPage=(error='',returnTo='/')=>loginHTML(error,returnTo,registrationEnabled);
let registrations={count:0,until:Date.now()+3600000};
function initializeRadar(created,email){
 const userdb=localDatabase(created.id);userdb.migrate(path.join(root,'drizzle'));
 userdb.connection.prepare('INSERT INTO bot_settings(id,email,notifications,countries,schedule) VALUES(1,?,0,?,?)').run(email,'["BR"]',process.env.ROCKSHOWBOT_SCHEDULER==='true'?'active':'pending');
}
const schedulerToken=randomBytes(32).toString('hex');
const {startProdServer}=await import('vinext/server/prod-server');
const {server,port}=await startProdServer({port:Number(process.env.PORT||8765),host:process.env.HOST||'127.0.0.1',outDir:path.resolve(process.env.ROCKSHOWBOT_BUILD_DIR||path.join(root,'dist'))});
const handlers=server.listeners('request');server.removeAllListeners('request');
const html=(res,status,body,extra={})=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"frame-ancestors 'none'",...extra});res.end(body);};
const redirect=(res,to,cookie)=>{res.writeHead(303,{'Location':to,'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})});res.end();};
const cookie=(token,clear=false)=>`${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:604800}${origin.protocol==='https:'?'; Secure':''}`;
server.on('request',async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  // Strip identity asserted by callers before adding this server's verified owner.
  for(const key of Object.keys(req.headers))if(key.startsWith('oai-authenticated-user-'))delete req.headers[key];
  const token=cookies(req.headers.cookie)[sessionCookie],owner=sessions.find(token);
  let account=owner?accounts.find(owner):null;
  const internal=req.headers.authorization===`Bearer ${schedulerToken}`&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if(internal)account=accounts.byId(req.headers['x-rockshowbot-owner']||'local-owner');
  if(url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({app:'RockShowBot',backend:'node',ok:true}));return;}
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!internal){
   const allowed=new Set([origin.origin,`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
   if(!allowed.has(req.headers.origin)){html(res,403,'Origem da requisição inválida.');return;}
  }
  if(url.pathname==='/signin-with-chatgpt'){redirect(res,'/login?return_to='+encodeURIComponent(safeReturn(url.searchParams.get('return_to'))));return;}
  if(url.pathname==='/signout-with-chatgpt'){
   if(req.method!=='POST'){html(res,200,'<form method="post"><button>Sair do RockShowBot</button></form>');return;}
   sessions.revoke(token);redirect(res,'/login',cookie('',true));return;
  }
  if(url.pathname==='/register'){
   if(!registrationEnabled){html(res,403,loginPage('O cadastro está fechado. Peça uma conta ao administrador.'));return;}
   if(account){redirect(res,'/');return;}
   if(req.method==='GET'){html(res,200,signupHTML());return;}
   if(req.method!=='POST'){html(res,405,'Método inválido.');return;}
   if(registrations.until<Date.now())registrations={count:0,until:Date.now()+3600000};
   if(registrations.count>=20){html(res,429,signupHTML('Limite de cadastros atingido nesta instalação. Tente novamente em uma hora.'));return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){html(res,413,signupHTML('Formulário muito grande.'));return;}}
   registrations.count++;
   const form=new URLSearchParams(body),password=form.get('password')||'';
   try{
    if(password!==form.get('confirmation'))throw new Error('As senhas não coincidem.');
    const email=(form.get('email')||'').trim().toLowerCase();
    const created=await accounts.create((form.get('username')||'').trim(),email,password);
    initializeRadar(created,email);
    redirect(res,'/',cookie(sessions.create(created.username)));return;
   }catch(error){html(res,400,signupHTML(error.message));return;}
  }
  if(url.pathname==='/login'){
   if(req.method==='GET'){if(owner)redirect(res,safeReturn(url.searchParams.get('return_to')));else html(res,200,loginPage('',url.searchParams.get('return_to')));return;}
   if(req.method!=='POST'){html(res,405,'Método inválido.');return;}
   const key=req.socket.remoteAddress,bucket=attempts.get(key)||{count:0,until:Date.now()+600000};
   if(bucket.until<Date.now()){bucket.count=0;bucket.until=Date.now()+600000;}
   attempts.set(key,bucket);if(bucket.count>=10){html(res,429,loginPage('Muitas tentativas. Aguarde dez minutos.'));return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){html(res,413,'Formulário muito grande.');return;}}
   const form=new URLSearchParams(body);bucket.count++;
   const candidate=accounts.find(form.get('username')||'');
   if(!candidate||!await verifyPassword(form.get('password')||'',candidate.password_hash)){html(res,401,loginPage('Usuário ou senha incorretos.',form.get('return_to')));return;}
   attempts.delete(key);redirect(res,safeReturn(form.get('return_to')),cookie(sessions.create(candidate.username)));return;
  }
  if(!account){
   if(url.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Entre na sua conta para continuar.'}));}
   else redirect(res,'/login?return_to='+encodeURIComponent(safeReturn(req.url)));
   return;
  }
  if(['/account','/admin/users','/account/password','/admin/email'].includes(url.pathname)){
   if(url.pathname.startsWith('/admin/')&&account.role!=='admin'){html(res,403,'Acesso restrito ao administrador.');return;}
   let notice='';
   if(req.method==='POST'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){html(res,413,'Formulário muito grande.');return;}}
    const form=new URLSearchParams(body);
    try{
     if(url.pathname==='/admin/email'){await saveMailConfig(form);html(res,200,mailHTML(process.env.ROCKSHOWBOT_DELIVERY_ENABLED==='false'?'Autenticação SMTP validada. Os disparos continuam pausados para concluir a migração.':'Autenticação SMTP validada e configuração salva.'));return;}
     if(url.pathname==='/admin/users'){
      const created=await accounts.create(form.get('username')||'',form.get('email')||'');
      initializeRadar(created,form.get('email'));
      notice=`Conta criada. Compartilhe estas credenciais com a pessoa por um canal privado.\nUsuário: ${created.username}\nSenha inicial: ${created.password}\nA senha pode ser alterada na página Conta.`;
     }else if(url.pathname==='/account/password'){
      if(!await verifyPassword(form.get('current')||'',account.password_hash))throw new Error('Senha atual incorreta.');
      await accounts.changePassword(account.id,form.get('password')||'');
      binding.connection.prepare('DELETE FROM node_sessions WHERE username=?').run(account.username);
      redirect(res,'/login',cookie('',true));return;
     }
    }catch(error){html(res,400,url.pathname==='/admin/email'?mailHTML(error.message):accountHTML(accounts.list(),account.role==='admin',error.message));return;}
   }
   if(url.pathname==='/admin/email'){html(res,200,mailHTML());return;}
   html(res,200,accountHTML(accounts.list(),account.role==='admin',notice));return;
  }
  req.headers['oai-authenticated-user-id']=account.id;
  req.headers['oai-authenticated-user-email']=account.email;
  req.headers['oai-authenticated-user-full-name']=encodeURIComponent(account.username);
  req.headers['oai-authenticated-user-full-name-encoding']='percent-encoded-utf-8';
  localDatabase(account.id).migrate(path.join(root,'drizzle'));
  runForOwner(account.id,()=>{for(const handler of handlers)handler.call(server,req,res);});
 }catch(error){console.error('Request failed:',error.name);if(!res.headersSent)html(res,500,'Não foi possível concluir. Tente novamente.');else res.destroy();}
});
console.log(`RockShowBot com login ativo em http://${process.env.HOST||'127.0.0.1'}:${port}`);
if(process.env.ROCKSHOWBOT_SCHEDULER==='true'){
 const {startScheduler}=await import('./scheduler.mjs');startScheduler({port,token:schedulerToken,database:binding.connection,accounts,localDatabase});
}
