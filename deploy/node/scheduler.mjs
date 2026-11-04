import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function startScheduler({port,token,database,accounts,localDatabase}){
 let busy=false,currentOwner="local-owner";
 database.exec('CREATE TABLE IF NOT EXISTS node_jobs(slot TEXT PRIMARY KEY,status TEXT NOT NULL,started_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT)');
 const api=async(action,body)=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/automation/${action}`,{headers:{Authorization:`Bearer ${token}`,"x-rockshowbot-owner":currentOwner,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(240000)});
  const data=await response.json();if(!response.ok)throw new Error(`${action}: ${data.error||response.status}`);return data;
 };
 const send=message=>new Promise((resolve,reject)=>{
  const child=spawn(process.env.PYTHON||'python3',[fileURLToPath(new URL('./smtp.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();child.on('error',reject);
  child.on('close',code=>{try{const result=JSON.parse(output);if(code||!result.accepted)throw new Error('SMTP não confirmou a entrega.');resolve(result.messageId);}catch(error){reject(error);}});
  child.stdin.end(JSON.stringify(message));
 });
 async function mail(){
  if(!process.env.SMTP_HOST)return;
  for(const confirmation of (await api('confirmations')).confirmations||[]){
   if(confirmation.status!=='pending')continue;
   const message=await api('confirmations/claim',{id:confirmation.id});
   try{const messageId=await send(message);await api('confirmations/ack',{id:confirmation.id,messageId});}
   catch{await api('confirmations/error',{id:confirmation.id,status:'unknown',error:'SMTP sem confirmação; confira o provedor antes de reenviar.'});}
  }
  for(let batch=0;batch<2;batch++){
   const result=await api('alerts/prepare',{});if(!result.delivery)break;
   if(result.needsReconciliation){console.warn('Envio anterior sem confirmação: reconciliação manual necessária.');break;}
   const message=await api('alerts/claim',{id:result.delivery.id});
   try{const messageId=await send(message);await api('alerts/ack',{id:message.id,messageId});}
   catch{await api('alerts/error',{id:message.id,status:'unknown',error:'SMTP sem confirmação; conferir o provedor antes de reenviar.'});break;}
  }
 }
 async function tick(){
  if(busy)return;busy=true;
  try{
   for(const account of accounts.list()){
   currentOwner=account.id;
   const userdb=localDatabase(account.id);userdb.migrate(new URL('../../drizzle',import.meta.url).pathname);
   const now=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
   const part=name=>now.find(p=>p.type===name)?.value;
   if(['09','21'].includes(part('hour'))){
    const slot=['scan',account.id,part('year'),part('month'),part('day'),part('hour')].join('-');
    if(database.prepare("INSERT OR IGNORE INTO node_jobs(slot,status) VALUES(?,'running')").run(slot).changes){
     try{for(const action of ['sources/scan','scan']){let offset=0;do{const result=await api(action,{offset});offset=result.nextOffset;}while(offset!==null);}
      database.prepare("UPDATE node_jobs SET status='done',finished_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);
     }catch(error){database.prepare("UPDATE node_jobs SET status='failed',finished_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);console.error('Busca agendada falhou:',error.message);}
    }
   }
   await mail();
   }
  }catch(error){console.error('Rotina local:',error.message);}finally{busy=false;}
 }
 database.prepare("INSERT INTO bot_settings(id,schedule) VALUES(1,'active') ON CONFLICT(id) DO UPDATE SET schedule='active'").run();
 const timer=setInterval(tick,60000);timer.unref();setTimeout(tick,5000).unref();
 console.log('Rotina nativa: buscas às 09h/21h de Brasília; confirmações de preferências a cada minuto.');
 return {stop:()=>clearInterval(timer)};
}
