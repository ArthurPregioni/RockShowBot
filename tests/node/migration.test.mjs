import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteBinding} from '../../deploy/node/database.mjs';
import {migrationDestination,migrationFreezePlan,migrationTables} from '../../src/core/migration.ts';
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
