import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {SQLiteBinding} from '../../deploy/node/database.mjs';
import {startScheduler,scanSlot} from '../../deploy/node/scheduler.mjs';
const migrations=fileURLToPath(new URL('../../drizzle',import.meta.url));
process.env.SMTP_HOST='smtp.example.test';delete process.env.ROCKSHOWBOT_DELIVERY_ENABLED;
const logs=[];for(const level of ['log','warn','error'])console[level]=(...values)=>logs.push(values.join(' '));
const owner=[{id:'local-owner',username:'owner'}],minute=60000;
// The automation API and the SMTP transport are replaced; nothing leaves the process.
function harness({accounts=owner,answer=()=>undefined,transport=async()=>({messageId:'<sent@example.test>'}),time=Date.parse('2026-11-19T15:00:00Z')}={}){
 const binding=new SQLiteBinding(':memory:');binding.migrate(migrations);
 const calls=[],state={time},idle={confirmations:{confirmations:[]},'alerts/prepare':{delivery:null},'sources/scan':{nextOffset:null},scan:{nextOffset:null}};
 const fetcher=async(url,options={})=>{
  const call={owner:options.headers['x-rockshowbot-owner'],action:new URL(url).pathname.replace('/api/automation/',''),body:options.body?JSON.parse(options.body):undefined};calls.push(call);
  try{return Response.json(await answer(call)??idle[call.action]??{ok:true});}catch(error){return Response.json({error:error.message},{status:500});}
 };
 const start=()=>startScheduler({port:1,token:'test-only',database:binding.connection,accounts:{list:()=>accounts},localDatabase:()=>({migrate(){}}),fetcher,transport,clock:()=>state.time});
 let scheduler=start();
 const jobs=()=>binding.connection.prepare('SELECT slot,status,attempts FROM node_jobs ORDER BY slot').all().map(row=>({...row}));
 // restart() stands for the service being stopped and started: only what is in the database survives.
 return {get scheduler(){return scheduler;},restart(){scheduler.stop();scheduler=start();},calls,state,jobs,db:binding.connection,trace:()=>calls.map(call=>call.owner+' '+call.action),close(){scheduler.stop();binding.connection.close();}};
}
test('The open scan slot is the 09h or 21h of Brasília that started last',()=>{
 for(const [utc,slot] of [['2026-11-19T11:59:00Z','2026-11-18-21'],['2026-11-19T12:00:00Z','2026-11-19-09'],['2026-11-19T23:59:00Z','2026-11-19-09'],['2026-11-20T00:00:00Z','2026-11-19-21'],['2026-11-20T03:10:00Z','2026-11-19-21']])assert.equal(scanSlot(Date.parse(utc)),slot);
});
test('One failing account never stops the others, and mail goes out before the scans',async()=>{
 const h=harness({accounts:[{id:'a',username:'aaa'},...owner],answer:call=>{if(call.owner==='a')throw new Error('boom');}});
 await h.scheduler.tick();
 assert.deepEqual(h.trace(),['a confirmations','local-owner confirmations','local-owner alerts/prepare','a sources/scan','a confirmations','local-owner sources/scan','local-owner scan','local-owner confirmations','local-owner alerts/prepare']);
 assert.deepEqual(h.jobs(),[{slot:'scan-a-2026-11-19-09',status:'failed',attempts:1},{slot:'scan-local-owner-2026-11-19-09',status:'done',attempts:1}]);
 assert.ok(logs.some(line=>line.includes('Rotina local (aaa)')));h.close();
});
test('The slot is fixed when the tick starts: an account reached after the hour turned still scans it',async()=>{
 const h=harness({accounts:[{id:'a',username:'aaa'},...owner],time:Date.parse('2026-11-19T23:50:00Z'),answer:call=>{if(call.owner==='a'&&call.action==='scan')h.state.time+=60*minute;}});
 await h.scheduler.tick();
 assert.deepEqual(h.jobs().map(job=>job.slot),['scan-a-2026-11-19-09','scan-local-owner-2026-11-19-09']);
 await h.scheduler.tick();
 assert.deepEqual(h.jobs().map(job=>job.slot+' '+job.status),['scan-a-2026-11-19-09 done','scan-a-2026-11-19-21 done','scan-local-owner-2026-11-19-09 done','scan-local-owner-2026-11-19-21 done']);h.close();
});
test('A failed or abandoned scan is retried on later ticks, three attempts at most',async()=>{
 let broken=true;const h=harness({answer:call=>{if(broken&&call.action==='sources/scan')throw new Error('offline');}});
 const scans=()=>h.calls.filter(call=>call.action==='sources/scan').length;
 for(let attempt=0;attempt<5;attempt++)await h.scheduler.tick();
 assert.equal(scans(),3);assert.deepEqual(h.jobs(),[{slot:'scan-local-owner-2026-11-19-09',status:'failed',attempts:3}]);
 // A run left 'running' by a killed process is taken over after 20 minutes, not before.
 broken=false;h.db.prepare("UPDATE node_jobs SET status='running',attempts=1,started_at=datetime('now','-5 minutes')").run();
 await h.scheduler.tick();assert.equal(scans(),3);assert.equal(h.jobs()[0].status,'running');
 h.db.prepare("UPDATE node_jobs SET started_at=datetime('now','-21 minutes')").run();
 await h.scheduler.tick();assert.equal(scans(),4);assert.deepEqual(h.jobs(),[{slot:'scan-local-owner-2026-11-19-09',status:'done',attempts:2}]);
 await h.scheduler.tick();assert.equal(scans(),4);h.close();
});
test('A send left unconfirmed returns to the queue after 30 minutes instead of blocking alerts forever',async()=>{
 const status={alert:'unknown',confirmation:'claimed'},sent=[],released=[];
 const h=harness({transport:async message=>{sent.push(message.id);return {messageId:'<sent@example.test>'};},answer:({action,body})=>{
  if(action==='confirmations')return {confirmations:status.confirmation==='sent'?[]:[{id:'c1',status:status.confirmation,created_at:'2026-11-19T14:00:00.000Z'}]};
  if(action==='alerts/prepare')return status.alert==='sent'?{delivery:null}:{delivery:{id:'d1'},needsReconciliation:status.alert!=='pending'};
  const kind=action.startsWith('alerts')?'alert':'confirmation';
  if(action.endsWith('/error')){released.push(action+' '+body.status);status[kind]=body.status;}
  if(action.endsWith('/claim')){assert.equal(status[kind],'pending');status[kind]='claimed';return {id:body.id,to:'owner@example.test',subject:'QA',body:'Synthetic QA'};}
  if(action.endsWith('/ack'))status[kind]='sent';
 }});
 const start=h.state.time,before=logs.length;
 for(const elapsed of [0,10,29]){h.state.time=start+elapsed*minute;await h.scheduler.tick();}
 assert.deepEqual(sent,[]);assert.deepEqual(released,[]);
 h.state.time=start+30*minute;await h.scheduler.tick();
 assert.deepEqual(sent,['c1','d1']);assert.deepEqual(released,['confirmations/error pending','alerts/error pending']);assert.deepEqual(status,{alert:'sent',confirmation:'sent'});
 assert.equal(logs.slice(before).filter(line=>line.includes('devolvido à fila')).length,2);
 // A confirmed send leaves nothing behind to count against a later message.
 assert.equal(h.db.prepare('SELECT COUNT(*) AS total FROM node_resends').get().total,0);h.close();
});
test('Automatic returns to the queue stop at three, with growing waits, and a restart does not start the series again',async()=>{
 let status='pending';const sent=[];
 const h=harness({transport:async()=>{sent.push((h.state.time-start)/minute);throw Object.assign(new Error('no reply after the data'),{uncertain:true});},answer:({action,body})=>{
  if(action==='alerts/prepare')return {delivery:{id:'d1'},needsReconciliation:status!=='pending'};
  if(action==='alerts/error')status=body.status;
  if(action==='alerts/claim'){assert.equal(status,'pending');status='claimed';return {id:body.id,to:'owner@example.test',subject:'QA',body:'Synthetic QA'};}
 }});
 const start=h.state.time,before=logs.length,at=async elapsed=>{h.state.time=start+elapsed*minute;await h.scheduler.tick();};
 // Sent at 0 and left unconfirmed: it returns 30 minutes later, then 2 hours and 8 hours after the previous return.
 await at(0);await at(29);assert.deepEqual(sent,[0]);
 await at(30);assert.deepEqual(sent,[0,30]);
 // The service restarts in the middle of the second wait: the count and the wait are still there.
 h.restart();await at(60);await at(149);assert.deepEqual(sent,[0,30]);
 await at(150);assert.deepEqual(sent,[0,30,150]);
 await at(629);assert.deepEqual(sent,[0,30,150]);
 await at(630);assert.deepEqual(sent,[0,30,150,630]);
 // After the third return nothing is sent again, across restarts and beyond the 30-day cleanup of the table.
 h.restart();
 for(const elapsed of [631,1200,5000,50000,100000])await at(elapsed);
 assert.deepEqual(sent,[0,30,150,630]);assert.equal(status,'unknown');
 assert.deepEqual({...h.db.prepare('SELECT id,count FROM node_resends').get()},{id:'d1',count:3});
 assert.ok(logs.slice(before).some(line=>line.includes('aguardando conferência manual')));h.close();
});
test('An old unconfirmed confirmation is not sent again and does not hold the ones behind it',async()=>{
 const sent=[],status={old:'unknown',fresh:'pending'};
 const h=harness({transport:async message=>{sent.push(message.id);return {messageId:'<sent@example.test>'};},answer:({action,body})=>{
  if(action==='confirmations')return {confirmations:[{id:'old',status:status.old,created_at:'2026-11-10T12:00:00.000Z'},{id:'fresh',status:status.fresh,created_at:'2026-11-19T14:59:00.000Z'}].filter(item=>item.status!=='sent')};
  if(action==='confirmations/error')status[body.id]=body.status;
  if(action==='confirmations/claim'){status[body.id]='claimed';return {id:body.id,to:'owner@example.test',subject:'QA',body:'Synthetic QA'};}
  if(action==='confirmations/ack')status[body.id]='sent';
 }});
 const start=h.state.time;
 for(const elapsed of [0,31,200,700]){h.state.time=start+elapsed*minute;await h.scheduler.tick();}
 assert.deepEqual(sent,['fresh']);assert.deepEqual(status,{old:'unknown',fresh:'sent'});h.close();
});
test('A definite SMTP refusal backs off 1, 2, 4 … minutes for that message; an uncertain result is never resent blindly',async()=>{
 const tried=[];let uncertain=false;
 const h=harness({transport:async()=>{tried.push(h.state.time);throw Object.assign(new Error('refused'),{uncertain});},answer:({action,body})=>{
  if(action==='alerts/prepare')return {delivery:{id:'d1'}};
  if(action==='alerts/claim')return {id:body.id,to:'owner@example.test',subject:'QA',body:'Synthetic QA'};
 }});
 const start=h.state.time;
 for(let elapsed=0;elapsed<=8;elapsed++){h.state.time=start+elapsed*minute;await h.scheduler.tick();}
 assert.deepEqual(tried.map(time=>(time-start)/minute),[0,1,3,7]);
 assert.ok(h.calls.filter(call=>call.action==='alerts/error').every(call=>call.body.status==='pending'));
 uncertain=true;h.state.time=start+15*minute;await h.scheduler.tick();
 assert.equal(h.calls.filter(call=>call.action==='alerts/error').at(-1).body.status,'unknown');h.close();
});
