import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{handleBridge,tunnelOrigin} from '../../deploy/bridge/worker.mjs';
const token='test-only-bridge-token-never-a-real-secret';
const base='https://rockshowbot.example.workers.dev',origin='https://phone-test.trycloudflare.com';
function environment(){const values=new Map();return {ORIGIN_UPDATE_TOKEN:token,TUNNEL_STATE:{get:async key=>values.get(key),put:async(key,value)=>{values.set(key,value);}},values};}
const update=(value,secret=token)=>new Request(base+'/_rockshowbot/tunnel',{method:'POST',headers:{Authorization:'Bearer '+secret},body:JSON.stringify({origin:value})});
test('Bridge updates require authentication and accept only plain HTTPS tunnel origins',async()=>{
 const env=environment();
 assert.equal((await handleBridge(update(origin,'wrong'),env)).status,401);assert.equal(env.values.size,0);
 for(const value of ['http://phone.trycloudflare.com','https://example.com','https://user:pass@phone.trycloudflare.com','https://phone.trycloudflare.com/path','https://phone.trycloudflare.com/?token=x','https://127.0.0.1','https://phone.trycloudflare.com.evil.example']){
  assert.throws(()=>tunnelOrigin(value));assert.equal((await handleBridge(update(value),env)).status,400);
 }
 const result=await handleBridge(update(origin),env);assert.deepEqual(await result.json(),{updated:true});assert.equal(env.values.get('origin'),origin);
 assert.equal((await handleBridge(new Request(base+'/_rockshowbot/tunnel',{headers:{Authorization:'Bearer '+token}}),env)).status,405);
});
test('Bridge streams login requests, preserves browser origin/cookies and rewrites only its own redirects',async()=>{
 const env=environment();env.values.set('origin',origin);let calls=0;
 const request=new Request(base+'/login?return_to=%2F',{method:'POST',headers:{Origin:base,Cookie:'session=test-only','Content-Type':'application/x-www-form-urlencoded'},body:'username=qa&password=test-only'});
 const response=await handleBridge(request,env,async(forwarded,options)=>{
  calls++;assert.equal(forwarded.url,origin+'/login?return_to=%2F');assert.equal(forwarded.headers.get('Origin'),base);assert.equal(forwarded.headers.get('Cookie'),'session=test-only');assert.equal(await forwarded.text(),'username=qa&password=test-only');assert.equal(forwarded.redirect,'manual');assert.equal(options.cache,'no-store');
  return new Response(null,{status:303,headers:{Location:origin+'/account','Set-Cookie':'rockshowbot_session=qa; Secure; HttpOnly; Path=/'}});
 });
 assert.equal(calls,1);assert.equal(response.status,303);assert.equal(response.headers.get('Location'),base+'/account');assert.match(response.headers.get('Set-Cookie'),/HttpOnly/);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 const external=await handleBridge(new Request(base+'/'),env,async()=>new Response(null,{status:303,headers:{Location:'https://accounts.example/authorize'}}));assert.equal(external.headers.get('Location'),'https://accounts.example/authorize');
});
test('Bridge fails closed for missing state and handles an offline phone without exposing internals',async()=>{
 const env=environment();assert.equal((await handleBridge(new Request(base+'/'),env,()=>{throw Error('must not fetch');})).status,503);
 env.values.set('origin',origin);
 const response=await handleBridge(new Request(base+'/'),env,()=>{throw Error('private diagnostic');});assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private diagnostic'));
});
test('Worker entrypoint ignores the runtime context argument and serves actual upstream responses',async t=>{
 const env=environment();env.values.set('origin',origin);
 t.mock.method(globalThis,'fetch',async()=>new Response('phone content'));
 assert.equal(await(await worker.fetch(new Request(base+'/'),env,{waitUntil(){}})).text(),'phone content');
});
