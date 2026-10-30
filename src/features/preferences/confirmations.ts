import {database,siteOrigin,UserError} from '../../server/bot';
import {digest} from '../../core/bot';
import {confirmationMessage,parsePreferences,type Preferences} from '../../core/preferences';
type Confirmation={id:string;dedupe_key:string;email:string;snapshot:string;status:string;message_id:string;last_error:string;created_at:string};
const idPattern=/^[a-f0-9-]{36}$/;
export async function savePreferences(body:Record<string,unknown>){
  let preferences:Preferences;
  try{preferences=parsePreferences(body);}catch(e){throw new UserError((e as Error).message);}
  const requestId=body.requestId===undefined?crypto.randomUUID():String(body.requestId);
  if(!idPattern.test(requestId))throw new UserError('Identificador da alteração inválido. Recarregue a página e tente novamente.');
  const snapshot=JSON.stringify({...preferences,countries:[...preferences.countries].sort()});
  const key=await digest(snapshot+'|'+Math.floor(Date.now()/120000));
  const previous=await database().prepare('SELECT * FROM preference_confirmations WHERE id=? OR dedupe_key=? LIMIT 1').bind(requestId,key).first<Confirmation>();
  if(previous&&previous.snapshot!==snapshot)throw new UserError('Essa alteração já foi processada com outras preferências. Salve novamente.');
  if(previous?.id===requestId)return {ok:true,confirmation:{id:previous.id,status:previous.status}};
  const id=previous?.status==='superseded'?requestId:previous?.id||requestId,dedupe=previous?.dedupe_key||key;
  const statements=[database().prepare('INSERT INTO bot_settings(id,email,notifications,countries) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,notifications=excluded.notifications,countries=excluded.countries').bind(preferences.email,preferences.notifications?1:0,JSON.stringify(preferences.countries))];
  if(preferences.email){
    statements.push(database().prepare("INSERT INTO preference_confirmations(id,dedupe_key,email,snapshot,created_at) VALUES(?,?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET id=excluded.id,status='pending',message_id='',last_error='',created_at=excluded.created_at,sent_at=NULL WHERE preference_confirmations.status='superseded' AND preference_confirmations.id<>excluded.id").bind(id,dedupe,preferences.email,snapshot,new Date().toISOString()));
    statements.push(database().prepare("UPDATE preference_confirmations SET status='superseded' WHERE status='pending' AND id<>COALESCE((SELECT id FROM preference_confirmations WHERE dedupe_key=?),?)").bind(dedupe,id));
  }else statements.push(database().prepare("UPDATE preference_confirmations SET status='superseded' WHERE status='pending'"));
  await database().batch(statements);
  const row=preferences.email?await database().prepare('SELECT id,status FROM preference_confirmations WHERE dedupe_key=?').bind(dedupe).first<{id:string;status:string}>():null;
  return {ok:true,confirmation:row?{id:row.id,status:row.status}:{status:'not_requested'}};
}
export async function pendingConfirmations(){
  return (await database().prepare("SELECT id,email,status,created_at,last_error FROM preference_confirmations WHERE status IN ('pending','claimed','unknown') ORDER BY created_at LIMIT 20").all()).results;
}
export async function claimConfirmation(id:unknown){
  if(typeof id!=='string'||!idPattern.test(id))throw new UserError('Confirmação inválida.');
  const change=await database().prepare("UPDATE preference_confirmations SET status='claimed',last_error='' WHERE id=? AND status='pending'").bind(id).run();
  if(change.meta.changes!==1)throw new UserError('Essa confirmação já foi processada ou está em andamento.',409);
  const row=await database().prepare('SELECT * FROM preference_confirmations WHERE id=?').bind(id).first<Confirmation>();
  if(!row)throw new UserError('Confirmação não encontrada.',404);
  return {id:row.id,...confirmationMessage(row.id,JSON.parse(row.snapshot),siteOrigin())};
}
export async function acknowledgeConfirmation(id:unknown,messageId:unknown){
  if(typeof id!=='string'||!idPattern.test(id)||typeof messageId!=='string'||!messageId||messageId.length>200)throw new UserError('Informe a confirmação e o ID real da mensagem enviada.');
  await database().prepare("UPDATE preference_confirmations SET status='sent',message_id=?,sent_at=CURRENT_TIMESTAMP,last_error='' WHERE id=? AND status IN ('claimed','unknown')").bind(messageId,id).run();
  return {ok:true};
}
export async function confirmationFailure(id:unknown,status:unknown,error:unknown){
  if(typeof id!=='string'||!idPattern.test(id)||!['pending','unknown'].includes(String(status)))throw new UserError('Estado de envio inválido.');
  await database().prepare("UPDATE preference_confirmations SET status=?,last_error=? WHERE id=? AND status IN ('pending','claimed','unknown')").bind(status,String(error||'Envio não confirmado').slice(0,300),id).run();
  return {ok:true};
}
