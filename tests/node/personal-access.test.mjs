import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteBinding} from '../../deploy/node/database.mjs';
import {sessionStore,SESSION_SECONDS} from '../../deploy/node/session.mjs';
import {personalAccessConfig,personalCookie,personalOwner} from '../../deploy/node/personal-access.mjs';
import {loginThrottle,sourceBucket} from '../../deploy/node/login-throttle.mjs';
test('Owner-only shared access validates targets and cookie scope',()=>{
 const origin=new URL('https://app.qa.example.test');
 const config=personalAccessConfig(origin,{PERSONAL_ACCESS_DOMAIN:'qa.example.test',PERSONAL_ACCESS_TARGETS:'{"casahub":"https://casahub.qa.example.test/"}'});
 assert.equal(personalOwner({id:'local-owner',role:'admin'}),true);
 for(const account of [null,{id:'friend',role:'user'},{id:'helper',role:'admin'},{id:'local-owner',role:'user'}])assert.equal(personalOwner(account),false);
 for(const target of ['https://evil.example/','javascript:alert(1)','https://casahub.qa.example.test/path','https://user@casahub.qa.example.test/'])assert.throws(()=>personalAccessConfig(origin,{PERSONAL_ACCESS_DOMAIN:'qa.example.test',PERSONAL_ACCESS_TARGETS:JSON.stringify({casahub:target})}));
 assert.match(personalCookie(config,'opaque'),/Domain=qa.example.test; HttpOnly; Secure; SameSite=Lax; Max-Age=15552000/);
 assert.match(personalCookie(config,'',true),/Max-Age=0$/);
});
test('Sessions preserve old tokens, renew idle window and stop after revocation',()=>{
 const db=new SQLiteBinding(':memory:').connection;
 db.exec("CREATE TABLE node_sessions(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL,expires INTEGER NOT NULL); INSERT INTO node_sessions VALUES('legacy','old-owner',0)");
 const sessions=sessionStore(db),token=sessions.create('owner','Firefox/Linux');
 assert.equal(sessions.find(token),'owner');assert.equal(sessions.touch(token),false);assert.equal(SESSION_SECONDS,180*86400);
 db.prepare('UPDATE node_sessions SET expires=? WHERE username=?').run(Date.now()+86400000,'owner');
 assert.equal(sessions.touch(token),true);assert(db.prepare("SELECT expires FROM node_sessions WHERE username='owner'").get().expires>Date.now()+179*86400000);
 sessions.revoke(token);assert.equal(sessions.touch(token),false);assert.equal(sessions.find(token),undefined);db.close();
});
test('Failed logins back off persistently per source and username without account-wide lock',()=>{
 const db=new SQLiteBinding(':memory:').connection,limit=loginThrottle(db),ip='192.0.2.1';
 for(let n=0;n<3;n++)assert.equal(limit.failed(ip,'Owner'),0);
 assert.equal(limit.failed(ip,'owner'),2);assert.equal(limit.remaining('192.0.2.2','owner'),0);assert(loginThrottle(db).remaining(ip,'OWNER')>0);
 // Another account signing in from the same source must not clear the owner's failures.
 assert.equal(limit.remaining(ip,'guest'),0);limit.failed(ip,'guest');limit.success(ip,'guest');assert(limit.remaining(ip,'owner')>0);
 for(let n=0;n<20;n++)limit.failed(ip,'owner');assert(limit.remaining(ip,'owner')<=900);
 limit.success(ip,'owner');assert.equal(limit.remaining(ip,'owner'),0);
 assert.ok(db.prepare('SELECT source FROM node_login_failures').all().every(row=>!row.source.includes(ip)&&!row.source.includes('owner')));db.close();
});
test('One source cannot cycle usernames, and a whole IPv6 /64 is one source',()=>{
 const db=new SQLiteBinding(':memory:').connection,limit=loginThrottle(db),ip='198.51.100.7';
 for(let n=0;n<20;n++)assert.equal(limit.failed(ip,'name-'+n),0);
 assert.equal(limit.failed(ip,'name-20'),2);assert(limit.remaining(ip,'never-tried')>0);assert.equal(limit.remaining('198.51.100.8','never-tried'),0);
 for(let n=0;n<4;n++)limit.failed('2001:db8:1:2::'+n,'owner');
 assert(limit.remaining('2001:0DB8:0001:0002:ffff::1','owner')>0);assert.equal(limit.remaining('2001:db8:1:3::1','owner'),0);
 assert.equal(sourceBucket('203.0.113.9'),'203.0.113.9');assert.equal(sourceBucket('::ffff:127.0.0.1'),'127.0.0.1');
 assert.equal(sourceBucket('2001:db8::1'),'2001:db8:0:0::/64');assert.equal(sourceBucket('2001:db8:1:2:3:4:5:6'),sourceBucket('2001:db8:1:2::'));db.close();
});
