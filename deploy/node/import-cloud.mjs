// Import an owner-private export while the target service is stopped.
import {readFileSync} from 'node:fs';
import {SQLiteBinding} from './database.mjs';
import path from 'node:path';
const [source,target]=process.argv.slice(2);
if(!source||!target)throw new Error('Usage: node import-cloud.mjs backup.json database.db');
const backup=JSON.parse(readFileSync(source,'utf8'));
if(backup.format!=='rockshowbot-web-sqlite-v1')throw new Error('Invalid backup format');
const allowed=['watch_artists','show_events','bot_settings','alert_receipts','alert_deliveries','preference_confirmations','scan_runs'];
const binding=new SQLiteBinding(target);binding.migrate(new URL('../../drizzle',import.meta.url).pathname);
const db=binding.connection;
if(db.prepare('SELECT COUNT(*) AS n FROM watch_artists').get().n)throw new Error('Destination already contains artists; refusing to overwrite it.');
db.exec('BEGIN IMMEDIATE');
try{
 for(const table of allowed){
  const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
  for(const row of backup.tables[table]||[]){
   const keys=Object.keys(row);if(keys.some(k=>!columns.has(k)))throw new Error('Unexpected columns in '+table);
   const values=keys.map(k=>row[k]);
   db.prepare(`INSERT INTO ${table} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...values);
  }
 }
 // Keep email disabled until the new provider is configured and the old sender is retired.
 db.prepare('UPDATE bot_settings SET notifications=0 WHERE id=1').run();
 if(db.prepare("SELECT name FROM sqlite_master WHERE name='node_accounts'").get())db.prepare("UPDATE node_accounts SET email=(SELECT email FROM bot_settings WHERE id=1) WHERE id='local-owner'").run();
 db.exec('COMMIT');
 console.log(JSON.stringify({database:path.basename(target),tables:Object.fromEntries(allowed.map(t=>[t,db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]))}));
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
