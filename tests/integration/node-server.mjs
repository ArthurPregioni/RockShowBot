// Run after build:node. Uses a disposable DB, no SMTP, and only loopback.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import path from 'node:path';
const temporary=mkdtempSync(path.join(tmpdir(),'rockshowbot-node-qa-'));
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`;
let logs='';
function launch(registration='true'){
 const child=spawn(process.execPath,['deploy/node/server.mjs'],{env:{...process.env,DATABASE_PATH:path.join(temporary,'web.db'),APP_USER:'arthur',APP_PASSWORD:'qa-only-long-password-123',APP_PASSWORD_HASH:'',ROCKSHOWBOT_ENV_FILE:'',ROCKSHOWBOT_SCHEDULER:'false',ROCKSHOWBOT_REGISTRATION_ENABLED:registration,SMTP_HOST:'',PORT:String(port),HOST:'127.0.0.1',ROCKSHOWBOT_SITE_ORIGIN:base},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);return child;
}
let server=launch();
async function ready(){
 const deadline=Date.now()+30000;
 while(true){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(server.exitCode!==null||Date.now()>deadline)throw new Error('QA server did not start: '+logs);await new Promise(resolve=>setTimeout(resolve,100));}
}
async function stop(){if(server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('close',resolve));}}
await ready();
const browser=await chromium.launch({headless:true});
const owner=await browser.newContext(),other=await browser.newContext(),anonymous=await browser.newContext(),registered=await browser.newContext();
const api=async(context,path,body,expected=200)=>{
 const r=await context.request[body===undefined?'get':'post'](base+path,{headers:{Origin:base},...(body===undefined?{}:{data:body})});
 assert.equal(r.status(),expected,(await r.text()).slice(0,400));return r;
};
async function login(context,username,password,expected=200){
 const r=await context.request.post(base+'/login',{headers:{Origin:base},form:{username,password,return_to:'/'}});assert.equal(r.status(),expected,(await r.text()).slice(0,200));return r;
}
const stamp=Date.now(),band='Owner QA '+stamp;
try{
 await api(anonymous,'/api/dashboard',undefined,401);
 const forged=await anonymous.request.get(base+'/api/automation/context',{headers:{'oai-authenticated-user-id':'local-owner','oai-authenticated-user-email':'owner@example.test'}});assert.equal(forged.status(),401);
 const csrf=await anonymous.request.post(base+'/login',{headers:{Origin:'https://evil.example'},form:{username:'arthur',password:'qa-only-long-password-123'}});assert.equal(csrf.status(),403);
 await login(anonymous,'arthur','wrong',401);
 await login(owner,'arthur','qa-only-long-password-123');
 await api(owner,'/api/artists',{name:band});
 const signup={username:'signup'+stamp,email:'new@example.test',password:'registration-qa-password-long',confirmation:'registration-qa-password-long',role:'admin'};
 const invalid=async(form,origin=base,status=400)=>{
  const r=await anonymous.request.post(base+'/register',{headers:{Origin:origin},form});assert.equal(r.status(),status);return r;
 };
 await invalid(signup,'https://evil.example',403);
 await invalid({...signup,password:'short',confirmation:'short'});
 const mismatched=await invalid({...signup,confirmation:'different-password-long'});assert.match(await mismatched.text(),/senhas não coincidem/);
 await invalid({...signup,username:'../escape'});
 const signupPage=await registered.newPage();await signupPage.goto(base+'/login');
 await signupPage.getByRole('link',{name:'Criar conta',exact:true}).click();
 await signupPage.getByLabel('Usuário',{exact:true}).fill(signup.username);
 await signupPage.getByLabel('E-mail de alertas',{exact:true}).fill(signup.email);
 await signupPage.getByLabel('Senha',{exact:true}).fill(signup.password);
 await signupPage.getByLabel('Confirmar senha',{exact:true}).fill(signup.confirmation);
 await signupPage.getByRole('button',{name:'Criar conta',exact:true}).click();await signupPage.waitForURL(base+'/');
 const newRadar=await(await api(registered,'/api/dashboard')).json();assert.equal(newRadar.artists.length,0);assert.equal(newRadar.settings.email,signup.email);assert.equal(newRadar.settings.notifications,0);
 await api(registered,'/admin/users',undefined,403);await api(registered,'/admin/email',undefined,403);
 // HTTP callers cannot add an admin role to a registration form.
 const escalated=await anonymous.request.post(base+'/register',{headers:{Origin:base},form:{...signup,username:'ordinary'+stamp}});assert.equal(escalated.status(),200);await api(anonymous,'/admin/users',undefined,403);
 await anonymous.request.post(base+'/signout-with-chatgpt',{headers:{Origin:base}});
 const duplicate=await invalid({...signup,username:signup.username.toUpperCase()});assert.match(await duplicate.text(),/usuário já existe/);assert.ok(!(await duplicate.text()).includes(signup.password));
 await registered.request.post(base+'/signout-with-chatgpt',{headers:{Origin:base}});await login(registered,signup.username,signup.password);
 const created=await owner.request.post(base+'/admin/users',{headers:{Origin:base},form:{username:'guest'+stamp,email:'guest@example.test'}});
 assert.equal(created.status(),200);const password=(await created.text()).match(/Senha inicial: ([A-Za-z0-9_-]+)/)?.[1];assert.ok(password);
 await login(other,'guest'+stamp,password);
 const theirs=await(await api(other,'/api/dashboard')).json();assert.equal(theirs.artists.length,0);assert.equal(theirs.settings.email,'guest@example.test');
 await api(other,'/admin/users',undefined,403);await api(other,'/admin/email',undefined,403);
 const own=await(await api(owner,'/api/dashboard')).json();const privateBand=own.artists.find(a=>a.name===band);assert.ok(privateBand);
 await api(other,'/api/artists/remove',{id:privateBand.id});assert.ok((await(await api(owner,'/api/dashboard')).json()).artists.some(a=>a.id===privateBand.id));
 const prepared=await(await api(other,'/api/music/browser/prepare',{captureFormat:2,provider:'apple',artists:[{name:'Guest private artist '+stamp}]})).json();
 await api(other,'/api/music/import',{ids:prepared.candidates.map(a=>a.id)});
 assert.equal((await(await api(other,'/api/dashboard')).json()).artists.length,1);
 assert.ok(!(await(await api(owner,'/api/dashboard')).json()).artists.some(a=>a.name.startsWith('Guest private')));
 const page=await other.newPage();await page.goto(base+'/');await page.getByRole('link',{name:'Conta',exact:true}).waitFor();
 await page.getByRole('link',{name:'Conta',exact:true}).click();await page.getByRole('heading',{name:'Alterar minha senha'}).waitFor();
 const change=await other.request.post(base+'/account/password',{headers:{Origin:base},form:{current:password,password:'new-guest-qa-password-long'}});assert.equal(change.status(),200);
 await api(other,'/api/dashboard',undefined,401);await login(other,'guest'+stamp,password,401);await login(other,'guest'+stamp,'new-guest-qa-password-long');
 await owner.request.post(base+'/signout-with-chatgpt',{headers:{Origin:base}});await api(owner,'/api/dashboard',undefined,401);
 let throttled=false;
 for(let attempt=0;attempt<21;attempt++){
  const r=await anonymous.request.post(base+'/register',{headers:{Origin:base},form:{...signup,password:'short',confirmation:'short'}});
  if(r.status()===429){throttled=true;break;}assert.equal(r.status(),400);
 }
 assert.ok(throttled,'Registration must have a bounded request limit');
 await stop();server=launch('false');await ready();
 const closedLogin=await anonymous.request.get(base+'/login');assert.ok(!(await closedLogin.text()).includes('href="/register"'));
 assert.equal((await anonymous.request.get(base+'/register')).status(),403);
 await invalid({...signup,username:'closed'+stamp},base,403);
 await login(registered,signup.username,signup.password);
 console.log('Node server QA OK: optional closed registration, browser signup, password validation, duplicate users, registration throttling, no role escalation, login, CSRF, forged identity rejection, separate accounts/DBs/preferences, forbidden admin, extension import isolation, password change, session invalidation and logout. No emails sent.');
}finally{await browser.close();await stop();rmSync(temporary,{recursive:true});}
