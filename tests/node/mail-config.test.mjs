import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {envLine,saveMailConfig} from '../../deploy/node/mail-config.mjs';
const SMTP=['SMTP_HOST','SMTP_PORT','SMTP_USERNAME','SMTP_PASSWORD','SMTP_FROM','SMTP_STARTTLS'];
test('Saved values are read back identically by the env loader',()=>{
 for(const value of ['plain','with space',' padded ','pa"ss',"pa'ss",'pa`ss','pa\\ss','a\\nb','#hash # x','a=b','$HOME','"Name" <bot@example.test>',`it's "x"`,''])assert.equal(parseEnv('BEFORE=1\n'+envLine('K',value)+'\nAFTER=2\n').K,value);
 assert.throws(()=>envLine('K','\'"`'),error=>error.expose===true);
});
test('SMTP settings survive a restart, replace a leftover temporary file and never send a stored credential elsewhere',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'rockshowbot-mail-')),config=join(directory,'node.env'),saved=Object.fromEntries([...SMTP,'ROCKSHOWBOT_ENV_FILE'].map(key=>[key,process.env[key]]));
 const form=fields=>new URLSearchParams({host:'smtp.example.test',port:'587',username:'bot@example.test',from:'"Rock Show" <bot@example.test>',...fields});
 const checks=[],validate=async(message,values)=>{checks.push({message,...values});return {authenticated:true};};
 try{
  for(const key of SMTP)delete process.env[key];
  process.env.ROCKSHOWBOT_ENV_FILE=config;writeFileSync(config,'APP_USER=admin\nSMTP_HOST=\nSMTP_PASSWORD=\n');writeFileSync(config+'.smtp-new','interrupted');
  await saveMailConfig(form({password:'pa\\ss "quoted" word'}),validate);
  assert.deepEqual({...parseEnv(readFileSync(config,'utf8'))},{APP_USER:'admin',SMTP_HOST:'smtp.example.test',SMTP_PASSWORD:'pa\\ss "quoted" word',SMTP_PORT:'587',SMTP_USERNAME:'bot@example.test',SMTP_FROM:'"Rock Show" <bot@example.test>',SMTP_STARTTLS:'true'});
  assert.equal(existsSync(config+'.smtp-new'),false);assert.deepEqual(checks[0].message,{validate:true});
  // Blank password: kept for the same server and user, required again for any other destination.
  await saveMailConfig(form({password:'',port:'465'}),validate);assert.equal(checks[1].SMTP_PASSWORD,'pa\\ss "quoted" word');assert.equal(parseEnv(readFileSync(config,'utf8')).SMTP_PORT,'465');
  for(const changed of [{host:'smtp.attacker.example'},{username:'other@example.test'}])await assert.rejects(saveMailConfig(form({password:'',...changed}),validate),error=>error.expose===true&&/credencial SMTP/.test(error.message));
  assert.equal(checks.length,2);assert.equal(parseEnv(readFileSync(config,'utf8')).SMTP_HOST,'smtp.example.test');
 }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(directory,{recursive:true,force:true});}
});
