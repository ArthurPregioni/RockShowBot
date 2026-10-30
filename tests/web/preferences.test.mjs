import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SOUTH_AMERICA,parsePreferences,confirmationMessage} from '../../src/core/preferences.ts';

test('South America preset covers its 12 countries without Central America or Mexico',()=>{
 assert.equal(SOUTH_AMERICA.length,12);
 assert.deepEqual(new Set(SOUTH_AMERICA),new Set(['AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE']));
 for(const code of ['MX','CR','PA','GT','DO'])assert.ok(!SOUTH_AMERICA.includes(code));
});
test('Preferences validate destinations and countries before persisting a confirmation',()=>{
 assert.deepEqual(parsePreferences({email:' fan@example.com ',notifications:true,countries:['br','AR','br']}),{email:'fan@example.com',notifications:true,countries:['BR','AR']});
 assert.throws(()=>parsePreferences({email:'header\ninjection@example.com',countries:['BR']}),/e-mail/);
 assert.throws(()=>parsePreferences({notifications:true,countries:['BR']}),/e-mail/);
 assert.throws(()=>parsePreferences({countries:[]}),/países/);
 assert.throws(()=>parsePreferences({countries:['BRA']}),/países/);
 assert.equal(parsePreferences({email:'fan@example.com',notifications:false,countries:['BR']}).notifications,false);
});
test('Confirmation summarizes the saved snapshot and uses its exact address and unique delivery marker',()=>{
 const message=confirmationMessage('unique-marker',{email:'fan@example.com',notifications:false,countries:['BR','GY','SR']},'https://shows.example');
 assert.equal(message.to,'fan@example.com');assert.ok(message.subject.includes('unique-marker'));
 assert.match(message.body,/desativados/);assert.match(message.body,/Guiana \(GY\)/);assert.match(message.body,/Suriname \(SR\)/);
 assert.ok(message.body.includes('https://shows.example'));assert.ok(message.body.includes('ID de confirmação: unique-marker'));
});
