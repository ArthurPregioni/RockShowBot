import {database,UserError,siteOrigin} from "../../server/database.ts";
import {settings} from "../../server/bot.ts";
import {visibleEvents,reconcileEvents} from "./store.ts";
import {digest} from "../../core/bot.ts";
import {eventIdentity,eventRevision,notificationIdentity,renderAlert,type StoredEvent} from "../../core/events.ts";

type Snapshot=StoredEvent&{receiptId:string;revision:string;key:string};
type Delivery={id:string;recipient:string;batch_key:string;status:string;subject:string;body:string;snapshot:string;message_id:string;last_error:string;created_at:string;sent_at:string|null};
const deliveryView=(row:Delivery)=>{const counts=renderAlert(row.id,JSON.parse(row.snapshot),siteOrigin());return {id:row.id,status:row.status,to:row.recipient,subject:row.subject,body:row.body,messageId:row.message_id,lastError:row.last_error,count:counts.count,concerts:counts.concerts,possibilities:counts.possibilities};};
export async function pendingAlerts(){
  const preferences=await settings();if(!preferences.notifications||!preferences.email)return [];
  const recipient=preferences.email.trim().toLowerCase(),db=database();
  const visible=await visibleEvents(JSON.parse(preferences.countries),10000);
  // Preserve legacy delivery flags without inventing Gmail IDs or historical send times.
  const legacy=(await db.prepare("SELECT * FROM show_events WHERE notified=1 AND status<>'duplicate'").all<StoredEvent>()).results;
  for(let offset=0;offset<legacy.length;offset+=80){
    const statements=await Promise.all(legacy.slice(offset,offset+80).map(async event=>db.prepare("INSERT OR IGNORE INTO alert_receipts(id,event_key,revision,recipient,kind) VALUES(?,?,?,?, 'legacy-notified')").bind(await digest(recipient+"|"+notificationIdentity(event)),eventIdentity(event),eventRevision(event),recipient)));
    if(statements.length)await db.batch(statements);
  }
  const receipts=new Set((await db.prepare("SELECT id FROM alert_receipts WHERE recipient=?").bind(recipient).all<{id:string}>()).results.map(row=>row.id));
  const result:Snapshot[]=[];
  for(const event of visible){const revision=eventRevision(event),receiptId=await digest(recipient+"|"+notificationIdentity(event));if(!event.notified&&!receipts.has(receiptId))result.push({...event,key:eventIdentity(event),revision,receiptId});}
  return result.slice(0,100);
}
export async function prepareAlert(){
  const preferences=await settings();if(!preferences.notifications||!preferences.email)return {delivery:null};
  const db=database(),recipient=preferences.email.trim().toLowerCase(),items=await pendingAlerts();
  const active=await db.prepare("SELECT * FROM alert_deliveries WHERE recipient=? AND status IN ('pending','claimed','unknown') LIMIT 1").bind(recipient).first<Delivery>();
  if(active){
    if(active.status!=="pending")return {delivery:deliveryView(active),needsReconciliation:true};
    const eligible=new Set(items.map(item=>item.id+"|"+item.receiptId));
    const snapshot=JSON.parse(active.snapshot) as Snapshot[];
    if(snapshot.length===items.length&&snapshot.every(item=>eligible.has(item.id+"|"+item.receiptId)))return {delivery:deliveryView(active)};
    await db.prepare("UPDATE alert_deliveries SET status='cancelled',last_error='Conteúdo superado antes do envio.' WHERE id=? AND status='pending'").bind(active.id).run();
  }
  if(!items.length)return {delivery:null};
  const id=crypto.randomUUID(),batchKey=await digest(recipient+"|"+items.map(item=>item.receiptId).sort().join("|")+"|"+id),message=renderAlert(id,items,siteOrigin());
  await db.prepare("INSERT OR IGNORE INTO alert_deliveries(id,recipient,batch_key,subject,body,snapshot) VALUES(?,?,?,?,?,?)").bind(id,recipient,batchKey,message.subject,message.body,JSON.stringify(items)).run();
  const row=await db.prepare("SELECT * FROM alert_deliveries WHERE recipient=? AND status IN ('pending','claimed','unknown') LIMIT 1").bind(recipient).first<Delivery>();
  return {delivery:row?deliveryView(row):null,needsReconciliation:row?row.status!=="pending":false};
}
export async function claimAlert(id:unknown){
  if(typeof id!=="string")throw new UserError("Resumo inválido.");
  await reconcileEvents();
  const row=await database().prepare("SELECT * FROM alert_deliveries WHERE id=?").bind(id).first<Delivery>();
  if(!row||row.status!=="pending")throw new UserError("Resumo já reservado, enviado ou indisponível. Confira o histórico do Gmail.",409);
  const preferences=await settings();if(!preferences.notifications||preferences.email.trim().toLowerCase()!==row.recipient)throw new UserError("As preferências mudaram. Prepare outro resumo.",409);
  const result=await database().prepare("UPDATE alert_deliveries SET status='claimed',last_error='' WHERE id=? AND status='pending' AND NOT EXISTS (SELECT 1 FROM json_each(alert_deliveries.snapshot) item LEFT JOIN show_events event ON event.id=json_extract(item.value,'$.id') WHERE event.id IS NULL OR event.status<>json_extract(item.value,'$.status') OR event.identity_key<>json_extract(item.value,'$.key') OR event.notified<>0)").bind(id).run();
  if(result.meta.changes!==1){await database().prepare("UPDATE alert_deliveries SET status='cancelled',last_error='Dados atualizados antes da reserva.' WHERE id=? AND status='pending'").bind(id).run();throw new UserError("O resumo mudou. Prepare outro antes de enviar.",409);}
  return deliveryView({...row,status:"claimed"});
}
export async function acknowledgeAlert(id:unknown,messageId:unknown){
  if(typeof id!=="string"||typeof messageId!=="string"||!messageId.trim()||messageId.length>200)throw new UserError("Informe o resumo e o ID real confirmado pelo Gmail.");
  const db=database(),row=await db.prepare("SELECT * FROM alert_deliveries WHERE id=?").bind(id).first<Delivery>();
  if(!row)throw new UserError("Resumo não encontrado.",404);
  if(row.status==="sent"){if(row.message_id!==messageId)throw new UserError("Resumo já confirmado com outro ID do Gmail.",409);return {acknowledged:true,alreadySent:true};}
  if(!["claimed","unknown"].includes(row.status))throw new UserError("Reserve o resumo antes de confirmar o envio.",409);
  const items=JSON.parse(row.snapshot) as Snapshot[];
  const statements=items.flatMap(item=>[
    db.prepare("INSERT OR IGNORE INTO alert_receipts(id,event_key,revision,recipient,delivery_id,message_id,kind) VALUES(?,?,?,?,?,?,'delivery')").bind(item.receiptId,item.key,item.revision,row.recipient,id,messageId),
    db.prepare("UPDATE show_events SET notified=1 WHERE id=? AND identity_key=? AND status=?").bind(item.id,item.key,item.status),
  ]);
  statements.push(db.prepare("UPDATE alert_deliveries SET status='sent',message_id=?,sent_at=CURRENT_TIMESTAMP,last_error='' WHERE id=? AND status IN ('claimed','unknown')").bind(messageId,id));
  await db.batch(statements);return {acknowledged:true,events:items.length};
}
export async function alertFailure(id:unknown,status:unknown,error:unknown){
  if(typeof id!=="string"||!["pending","unknown"].includes(String(status)))throw new UserError("Estado do envio inválido.");
  await database().prepare("UPDATE alert_deliveries SET status=?,last_error=? WHERE id=? AND status IN ('pending','claimed','unknown')").bind(status,String(error||"").slice(0,500),id).run();return {ok:true};
}
export async function alertHistory(){return (await database().prepare("SELECT id,recipient,status,subject,message_id,last_error,created_at,sent_at FROM alert_deliveries ORDER BY created_at DESC LIMIT 20").all()).results;}
