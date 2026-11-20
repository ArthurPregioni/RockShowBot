import {smtpRequest} from './smtp-client.mjs';
import {fileURLToPath} from 'node:url';

const migrations=fileURLToPath(new URL('../../drizzle',import.meta.url));
// The 09h/21h (Brasília) slot that started last. It stays open until the next one, so a phone that was off at the hour still scans.
export function scanSlot(time){
 const parts=at=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(part=>[part.type,part.value]));
 const now=parts(time),hour=Number(now.hour),day=hour<9?parts(time-12*3600000):now;
 return [day.year,day.month,day.day,hour>=9&&hour<21?'09':'21'].join('-');
}
export function startScheduler({port,token,database,accounts,localDatabase,fetcher=fetch,transport=smtpRequest,clock=Date.now}){
 let busy=false,currentOwner="local-owner";
 const unconfirmed=new Map(),postponed=new Map();
 database.exec('CREATE TABLE IF NOT EXISTS node_jobs(slot TEXT PRIMARY KEY,status TEXT NOT NULL,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT)');
 if(!database.prepare('PRAGMA table_info(node_jobs)').all().some(column=>column.name==='attempts'))database.exec('ALTER TABLE node_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1');
 const api=async(action,body)=>{
  const response=await fetcher(`http://127.0.0.1:${port}/api/automation/${action}`,{headers:{Authorization:`Bearer ${token}`,"x-rockshowbot-owner":currentOwner,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(240000)});
  const data=await response.json();if(!response.ok)throw new Error(`${action}: ${data.error||response.status}`);return data;
 };
 const send=async message=>(await transport(message)).messageId;
 // A refusal the provider stated clearly waits 1, 2, 4 … 60 minutes for that message instead of retrying every minute.
 const waiting=id=>(postponed.get(id)?.until||0)>clock();
 const postpone=id=>{const failures=(postponed.get(id)?.failures||0)+1;postponed.set(id,{failures,until:clock()+Math.min(60,2**(failures-1))*60000});};
 // A send left without confirmation blocks every later alert. After 30 minutes it returns to the queue: a possible duplicate is preferred to silence.
 async function release(kind,id){
  if(!unconfirmed.has(id))unconfirmed.set(id,clock());
  if(clock()-unconfirmed.get(id)<30*60000)return false;
  await api(kind+'/error',{id,status:'pending',error:'Reenvio automático após 30 minutos sem confirmação.'});unconfirmed.delete(id);
  console.warn(`Envio sem confirmação há 30 minutos (${kind}): devolvido à fila.`);return true;
 }
 async function mail(){
  if(!process.env.SMTP_HOST||process.env.ROCKSHOWBOT_DELIVERY_ENABLED==='false')return;
  for(const confirmation of (await api('confirmations')).confirmations||[]){
   if(confirmation.status!=='pending'&&!await release('confirmations',confirmation.id))continue;
   if(waiting(confirmation.id))continue;
   const message=await api('confirmations/claim',{id:confirmation.id});
   try{const messageId=await send(message);await api('confirmations/ack',{id:confirmation.id,messageId});postponed.delete(confirmation.id);}
   catch(error){if(error.uncertain===false)postpone(confirmation.id);await api('confirmations/error',{id:confirmation.id,status:error.uncertain===false?'pending':'unknown',error:'SMTP sem confirmação; confira o provedor antes de reenviar.'});}
  }
  for(let batch=0;batch<2;batch++){
   const result=await api('alerts/prepare',{});if(!result.delivery)break;
   if(result.needsReconciliation&&!await release('alerts',result.delivery.id))break;
   if(waiting(result.delivery.id))break;
   const message=await api('alerts/claim',{id:result.delivery.id});
   try{const messageId=await send(message);await api('alerts/ack',{id:message.id,messageId});postponed.delete(message.id);}
   catch(error){if(error.uncertain===false)postpone(message.id);await api('alerts/error',{id:message.id,status:error.uncertain===false?'pending':'unknown',error:'SMTP sem confirmação; conferir o provedor antes de reenviar.'});break;}
  }
 }
 // First run of a slot, or a new attempt (three at most) after a failure or after a run left 'running' for 20 minutes by a killed process.
 const claim=slot=>database.prepare("INSERT OR IGNORE INTO node_jobs(slot,status) VALUES(?,'running')").run(slot).changes>0||
  database.prepare("UPDATE node_jobs SET status='running',attempts=attempts+1,started_at=CURRENT_TIMESTAMP,finished_at=NULL WHERE slot=? AND attempts<3 AND (status='failed' OR status='running' AND started_at<datetime('now','-20 minutes'))").run(slot).changes>0;
 async function scan(slot){
  if(!claim(slot))return false;
  try{for(const action of ['sources/scan','scan']){let offset=0;do{const result=await api(action,{offset});offset=result.nextOffset;}while(Number.isInteger(offset));}
   database.prepare("UPDATE node_jobs SET status='done',finished_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);
  }catch(error){database.prepare("UPDATE node_jobs SET status='failed',finished_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);console.error('Busca agendada falhou:',error.message);}
  return true;
 }
 async function tick(){
  if(busy)return;busy=true;
  try{
   // One slot for the whole tick: an account reached after the hour turned still gets this scan.
   const slot=scanSlot(clock()),list=accounts.list();
   for(const [id,since] of unconfirmed)if(since<clock()-86400000)unconfirmed.delete(id);
   for(const [id,entry] of postponed)if(entry.until<clock()-86400000)postponed.delete(id);
   // Each account fails on its own, and everyone's mail goes out before the long scans start.
   const each=async work=>{for(const account of list){currentOwner=account.id;try{await work(account);}catch(error){console.error(`Rotina local (${account.username}):`,error.message);}}};
   await each(async account=>{localDatabase(account.id).migrate(migrations);await mail();});
   await each(async account=>{if(await scan(['scan',account.id,slot].join('-')))await mail();});
  }catch(error){console.error('Rotina local:',error.message);}finally{busy=false;}
 }
 database.prepare("INSERT INTO bot_settings(id,schedule) VALUES(1,'active') ON CONFLICT(id) DO UPDATE SET schedule='active'").run();
 const timer=setInterval(tick,60000),first=setTimeout(tick,5000);timer.unref();first.unref();
 console.log('Rotina nativa: buscas às 09h/21h de Brasília; confirmações de preferências a cada minuto.');
 return {tick,stop:()=>{clearInterval(timer);clearTimeout(first);}};
}
