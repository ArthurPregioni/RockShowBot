import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteBinding} from '../../deploy/node/database.mjs';
import {migrationDestination,migrationFreezePlan,migrationTables} from '../../src/core/migration.ts';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const setup=()=>{const db=new SQLiteBinding(':memory:');db.migrate(new URL('../../drizzle',import.meta.url).pathname);db.connection.prepare("INSERT INTO bot_settings(id,email,notifications,countries,schedule) VALUES(1,'owner@example.test',1,'[\"BR\"]','active')").run();return db;};
test('Cutover captures pre-migration preferences and freezes both old mail queues atomically',async()=>{
 const db=setup();
 db.connection.prepare("INSERT INTO alert_deliveries(id,recipient,batch_key,subject,body,snapshot) VALUES('pending','owner@example.test','batch','QA','frozen body','[]')").run();
 db.connection.prepare("INSERT INTO preference_confirmations(id,dedupe_key,email,snapshot) VALUES('confirmation','dedupe','owner@example.test','{}')").run();
 const result=await db.batch(migrationFreezePlan('https://new.example').map(c=>db.prepare(c.sql).bind(...c.values)));
 assert.equal(result[migrationTables.indexOf('bot_settings')].results[0].notifications,1);
 assert.equal((await db.prepare('SELECT * FROM bot_settings').first()).schedule,'migrated:https://new.example');
 assert.equal((await db.prepare('SELECT status FROM alert_deliveries').first()).status,'cancelled');
 assert.equal((await db.prepare('SELECT status FROM preference_confirmations').first()).status,'superseded');db.connection.close();
});
test('Claimed or uncertain sends prevent any cutover or cancellation',async()=>{
 for(const status of ['claimed','unknown']){
  const db=setup();db.connection.prepare("INSERT INTO alert_deliveries(id,recipient,batch_key,status,subject,body,snapshot) VALUES('active','owner@example.test','batch',?,'QA','body','[]')").run(status);
  await db.batch(migrationFreezePlan('https://new.example').map(c=>db.prepare(c.sql).bind(...c.values)));
  const preferences=await db.prepare('SELECT * FROM bot_settings').first();assert.equal(preferences.schedule,'active');assert.equal(preferences.notifications,1);
  assert.equal((await db.prepare('SELECT status FROM alert_deliveries').first()).status,status);db.connection.close();
 }
});
test('Cutover validates a plain HTTPS destination',()=>{
 assert.equal(migrationDestination('https://new.example/'),'https://new.example');
 for(const target of ['http://new.example','https://user:pass@new.example/','https://new.example/path'])assert.throws(()=>migrationDestination(target));
});
test('Final merge reconciles late receipts, cancels stale outboxes and remains idempotent',()=>{
 const directory=mkdtempSync(join(tmpdir(),'rockshowbot-merge-'));
 const filename=join(directory,'target.db'),source=join(directory,'frozen.json');
 const db=new SQLiteBinding(filename);db.migrate(new URL('../../drizzle',import.meta.url).pathname);
 try{
  db.connection.exec("INSERT INTO bot_settings(id,notifications) VALUES(1,0); CREATE TABLE node_sessions(token TEXT); INSERT INTO node_sessions VALUES('preserved');");
  const delivery=(id,status)=>({id,recipient:id+'@example.test',batch_key:id,status,subject:'QA',body:'body',snapshot:'[]',message_id:status==='sent'?'real-provider-id':'',sent_at:status==='sent'?'2026-11-04':null,last_error:''});
  for(const id of ['late','stale'])db.connection.prepare('INSERT INTO alert_deliveries(id,recipient,batch_key,subject,body,snapshot) VALUES(?,?,?,?,?,?)').run(id,id+'@example.test',id,'QA','body','[]');
  const tables=Object.fromEntries(migrationTables.map(table=>[table,[]]));
  tables.alert_deliveries=[delivery('late','sent'),delivery('stale','pending')];
  tables.alert_receipts=[{id:'receipt',event_key:'event',revision:'rev',recipient:'late@example.test',delivery_id:'late',message_id:'real-provider-id',kind:'delivery'}];
  writeFileSync(source,JSON.stringify({format:'rockshowbot-web-sqlite-v1',frozen:true,tables}));
  for(let attempt=0;attempt<2;attempt++){
   const result=spawnSync(process.execPath,[new URL('../../deploy/node/merge-cloud.mjs',import.meta.url).pathname,source,filename],{encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
  }
  assert.equal(db.connection.prepare("SELECT status FROM alert_deliveries WHERE id='late'").get().status,'sent');
  assert.equal(db.connection.prepare("SELECT status FROM alert_deliveries WHERE id='stale'").get().status,'cancelled');
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM alert_receipts').get().n,1);
  assert.equal(db.connection.prepare('SELECT notifications FROM bot_settings').get().notifications,0);
  assert.equal(db.connection.prepare('SELECT token FROM node_sessions').get().token,'preserved');
 }finally{db.connection.close();rmSync(directory,{recursive:true,force:true});}
});
