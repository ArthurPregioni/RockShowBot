import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OFFICIAL_SOURCES,JOURNALISM_SOURCES,sourcesForCountries,officialURL,isJournalism} from '../../src/features/radar/sources.ts';
import {officialPage,collectSource,fleschItems,fleschPublicPage,sourceBatch} from '../../src/features/radar/discovery.ts';
const source=OFFICIAL_SOURCES.find(s=>s.id==='live-nation-br');
const url=source.url;
const event={"@type":"MusicEvent",name:'Sepultura live',startDate:'2030-05-01T20:00:00-03:00',performer:{name:'Sepultura'},location:{name:'Casa',address:{addressCountry:'BR',addressLocality:'São Paulo'}},url:'/show/sepultura',offers:{availability:'https://schema.org/SoldOut'}};
const html=(...values)=>values.map(value=>`<script type="application/ld+json">${JSON.stringify(value)}</script>`).join('');
const parse=(...values)=>officialPage(html(...values),url,source,['Sepultura'],['BR'],'2026-10-29').events;

test('Catalog has 22 distinct official organizations plus Flesch, with country filtering',()=>{
 assert.equal(OFFICIAL_SOURCES.length,22);assert.equal(new Set(OFFICIAL_SOURCES.map(s=>s.id)).size,22);
 assert.equal(new Set(OFFICIAL_SOURCES.map(s=>new URL(s.url).hostname)).size,22);
 assert.equal(JOURNALISM_SOURCES.length,1);assert.equal(JOURNALISM_SOURCES[0].name,'José Norberto Flesch');
 assert.ok(sourcesForCountries(['CL']).official.every(s=>s.countries.includes('CL')));
 assert.equal(sourcesForCountries(['CL']).journalism.length,0);
 assert.deepEqual(sourcesForCountries(['GY']),{official:[],journalism:[]});
 let offset=0,ids=[];do{const part=sourceBatch(['BR','AR','CL','CO','PE','UY','PY','EC','BO','VE'],offset);assert.ok(part.batch.length<=2);ids.push(...part.batch.map(s=>s.id));offset=part.nextOffset;}while(offset!==null);
 assert.equal(new Set(ids).size,23);
});
test('Nested JSON-LD reads a sold-out future concert despite an old publication date',()=>{
 const events=parse({'@graph':[{'@type':'WebPage',datePublished:'2020-01-01'},event]});
 assert.equal(events.length,1);assert.equal(events[0].status,'listed');assert.equal(events[0].startsAt,'2030-05-01');assert.equal(events[0].city,'São Paulo');assert.equal(events[0].url,new URL('/show/sepultura',url).href);
});
test('Rejects cancelled, postponed, past, invalid, multi-day and wrong-country performances',()=>{
 for(const changes of [
  {eventStatus:'https://schema.org/EventCancelled'}, {eventStatus:'EventPostponed'},
  {startDate:'2020-05-01'}, {startDate:'2030-02-31'}, {endDate:'2030-05-03'},
  {eventAttendanceMode:'https://schema.org/OnlineEventAttendanceMode'},
  {location:{address:{addressCountry:'CL'}}}, {location:{address:{addressLocality:'São Paulo'}}},
  {performer:{name:'Another band'}}, {url:'https://untrusted.example/sepultura'},
 ])assert.deepEqual(parse({...event,...changes}),[],JSON.stringify(changes));
 assert.equal(parse({...event,eventStatus:'EventRescheduled',location:{address:{addressCountry:{'@type':'Country',name:'Brasil'}}}}).length,1);
});
test('Malformed JSON does not discard independent events; title fallback matches whole artist names',()=>{
 const broken='<script type="application/ld+json">{invalid}</script>';
 assert.equal(officialPage(broken+html(event),url,source,['Sepultura'],['BR'],'2026-10-29').events.length,1);
 assert.equal(parse({...event,performer:undefined,name:'Sepulturado'}).length,0);
 assert.equal(officialPage(html({...event,performer:undefined,name:'Big Time Rush'}),url,source,['Rush'],['BR'],'2026-10-29').events.length,0);
 assert.equal(parse({...event,performer:undefined}).length,1);
});
test('Flesch public channel fallback handles current YouTube cards without confusing Rush and Big Time Rush',async()=>{
 const data={contents:[{lockupViewModel:{contentType:'LOCKUP_CONTENT_TYPE_VIDEO',contentId:'abcdefghijk',metadata:{lockupMetadataViewModel:{title:{content:'BIG TIME RUSH NO BRASIL!'}}}}},{videoRenderer:{videoId:'lmnopqrstuv',title:{runs:[{text:'IRON MAIDEN NO BRASIL!'}]}}}]};
 const page=`<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
 assert.deepEqual(fleschPublicPage(page,['Rush','Big Time Rush','Iron Maiden'],['BR']).map(e=>e.artist),['Big Time Rush','Iron Maiden']);
 let requests=0;
 const found=await collectSource(JOURNALISM_SOURCES[0],['Rush','Big Time Rush'],['BR'],async()=>++requests===1?new Response('',{status:404}):new Response(page));
 assert.equal(requests,2);assert.equal(found.events.length,1);assert.equal(found.events[0].artist,'Big Time Rush');assert.equal(found.events[0].status,'unverified');assert.equal(found.inspected.length,1);
 assert.match(found.warnings[0],/feed indisponível/);
});
test('Candidate links read image alt labels, deduplicate and block arbitrary destinations',()=>{
 const body=`<a href='/event/one'><img alt='Sepultura'></a><a href='/event/one'>Sepultura</a><a href='https://untrusted.example'>Sepultura</a><a href='http://127.0.0.1'>Sepultura</a><a href='https://www.livenation.com.br.evil.example'>Sepultura</a>`;
 const parsed=officialPage(body,url,source,['Sepultura'],['BR']);assert.equal(parsed.candidates.length,1);assert.equal(parsed.events.length,0);
 assert.equal(officialURL('https://user:secret@www.livenation.com.br/'),null);
 assert.equal(officialURL('https://www.livenation.com.br:8080/'),null);
 assert.equal(officialURL('https://www.livenation.com.br.evil.example/'),null);
});
test('Collector follows at most two details and keeps blocked-source warnings without fake events',async()=>{
 const requests=[];
 const found=await collectSource(source,['Sepultura'],['BR'],async input=>{
  requests.push(String(input));return new Response(requests.length===1?'<a href="/one">Sepultura</a><a href="/two">Sepultura</a><a href="/three">Sepultura</a>':html({...event,startDate:'2099-05-01'}));
 });
 assert.equal(requests.length,3);assert.equal(found.events.length,2);assert.equal(found.candidates.length,3);
 const denied=await collectSource(source,['Sepultura'],['BR'],async()=>new Response('',{status:403}));
 assert.equal(denied.events.length,0);assert.match(denied.warnings[0],/HTTP 403/);
 const challenge=await collectSource(source,['Sepultura'],['BR'],async()=>new Response('<title>Just a moment</title>'));
 assert.match(challenge.warnings[0],/proteção/);
});
test('Collector refuses redirects outside the catalog and respects a 2 MB page limit',async()=>{
 let requests=0;
 const result=await collectSource(source,['Sepultura'],['BR'],async()=>{requests++;return new Response('',{status:302,headers:{location:'http://169.254.169.254/'}});});
 assert.equal(requests,1);assert.match(result.warnings[0],/redirecionamento/);
 const huge=await collectSource(source,['Sepultura'],['BR'],async()=>new Response('small',{headers:{'content-length':'2000001'}}));assert.match(huge.warnings[0],/2 MB/);
});
test('Flesch feed is an unverified lead; publication dates and other countries never become Brazilian concerts',()=>{
 const entry=title=>`<entry><title>${title}</title><yt:videoId>abcdefghijk</yt:videoId><published>2026-10-29</published></entry>`;
 const feed='<feed>'+entry('SEPULTURA NO BRASIL!')+entry('Sepultura no Chile!')+entry('Outra banda no Brasil!')+'</feed>';
 const found=fleschItems(feed,['Sepultura'],['BR']);assert.equal(found.length,1);assert.equal(found[0].startsAt,'');assert.equal(found[0].status,'unverified');assert.equal(found[0].source,'José Norberto Flesch');
 assert.equal(fleschItems(feed,['Sepultura'],['CL']).length,0);
 assert.equal(isJournalism('José Norberto Flesch','https://example.com'),true);
 assert.equal(isJournalism('YouTube','https://www.youtube.com/watch?v=abcdefghijk'),true);
 assert.equal(isJournalism('Live Nation',url),false);
});
