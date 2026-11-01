import {test} from 'node:test';
import {findingStatus} from '../../src/features/radar/sources.ts';
import assert from 'node:assert/strict';
import {canonicalCity,canonicalURL,eventIdentity,eventRevision,preferredEvent,suppressReason,groupAlerts,renderAlert,alertBatch,notificationIdentity,canonicalReceiptRevision} from '../../src/core/events.ts';
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
