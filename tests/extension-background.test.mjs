import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../browser-extension/background.js',import.meta.url),'utf8');
function harness(){
 const records={},grants={allowed:true};let listener;
 const storage={get:async key=>key?{[key]:records[key]}:{...records},set:async value=>Object.assign(records,value),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete records[key];}};
 const api={runtime:{getURL:path=>'moz-extension://test/'+path,onMessage:{addListener:fn=>listener=fn}},permissions:{contains:async()=>grants.allowed},storage:{session:storage,local:{set:async()=>{}}},tabs:{get:async()=>({id:1,url:'https://music.apple.com/br/library/artists'}),create:async()=>({id:10}),onRemoved:{addListener:()=>{}}},scripting:{executeScript:async args=>args.files?[]:[{result:{ok:true,value:{provider:'apple',artists:[{id:'angra',name:'Angra'}],limited:false,notice:'Test fixture'}}}],getRegisteredContentScripts:async()=>[],registerContentScripts:async()=>{},unregisterContentScripts:async()=>{}}};
 vm.runInNewContext(source,{browser:api,URL,Date,console});
 const send=(message,sender)=>new Promise(resolve=>{if(!listener(message,sender,resolve))resolve(null);});
 return {send,records,grants};
}
const popup={url:'moz-extension://test/popup.html'};
test('Capture is accepted only from the extension popup, with an authorized destination',async()=>{
 const h=harness();
 assert.equal(await h.send({type:'capture',tabId:1,origin:'https://shows.test'},{url:'https://evil.test'}),null);
 assert.equal((await h.send({type:'capture',tabId:1,origin:'https://shows.test/path'},popup)).ok,false);
 h.grants.allowed=false;
 assert.equal((await h.send({type:'capture',tabId:1,origin:'https://shows.test'},popup)).ok,false);
 h.grants.allowed=true;
 assert.equal((await h.send({type:'capture',tabId:1,origin:'https://shows.test'},popup)).ok,true);
 assert.equal(h.records['import:10'].origin,'https://shows.test');
});
test('Artist handoff is bound to the destination tab, origin and path, expires and is consumed',async()=>{
 const h=harness();await h.send({type:'capture',tabId:1,origin:'https://shows.test'},popup);
 for(const sender of [{url:'https://evil.test/music/browser-import',tab:{id:10},frameId:0},{url:'https://shows.test/music/browser-import',tab:{id:11},frameId:0},{url:'https://shows.test/other',tab:{id:10},frameId:0},{url:'https://shows.test/music/browser-import',tab:{id:10},frameId:1}])assert.equal((await h.send({type:'take-artists'},sender)).ok,false);
 const sender={url:'https://shows.test/music/browser-import',tab:{id:10},frameId:0};
 assert.equal((await h.send({type:'take-artists'},sender)).value.artists[0].name,'Angra');
 assert.equal((await h.send({type:'take-artists'},sender)).ok,false);
 await h.send({type:'capture',tabId:1,origin:'https://shows.test'},popup);h.records['import:10'].expires=0;
 assert.equal((await h.send({type:'take-artists'},sender)).ok,false);
});
