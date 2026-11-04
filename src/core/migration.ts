export const migrationTables=['watch_artists','show_events','bot_settings','alert_receipts','alert_deliveries','preference_confirmations','scan_runs'] as const;
export function migrationDestination(value:unknown){
 if(typeof value!=='string')throw new Error('Informe a URL HTTPS do novo servidor.');
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use somente a origem HTTPS do novo servidor.');
 return url.origin;
}
export function migrationFreezePlan(destination:string){
 const idle="NOT EXISTS (SELECT 1 FROM alert_deliveries WHERE status IN ('claimed','unknown')) AND NOT EXISTS (SELECT 1 FROM preference_confirmations WHERE status IN ('claimed','unknown'))";
 const frozen="EXISTS (SELECT 1 FROM bot_settings WHERE id=1 AND schedule LIKE 'migrated:%')";
 return [
  ...migrationTables.map(table=>({sql:`SELECT * FROM ${table} ORDER BY rowid`,values:[] as string[]})),
  {sql:`UPDATE bot_settings SET notifications=0,schedule=? WHERE id=1 AND ${idle}`,values:['migrated:'+destination]},
  {sql:`UPDATE alert_deliveries SET status='cancelled',last_error='Migrado para outro servidor antes do envio.' WHERE status='pending' AND ${frozen}`,values:[]},
  {sql:`UPDATE preference_confirmations SET status='superseded',last_error='Transferido para o novo servidor.' WHERE status='pending' AND ${frozen}`,values:[]},
  {sql:'SELECT schedule FROM bot_settings WHERE id=1',values:[]},
 ];
}
