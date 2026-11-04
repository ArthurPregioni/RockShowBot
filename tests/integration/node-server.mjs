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
const server=spawn(process.execPath,['deploy/node/server.mjs'],{env:{...process.env,DATABASE_PATH:path.join(temporary,'web.db'),APP_USER:'arthur',APP_PASSWORD:'qa-only-long-password-123',APP_PASSWORD_HASH:'',ROCKSHOWBOT_ENV_FILE:'',ROCKSHOWBOT_SCHEDULER:'false',SMTP_HOST:'',PORT:String(port),HOST:'127.0.0.1',ROCKSHOWBOT_SITE_ORIGIN:base},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
const deadline=Date.now()+30000;
while(true){try{if((await fetch(base+'/healthz')).ok)break;}catch{}if(server.exitCode!==null||Date.now()>deadline)throw new Error('QA server did not start: '+logs);await new Promise(resolve=>setTimeout(resolve,100));}
const browser=await chromium.launch({headless:true});
const owner=await browser.newContext(),other=await browser.newContext(),anonymous=await browser.newContext();
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
 console.log('Node server QA OK: login, invalid credentials, CSRF, forged identity rejection, separate accounts/DBs/preferences, forbidden admin, extension import isolation, password change, session invalidation and logout. No emails sent.');
}finally{await browser.close();server.kill('SIGTERM');await new Promise(resolve=>server.once('close',resolve));rmSync(temporary,{recursive:true});}
