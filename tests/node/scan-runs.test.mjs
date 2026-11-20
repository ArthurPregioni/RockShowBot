import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
// The Node build aliases cloudflare:workers to the local runtime and lets the bundler add file extensions; the test does the same.
const runtime=new URL('../../deploy/node/runtime.mjs',import.meta.url).href;
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:${JSON.stringify(runtime)},shortCircuit:true};try{return await next(specifier,context);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.'))return next(specifier+'.ts',context);throw error;}}`));
const directory=mkdtempSync(join(tmpdir(),'rockshowbot-runs-'));process.env.DATABASE_PATH=join(directory,'web.db');
const {localDatabase,runForOwner}=await import(runtime);
const {scan}=await import('../../src/server/bot.ts');
test('Scan history stays bounded and always keeps the latest run',async()=>{
 const binding=localDatabase('local-owner');binding.migrate(fileURLToPath(new URL('../../drizzle',import.meta.url)));
 try{
  const insert=binding.connection.prepare("INSERT INTO scan_runs(id,warnings) VALUES(?,'[]')");
  for(let run=0;run<600;run++)insert.run('old-'+run);
  // No artists are watched, so the scan records its run without contacting any source.
  assert.equal((await runForOwner('local-owner',()=>scan(0))).nextOffset,null);
  const rows=binding.connection.prepare('SELECT id FROM scan_runs ORDER BY rowid').all();
  assert.equal(rows.length,500);assert.equal(rows[0].id,'old-101');assert.ok(!rows.at(-1).id.startsWith('old-'));
 }finally{binding.connection.close();rmSync(directory,{recursive:true,force:true});}
});
