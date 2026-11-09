import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteBinding} from '../../deploy/node/database.mjs';
import {sessionStore,SESSION_SECONDS} from '../../deploy/node/session.mjs';
import {personalAccessConfig,personalCookie,personalOwner} from '../../deploy/node/personal-access.mjs';
import {loginThrottle} from '../../deploy/node/login-throttle.mjs';
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
test('Failed logins back off persistently per source without account-wide lock',()=>{
 const db=new SQLiteBinding(':memory:').connection,limit=loginThrottle(db),ip='192.0.2.1';
 for(let n=0;n<3;n++)assert.equal(limit.failed(ip),0);
 assert.equal(limit.failed(ip),2);assert.equal(limit.remaining('192.0.2.2'),0);assert(loginThrottle(db).remaining(ip)>0);
 for(let n=0;n<20;n++)limit.failed(ip);assert(limit.remaining(ip)<=900);
 limit.success(ip);assert.equal(limit.remaining(ip),0);
 assert.notEqual(db.prepare('SELECT source FROM node_login_failures').get()?.source,ip);db.close();
});
