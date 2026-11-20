import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteBinding} from '../../deploy/node/database.mjs';
import {accountStore,accountHTML,validEmail} from '../../deploy/node/accounts.mjs';
test('An account e-mail is exactly one mailbox',async()=>{
 for(const email of ['fan@example.test','first.last+tag@sub.example.test'])assert.equal(validEmail(email),true);
 for(const email of ['x,victim@example.test','a;b@example.test','a:b@example.test','"a"@example.test',"a'b@example.test",'<a@example.test>','a(b)@example.test','a\\b@example.test','a b@example.test','a@b@example.test','fan@localhost','','x'.repeat(250)+'@example.test',null,['fan@example.test']])assert.equal(validEmail(email),false);
 const db=new SQLiteBinding(':memory:').connection,accounts=accountStore(db);
 // Validation messages are marked for display; anything unmarked is answered generically by the server.
 await assert.rejects(accounts.create('guest','x,victim@example.test'),error=>error.expose===true&&/e-mail válido/.test(error.message));
 assert.equal((await accounts.create('guest','guest@example.test')).username,'guest');
 await assert.rejects(accounts.create('GUEST','other@example.test'),error=>error.expose===true&&/já existe/.test(error.message));db.close();
});
test('Account page renders without hub links when no personal target is configured',()=>{
 assert.ok(!accountHTML([],true,'',{}).includes('centrais pessoais'));assert.ok(!accountHTML([],true,'',null).includes('centrais pessoais'));
 assert.match(accountHTML([],true,'',{financas:'https://financas.qa.example.test/'}),/href="https:\/\/financas\.qa\.example\.test\/access"/);
});
