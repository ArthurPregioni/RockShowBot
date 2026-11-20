// The real deploy/node/server.mjs on loopback with the framework replaced by a stub: no build, browser or network.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import http from 'node:http';
import {SQLiteBinding} from '../../deploy/node/database.mjs';
const local=relative=>fileURLToPath(new URL(relative,import.meta.url));
const site='https://app.qa.example.test',PASSWORD='qa-only-long-password-123',GUEST='guest-qa-only-password-1',servers=[];
async function launch(extra={}){
 const directory=mkdtempSync(join(tmpdir(),'rockshowbot-wrapper-'));let output='';
 const child=spawn(process.execPath,['--import',pathToFileURL(local('./support/framework-stub.mjs')).href,local('../../deploy/node/server.mjs')],{env:{...process.env,DATABASE_PATH:join(directory,'web.db'),APP_USER:'arthur',APP_PASSWORD:PASSWORD,APP_PASSWORD_HASH:'',ROCKSHOWBOT_ENV_FILE:'',ROCKSHOWBOT_SCHEDULER:'false',ROCKSHOWBOT_REGISTRATION_ENABLED:'',ROCKSHOWBOT_PROXY_KEY:'',PERSONAL_ACCESS_DOMAIN:'',PERSONAL_ACCESS_TARGETS:'',SMTP_HOST:'',PORT:'0',HOST:'127.0.0.1',ROCKSHOWBOT_SITE_ORIGIN:site,...extra},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const deadline=Date.now()+30000;let port;
 while(!(port=output.match(/login ativo em http:\/\/127\.0\.0\.1:(\d+)/)?.[1])){if(child.exitCode!==null||Date.now()>deadline)throw new Error('Server did not start: '+output);await new Promise(resolve=>setTimeout(resolve,50));}
 const server={base:'http://127.0.0.1:'+port,directory,log:()=>output,async stop(){if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('close',resolve));}rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
 servers.push(server);return server;
}
after(async()=>{for(const server of servers)await server.stop();});
const get=(server,path,cookie='')=>fetch(server.base+path,{redirect:'manual',headers:cookie?{Cookie:cookie}:{}});
const post=(server,path,form,{cookie='',origin=site}={})=>fetch(server.base+path,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',...(origin?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})},body:new URLSearchParams(form)});
const status=async response=>{await response.arrayBuffer();return response.status;};
const session=response=>response.headers.getSetCookie().map(line=>line.split(';')[0]).filter(pair=>!pair.endsWith('=')).join('; ');
const login=(server,username,password,return_to='/')=>post(server,'/login',{username,password,return_to});
// Sends headers only, or a chunked body, to see what the wrapper answers before the application reads anything.
const upload=(server,cookie,headers,chunks=[])=>new Promise(resolve=>{
 const request=http.request(server.base+'/api/artists',{method:'POST',headers:{Origin:site,Cookie:cookie,'Content-Type':'application/json',...headers}},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>{request.destroy();resolve({status:response.statusCode,body});});});
 request.on('error',()=>resolve({status:'dropped'}));request.flushHeaders();
 if(chunks.length){for(const chunk of chunks)request.write(chunk);request.end();}
});
const personal={PERSONAL_ACCESS_DOMAIN:'qa.example.test',PERSONAL_ACCESS_TARGETS:'{"casahub":"https://casahub.qa.example.test/"}'};

test('Sign-up stays closed unless explicitly enabled, and the missing proxy key is announced at startup',async()=>{
 for(const server of [await launch(personal),await launch({ROCKSHOWBOT_REGISTRATION_ENABLED:'TRUE'})]){
  assert.equal(await status(await get(server,'/register')),403);
  assert.equal(await status(await post(server,'/register',{username:'someone',email:'new@example.test',password:GUEST,confirmation:GUEST})),403);
  assert.ok(!(await(await get(server,'/login')).text()).includes('href="/register"'));
 }
 const deadline=Date.now()+5000;while(!servers[0].log().includes('ROCKSHOWBOT_PROXY_KEY')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 assert.match(servers[0].log(),/ROCKSHOWBOT_PROXY_KEY não configurada/);
});
test('Return paths, personal targets, frame headers and body limits on the authenticated path',async()=>{
 const server=servers[0],signedIn=await login(server,'arthur',PASSWORD,'/.//evil.example/login');
 assert.equal(signedIn.status,303);assert.equal(signedIn.headers.get('location'),'/');const cookie=session(signedIn);
 const bounce=await get(server,'/login?return_to='+encodeURIComponent('/.//evil.example/login'),cookie);assert.equal(bounce.headers.get('location'),'/');assert.equal(await status(bounce),303);
 assert.equal(await status(await get(server,'/personal/access?service=__proto__',cookie)),400);assert.equal(await status(await get(server,'/personal/access?service=constructor',cookie)),400);
 const hub=await get(server,'/personal/access?service=casahub',cookie);assert.equal(hub.headers.get('location'),'https://casahub.qa.example.test/');assert.equal(await status(hub),303);assert.equal(await status(await get(server,'/account',cookie)),200);
 const page=await get(server,'/api/dashboard',cookie);assert.equal(page.headers.get('x-frame-options'),'DENY');assert.equal(page.headers.get('content-security-policy'),"frame-ancestors 'none'");assert.equal((await page.json()).id,'local-owner');
 const form=await get(server,'/login');assert.equal(form.headers.get('x-frame-options'),'DENY');assert.equal(await status(form),200);
 const refused=await upload(server,cookie,{'Content-Length':1000001});assert.equal(refused.status,413);assert.match(refused.body,/Requisição muito grande/);
 const exact=await fetch(server.base+'/api/artists',{method:'POST',headers:{Origin:site,Cookie:cookie,'Content-Type':'application/json'},body:'x'.repeat(1000000)});assert.equal((await exact.json()).bytes,1000000);
 // Without a declared length the stream is counted as it arrives and cut once it passes the limit.
 assert.equal((await upload(server,cookie,{'Transfer-Encoding':'chunked'},['small body'])).status,200);
 assert.equal((await upload(server,cookie,{'Transfer-Encoding':'chunked'},Array(12).fill('y'.repeat(100000)))).status,'dropped');
});
test('Sign-up limits count created accounts, a parallel burst cannot pass them and unexpected failures stay generic',async()=>{
 const server=await launch({ROCKSHOWBOT_REGISTRATION_ENABLED:'true',ROCKSHOWBOT_PROXY_KEY:'synthetic-proxy-origin-key-for-wrapper-tests'});
 assert.ok(!server.log().includes('ROCKSHOWBOT_PROXY_KEY'));
 const create=name=>post(server,'/register',{username:name,email:name+'@example.test',password:GUEST,confirmation:GUEST});
 for(let attempt=0;attempt<25;attempt++)assert.equal(await status(await post(server,'/register',{username:'x',email:'bad',password:'short',confirmation:'short'})),400);
 const mismatch=await post(server,'/register',{username:'someone',email:'new@example.test',password:GUEST,confirmation:GUEST+'x'});assert.match(await mismatch.text(),/senhas não coincidem/);
 // The per-account database cannot be created: the visitor gets a generic answer, never the path.
 writeFileSync(join(server.directory,'users'),'');
 const broken=await create('broken');assert.equal(broken.status,500);const text=await broken.text();assert.match(text,/Não foi possível concluir/);assert.ok(!text.includes(server.directory)&&!/EEXIST|ENOTDIR|mkdir/.test(text));
 rmSync(join(server.directory,'users'));
 const burst=await Promise.all(['one','two','three','four'].map(create));
 assert.deepEqual((await Promise.all(burst.map(status))).sort(),[303,303,429,429]);
 assert.equal(await status(await create('five')),429);
 server.created=['one','two','three','four'].filter((name,index)=>burst[index].status===303);
});
test('Login attempts are counted per username before the password check; another account never resets them',async()=>{
 const server=servers.at(-1),guest=server.created[0],seen=[];
 for(let attempt=0;attempt<3;attempt++)seen.push(await status(await login(server,'arthur','wrong-'+attempt)));
 seen.push(await status(await login(server,guest,GUEST)));
 for(let attempt=3;attempt<5;attempt++)seen.push(await status(await login(server,'ARTHUR','wrong-'+attempt)));
 assert.deepEqual(seen,[401,401,401,303,401,429]);
 const blocked=await login(server,'arthur',PASSWORD);assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);await blocked.arrayBuffer();
 const tally={};for(const code of await Promise.all(Array.from({length:30},(_,index)=>login(server,server.created[1],'burst-'+index).then(status))))tally[code]=(tally[code]||0)+1;
 assert.deepEqual(tally,{401:4,429:26});
 // An unknown username behaves exactly like a real one.
 const unknown=[];for(let attempt=0;attempt<5;attempt++)unknown.push(await status(await login(server,'nobody-here','wrong-'+attempt)));
 assert.deepEqual(unknown,[401,401,401,401,429]);
});
test('The scheduler reaches the application with its internal bearer; a guessed one from outside does not',async()=>{
 const server=await launch({ROCKSHOWBOT_SCHEDULER:'true'});
 assert.equal(await status(await fetch(server.base+'/api/automation/context',{headers:{Authorization:'Bearer '+'0'.repeat(64),'x-rockshowbot-owner':'local-owner'}})),401);
 const db=new SQLiteBinding(join(server.directory,'web.db')).connection,deadline=Date.now()+30000;
 const job=()=>{try{return db.prepare("SELECT status,attempts FROM node_jobs WHERE slot LIKE 'scan-local-owner-%'").get();}catch{return undefined;}};
 try{
  // The first tick runs five seconds after start; a refused bearer would leave the slot 'failed'.
  while(job()?.status!=='done'){assert.ok(Date.now()<deadline&&job()?.status!=='failed','Scheduler did not complete its slot: '+server.log());await new Promise(resolve=>setTimeout(resolve,200));}
  assert.deepEqual({...job()},{status:'done',attempts:1});
 }finally{db.close();}
});
