import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteBinding} from '../../deploy/node/database.mjs';
import {passwordHash,verifyPassword,sessionStore,safeReturn} from '../../deploy/node/session.mjs';
test('SQLite adapter applies real migrations and rolls back an entire failed batch',async()=>{
 const db=new SQLiteBinding(':memory:');db.migrate(new URL('../../drizzle',import.meta.url).pathname);db.migrate(new URL('../../drizzle',import.meta.url).pathname);
 await db.prepare('INSERT INTO watch_artists(id,name,normalized) VALUES(?,?,?)').bind('one','Band','band').run();
 assert.equal((await db.prepare('SELECT * FROM watch_artists WHERE id=?').bind('one').first()).name,'Band');
 await assert.rejects(db.batch([db.prepare('DELETE FROM watch_artists'),db.prepare('INSERT INTO missing VALUES(1)')]));
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM watch_artists').first()).count,1);
 assert.equal((await db.prepare("SELECT value FROM json_each(?)").bind('["BR","CL"]').all()).results.length,2);
 db.connection.close();
});
test('Password verification, expiring sessions, logout and safe return paths',async()=>{
 const hash=await passwordHash('test-only-long-qa-password');assert.equal(await verifyPassword('test-only-long-qa-password',hash),true);assert.equal(await verifyPassword('wrong',hash),false);
 const db=new SQLiteBinding(':memory:'),sessions=sessionStore(db.connection),token=sessions.create('arthur');assert.equal(sessions.find(token),'arthur');assert.equal(sessions.find('forged'),undefined);sessions.revoke(token);assert.equal(sessions.find(token),undefined);
 const expired=sessions.create('arthur');db.connection.exec('UPDATE node_sessions SET expires=0');assert.equal(sessions.find(expired),undefined);
 assert.equal(safeReturn('https://evil.example'),'/');assert.equal(safeReturn('//evil.example'),'/');assert.equal(safeReturn('/music/browser-import?x=1'),'/music/browser-import?x=1');db.connection.close();
});
