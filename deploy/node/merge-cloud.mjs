// Final receipt reconciliation while the destination's mail delivery is paused.
import {readFileSync} from 'node:fs';
import {SQLiteBinding} from './database.mjs';
const [source,target]=process.argv.slice(2);
if(!source||!target)throw new Error('Usage: node merge-cloud.mjs frozen-export.json database.db');
const data=JSON.parse(readFileSync(source,'utf8'));
if(data.format!=='rockshowbot-web-sqlite-v1'||data.frozen!==true)throw new Error('Use the export returned by a successful source freeze.');
const tables=['watch_artists','show_events','alert_receipts','alert_deliveries','preference_confirmations','scan_runs'];
if(tables.some(table=>!Array.isArray(data.tables?.[table])))throw new Error('Incomplete frozen export.');
if(['alert_deliveries','preference_confirmations'].some(table=>data.tables[table].some(row=>['claimed','unknown'].includes(row.status))))throw new Error('Reconcile uncertain sends before merging.');
const binding=new SQLiteBinding(target),db=binding.connection;
binding.migrate(new URL('../../drizzle',import.meta.url).pathname);
function insert(table,row){
 const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
 const keys=Object.keys(row);if(keys.some(k=>!columns.has(k)))throw new Error('Unexpected columns in '+table);
 db.prepare(`INSERT OR IGNORE INTO ${table} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
}
db.exec('BEGIN IMMEDIATE');
try{
 for(const table of ['alert_deliveries','preference_confirmations'])if(db.prepare(`SELECT 1 FROM ${table} WHERE status IN ('claimed','unknown')`).get())throw new Error('Destination has an unresolved send; refusing to merge.');
 for(const artist of data.tables.watch_artists)insert('watch_artists',artist);
 for(const event of data.tables.show_events){
  const existing=event.identity_key?db.prepare('SELECT * FROM show_events WHERE id=? OR identity_key=?').get(event.id,event.identity_key):db.prepare('SELECT * FROM show_events WHERE id=?').get(event.id);
  if(!existing){insert('show_events',event);continue;}
  if(event.status==='listed'&&existing.status!=='listed'){
   db.prepare("UPDATE show_events SET title=?,city=?,url=?,source=?,status='listed',identity_key=?,published_at=?,suppress_reason='' WHERE id=?").run(event.title,event.city,event.url,event.source,event.identity_key,event.published_at||'',existing.id);
  }
  if(event.status===existing.status||event.status==='listed')db.prepare('UPDATE show_events SET notified=MAX(notified,?) WHERE id=?').run(event.notified,existing.id);
 }
 for(const receipt of data.tables.alert_receipts)insert('alert_receipts',receipt);
 for(const item of data.tables.alert_deliveries){
  const row=item.status==='pending'?{...item,status:'cancelled',last_error:'Repreparar no novo servidor.'}:item;
  insert('alert_deliveries',row);
  if(row.status==='sent')db.prepare("UPDATE alert_deliveries SET status='sent',message_id=?,sent_at=?,last_error='' WHERE id=? AND status<>'sent'").run(row.message_id,row.sent_at,row.id);
  else if(['cancelled','superseded'].includes(row.status))db.prepare('UPDATE alert_deliveries SET status=?,last_error=? WHERE id=? AND status=\'pending\'').run(row.status,row.last_error,row.id);
 }
 for(const item of data.tables.preference_confirmations){
  insert('preference_confirmations',item);
  if(item.status==='sent')db.prepare("UPDATE preference_confirmations SET status='sent',message_id=?,sent_at=?,last_error='' WHERE id=? AND status<>'sent'").run(item.message_id,item.sent_at,item.id);
 }
 for(const item of data.tables.scan_runs)insert('scan_runs',item);
 db.exec('COMMIT');
 console.log(JSON.stringify({reconciled:true,artists:db.prepare('SELECT COUNT(*) AS n FROM watch_artists').get().n,events:db.prepare('SELECT COUNT(*) AS n FROM show_events').get().n,receipts:db.prepare('SELECT COUNT(*) AS n FROM alert_receipts').get().n}));
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
