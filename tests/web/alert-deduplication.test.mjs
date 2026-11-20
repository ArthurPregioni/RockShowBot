import {test,after} from 'node:test';
import {findingStatus} from '../../src/features/radar/sources.ts';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalize} from '../../src/core/text.ts';
import {canonicalCity,canonicalURL,eventIdentity,eventRevision,preferredEvent,suppressReason,groupAlerts,renderAlert,alertBatch,notificationIdentity,sharedNotificationIdentity,receiptLapsed,canonicalReceiptRevision} from '../../src/core/events.ts';
const base={id:'a',artist:'Foo Fighters',title:'Foo Fighters no Brasil',country:'BR',city:'São Paulo',starts_at:'2027-02-20',url:'https://www.ticketmaster.com.br/event/foo',source:'Ticketmaster',status:'listed',notified:0};
test('Event identity ignores publisher, tracking parameters, accents and city/state formatting, but preserves distinct dates and countries',()=>{
 assert.equal(canonicalCity('São Paulo/SP','BR'),'sao paulo');assert.equal(canonicalCity('Santiago de Chile','CL'),'santiago');assert.equal(canonicalCity('CABA','AR'),'buenos aires');
 assert.equal(eventIdentity(base),eventIdentity({...base,source:'Another source',city:'Sao Paulo, Brasil',url:'https://another.example'}));
 assert.notEqual(eventIdentity(base),eventIdentity({...base,starts_at:'2027-02-21'}));assert.notEqual(eventIdentity(base),eventIdentity({...base,country:'AR'}));
 assert.equal(canonicalURL('https://www.ticketmaster.com.br/event/foo/?utm_source=news&inApp=true#here'),'https://ticketmaster.com.br/event/foo');
});
test('Multiple articles about one undated anticipation share a country/year identity',()=>{
 const rumor={...base,status:'unverified',starts_at:'',city:''};assert.equal(eventIdentity(rumor),eventIdentity({...rumor,title:'Pode haver uma turnê',url:'https://other.example'}));
 assert.notEqual(eventIdentity({...rumor,title:'Possível turnê 2028'}),eventIdentity({...rumor,title:'Possível turnê 2029'}));
});
test('A confirmation suppresses the matching rumor in the same country, preserving new years, dates and foreign shows',()=>{
 const rumor={...base,status:'unverified',starts_at:'',city:''};
 assert.match(suppressReason(rumor,[base],'2026-10-30'),/superada/);
 assert.equal(suppressReason({...rumor,country:'CL'},[base],'2026-10-30'),'');
 assert.equal(suppressReason({...rumor,title:'Turnê 2028'},[base],'2026-10-30'),'');
 assert.equal(suppressReason({...rumor,starts_at:'2027-02-21'},[base],'2026-10-30'),'');
 assert.match(suppressReason({...rumor,starts_at:'2027-02-20'},[base],'2026-10-30'),/superada/);
 assert.equal(suppressReason(rumor,[{...base,starts_at:'2026-09-01'}],'2026-10-30'),'');
});
test('Old publication dates retire stale anticipations without becoming performance dates',()=>{
 const rumor={...base,status:'unverified',starts_at:'',published_at:'2025-12-05T12:00:00Z'};assert.match(suppressReason(rumor,[],'2026-10-30'),/90 dias/);
 assert.equal(suppressReason({...rumor,status:'listed'},[],'2026-10-30'),'');
 assert.equal(suppressReason({...rumor,published_at:'2026-10-29T12:00:00Z'},[],'2026-10-30'),'');
});
test('Consolidation preserves confirmed evidence; promotion has a distinct notification revision',()=>{
 const rumor={...base,id:'r',status:'unverified',notified:1};assert.equal(preferredEvent([rumor,base]).id,'a');assert.notEqual(eventRevision(rumor),eventRevision(base));
 assert.equal(eventRevision(base),eventRevision({...base,title:'Different headline',source:'Different source'}));
});
test('One concert with several tracked bands is one digest line, while dates and confidence levels remain separate',()=>{
 const all=[base,{...base,id:'b',artist:'All Time Low'},{...base,id:'c',starts_at:'2027-02-21'},{...base,id:'d',artist:'Unconfirmed band',status:'unverified'}];
 const groups=groupAlerts(all);assert.equal(groups.length,3);assert.deepEqual(groups[0].artists,['Foo Fighters','All Time Low']);
 assert.throws(()=>renderAlert('mixed',all,'https://shows.example'),/Separe/);
 const message=renderAlert('unique-id',alertBatch(all),'https://shows.example');assert.equal(message.count,2);assert.equal(message.concerts,2);assert.equal(message.possibilities,0);assert.match(message.subject,/2 show/);assert.doesNotMatch(message.body,/NÃO CONFIRMADO/);assert.match(message.subject,/RSB-unique-id/);
});

test('Real Chile duplicates retain identity and receipt when both the city spelling and ticket URL change',()=>{
 for(const [artist,date,slug] of [['Motionless In White','2027-03-07','motionless-in-white'],['Simple Plan','2027-05-08','simple-plan-2027']]){
  const original={...base,artist,country:'CL',city:'Santiago',starts_at:date,url:'https://cdnp.puntoticket.com/'+slug};
  const changed={...original,city:'Santiago Centro',url:'https://puntoticket.com/evento/'+slug};
  assert.equal(eventIdentity(original),eventIdentity(changed));assert.equal(notificationIdentity(original),notificationIdentity(changed));
  assert.equal(canonicalReceiptRevision(eventRevision(original).replace('|santiago|','|santiago centro|')),eventRevision(changed));
 }
 assert.notEqual(canonicalCity('Santiago Centro','AR'),canonicalCity('Santiago','AR'));
 assert.notEqual(canonicalCity('Santiago','CL'),canonicalCity('Valparaiso','CL'));
});
test('A state suffix in any usual format is the same city, so a second source is not a second show',()=>{
 for(const city of ['Rio de Janeiro','Rio de Janeiro/RJ','Rio de Janeiro, RJ','Rio de Janeiro - RJ','Rio de Janeiro – RJ','Rio de Janeiro (RJ)'])assert.equal(canonicalCity(city,'BR'),'rio de janeiro',city);
 assert.equal(canonicalCity('Ji-Paraná','BR'),'ji parana');
 assert.equal(eventIdentity({...base,city:'Rio de Janeiro - RJ'}),eventIdentity({...base,city:'Rio de Janeiro'}));
 assert.equal(canonicalReceiptRevision('foo fighters|BR|2027-02-20|Rio de Janeiro - RJ|listed'),eventRevision({...base,city:'Rio de Janeiro'}));
});
test('Shows that only share a day and a provider-wide URL stay separate lines with separate receipts',()=>{
 const provider=(artist,id)=>({...base,id,artist,title:artist,city:'',starts_at:'2027-03-10',url:'https://www.predicthq.com/events',source:'PredictHQ'});
 const first=provider('Iron Maiden','1'),second=provider('Sepultura','2');
 assert.equal(groupAlerts([first,second]).length,2);assert.notEqual(sharedNotificationIdentity(first),sharedNotificationIdentity(second));
 assert.equal(renderAlert('separate',[first,second],'https://shows.example').count,2);
 // One listing naming both tracked acts is still a single line and a single shared receipt.
 const bill=[{...first,title:'Iron Maiden + Sepultura'},{...second,title:'Iron Maiden + Sepultura'}];
 assert.equal(groupAlerts(bill).length,1);assert.equal(sharedNotificationIdentity(bill[0]),sharedNotificationIdentity(bill[1]));
});
test('A rumor receipt lapses after 60 days for newer evidence; a dated show is never repeated',()=>{
 const now=Date.parse('2026-11-19T12:00:00Z'),rumor={event_key:'foo fighters|BR|possibility|',created_at:'2026-09-01 10:00:00'};
 assert.equal(receiptLapsed(rumor,'',now),true);
 assert.equal(receiptLapsed(rumor,'2026-11-10T08:00:00.000Z',now),true);
 assert.equal(receiptLapsed(rumor,'2026-08-20T08:00:00.000Z',now),false,'the publication already alerted must not alert again');
 assert.equal(receiptLapsed({...rumor,created_at:'2026-10-15 10:00:00'},'',now),false);
 assert.equal(receiptLapsed({...rumor,event_key:'foo fighters|BR|possibility|2027'},'',now),true);
 assert.equal(receiptLapsed({event_key:'foo fighters|BR|2027-02-20|sao paulo',created_at:'2025-01-01 10:00:00'},'',now),false);
});
test('Press announcements await primary evidence without entering rumor or concert emails',()=>{
 const reported={...base,id:'press',status:'reported'},rumor={...base,id:'rumor',status:'unverified',starts_at:''};
 assert.deepEqual(alertBatch([reported]),[]);assert.deepEqual(alertBatch([reported,rumor]),[rumor]);
 assert.deepEqual(alertBatch([reported,rumor,base]),[base]);assert.throws(()=>renderAlert('press',[reported],'https://shows.example'),/Separe/);
 const mail=renderAlert('rumor',[rumor],'https://shows.example');assert.equal(mail.concerts,0);assert.match(mail.subject,/não confirmada/);assert.doesNotMatch(mail.body,/SHOWS CONFIRMADOS/);
});

test('Announcements in Billboard and Cooperativa cannot be promoted to primary evidence by the input status',()=>{
 for(const [source,url] of [['Billboard Argentina','https://billboard.ar/shows/nonpalidece'],['Cooperativa','https://cooperativa.cl/noticias/shows']]){
  assert.equal(findingStatus('listed','2027-03-26',source,url),'reported');
  assert.equal(findingStatus('reported','2027-03-26',source,url),'reported');
  assert.equal(findingStatus('unverified','2027-03-26',source,url),'unverified');
 }
 assert.equal(findingStatus('reported','','Cooperativa','https://cooperativa.cl/noticias/qa'),'reported');
 assert.equal(findingStatus('listed','2027-03-26','PuntoTicket','https://puntoticket.com/evento/test'),'listed');
});

// The remaining tests run the store against SQLite, arranged like the Node build: cloudflare:workers is the local runtime and relative imports get their extension.
const runtime=new URL('../../deploy/node/runtime.mjs',import.meta.url).href;
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:${JSON.stringify(runtime)},shortCircuit:true};try{return await next(specifier,context);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.'))return next(specifier+'.ts',context);throw error;}}`));
const directory=mkdtempSync(join(tmpdir(),'rockshowbot-alerts-'));process.env.DATABASE_PATH=join(directory,'web.db');
const {localDatabase}=await import(runtime);
const {storeEvents,visibleEvents,reconcileEvents}=await import('../../src/features/events/store.ts');
const {pendingAlerts}=await import('../../src/features/events/deliveries.ts');
const binding=localDatabase();binding.migrate(fileURLToPath(new URL('../../drizzle',import.meta.url)));
after(()=>{binding.connection.close();rmSync(directory,{recursive:true,force:true});});
const rows=(query,...values)=>binding.connection.prepare(query).all(...values),run=(query,...values)=>binding.connection.prepare(query).run(...values);
function watchlist(...names){
 run('DELETE FROM watch_artists');
 return names.map((name,index)=>{const artist={name,normalized:normalize(name)};run('INSERT INTO watch_artists(id,name,normalized) VALUES(?,?,?)','artist-'+index,name,artist.normalized);return artist;});
}
function watching(...names){
 binding.connection.exec("DELETE FROM show_events;DELETE FROM alert_receipts;DELETE FROM alert_deliveries;DELETE FROM bot_settings");
 run("INSERT INTO bot_settings(id,email,notifications,countries,schedule) VALUES(1,'fan@example.test',1,?,'active')",JSON.stringify(['BR']));
 return watchlist(...names);
}
const listed={artist:'Metallica',title:'Metallica',country:'BR',city:'Rio de Janeiro',startsAt:'2099-05-01',url:'https://www.ticketmaster.com.br/event/m1',source:'Ticketmaster',status:'listed'};
test('A second source that writes the city with its state updates the stored show instead of adding one',async()=>{
 const watch=watching('Metallica');
 assert.equal(await storeEvents([listed],watch,['BR']),1);
 assert.equal(await storeEvents([{...listed,city:'Rio de Janeiro - RJ',url:'https://www.livenation.com.br/show/m1',source:'Live Nation Brasil'}],watch,['BR']),0);
 assert.equal(rows("SELECT count(*) total FROM show_events WHERE status='listed'")[0].total,1);
});
test('A refused tip is not stored, and a title of any length is refused quickly',async()=>{
 const watch=watching('Rush'),tip={artist:'Rush',title:'possível turnê no Brasil',country:'BR',city:'',startsAt:'',url:'https://example.com/tip',source:'Dica pessoal',status:'unverified'};
 const started=performance.now();
 assert.equal(await storeEvents([tip,{...tip,title:'x show brasil '+'rush '.repeat(190000)}],watch,['BR']),0);
 assert.ok(performance.now()-started<2000);assert.equal(rows('SELECT count(*) total FROM show_events')[0].total,0);
 assert.equal(await storeEvents([{...tip,title:'Rush pode fazer show no Brasil'}],watch,['BR']),1);
});
test('An artist added again under another spelling keeps its events',async()=>{
 const show={...listed,artist:"Guns N' Roses",title:"Guns N' Roses"};
 assert.equal(await storeEvents([show],watching("Guns N' Roses"),['BR']),1);
 const watch=watchlist('Guns N Roses');
 assert.equal((await visibleEvents(['BR'])).length,1);
 // Finding the show again adopts the current spelling and does not count as a new show.
 assert.equal(await storeEvents([{...show,artist:'Guns N Roses'}],watch,['BR']),0);
 assert.deepEqual(rows('SELECT artist FROM show_events').map(row=>row.artist),['Guns N Roses']);
 assert.equal((await pendingAlerts()).length,1);
});
test('A rumor alerts again after 60 days, and only for evidence published since its last alert',async()=>{
 const watch=watching('Foo Fighters'),days=count=>new Date(Date.now()-count*86400000).toISOString();
 const rumor=(title,publishedAt)=>({artist:'Foo Fighters',title,country:'BR',city:'',startsAt:'',url:'https://news.example/'+encodeURIComponent(title),source:'Jornal',status:'unverified',publishedAt});
 await storeEvents([rumor('Foo Fighters pode fazer show no Brasil',days(70))],watch,['BR']);
 const [first]=await pendingAlerts();assert.ok(first);
 // What acknowledging its e-mail records; the undated row itself is purged by the scan after 60 days.
 const receipt=age=>{run('DELETE FROM alert_receipts');run("INSERT INTO alert_receipts(id,event_key,revision,recipient,created_at) VALUES(?,?,?,?,datetime('now',?))",first.receiptId,first.key,first.revision,'fan@example.test',`-${age} day`);run('DELETE FROM show_events');};
 receipt(30);await storeEvents([rumor('Foo Fighters negocia shows no Brasil',days(1))],watch,['BR']);
 assert.deepEqual(await pendingAlerts(),[],'inside 60 days the receipt blocks any rumor about this artist and country');
 receipt(61);await storeEvents([rumor('Foo Fighters pode fazer show no Brasil',days(70))],watch,['BR']);
 assert.deepEqual(await pendingAlerts(),[],'the publication that already alerted is not news');
 assert.equal(rows('SELECT count(*) total FROM alert_receipts')[0].total,1);
 run('DELETE FROM show_events');await storeEvents([rumor('Foo Fighters negocia shows no Brasil',days(1))],watch,['BR']);
 assert.equal((await pendingAlerts()).length,1);
 // The lapsed receipt is gone, so the new alert can be claimed and will leave a fresh one.
 assert.equal(rows('SELECT count(*) total FROM alert_receipts')[0].total,0);
});
test('An archived row that still holds the new identity key of a show does not break reconciliation',async()=>{
 watching('Metallica');
 const insert='INSERT INTO show_events(id,artist,title,country,city,starts_at,url,source,status,identity_key) VALUES(?,?,?,?,?,?,?,?,?,?)';
 run(insert,'active','Metallica','Metallica','BR','Rio de Janeiro - RJ','2099-05-01','https://www.ticketmaster.com.br/event/m1','Ticketmaster','listed','metallica|BR|2099-05-01|rio de janeiro rj');
 run(insert,'archived','Metallica','Metallica nega show','BR','Rio de Janeiro','2099-05-01','https://news.example/denied','Jornal','irrelevant','metallica|BR|2099-05-01|rio de janeiro');
 await reconcileEvents();
 assert.deepEqual(rows('SELECT id,identity_key FROM show_events ORDER BY id').map(row=>row.id+' = '+row.identity_key),['active = metallica|BR|2099-05-01|rio de janeiro','archived = archived:archived']);
 assert.equal((await visibleEvents(['BR'])).length,1);
});
