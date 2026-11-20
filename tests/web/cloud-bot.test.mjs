import {test} from "node:test";
import assert from "node:assert/strict";
import {appleLibrary,appleConfiguration,newsItems,discover,normalize,namesArtist} from "../../src/core/bot.ts";

test("Apple library pagination reads candidates without disclosing tokens to another host",async()=>{
  const requests=[];
  const responses=[{data:[{id:"s",attributes:{name:"Sepultura"}}],next:"/v1/me/library/artists?offset=25"},{data:[{id:"a",attributes:{name:"Angra"}},{id:"s",attributes:{name:"Sepultura"}}]}];
  const transport=async(url,options)=>{requests.push([url.href,options]);return Response.json(responses.shift());};
  const artists=await appleLibrary("user-token","developer-token","https://shows.example",transport);
  assert.deepEqual(artists.map(a=>a.name),["Angra","Sepultura"]);
  assert.equal(requests.length,2);
  assert.ok(requests.every(([url])=>new URL(url).pathname==="/v1/me/library/artists"));
  assert.equal(new URL(requests[1][0]).searchParams.get("offset"),"25");
  assert.equal(requests[0][1].headers["Music-User-Token"],"user-token");
  const hostile=async()=>Response.json({data:[],next:"https://untrusted.example/steal"});
  await assert.rejects(()=>appleLibrary("user-token","developer-token","https://shows.example",hostile),/paginação inválida/);
});
test("Press announcements stay reported and publication date is never a concert date",()=>{
  const xml=`<rss><channel><item><title><![CDATA[Sepultura anuncia show no Brasil &amp; turnê]]></title><link>https://example.com/article</link><pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate><source url="https://example.com">Produtora</source></item><item><title>Outra banda anuncia show</title><link>https://example.com/other</link></item></channel></rss>`;
  const results=newsItems(xml,"Sepultura","BR");
  assert.equal(results.length,1);assert.equal(results[0].startsAt,"");assert.equal(results[0].status,"reported");assert.equal(results[0].publishedAt,'2026-10-28T10:00:00.000Z');assert.equal(results[0].source,"Produtora");assert.ok(results[0].title.includes("& turnê"));
});
test("A failed news feed does not prevent finding a Ticketmaster event",async()=>{
  const transport=async(url)=>{
    if(String(url).includes("news.google"))return new Response("",{status:503});
    return Response.json({_embedded:{events:[{id:"one",name:"Sepultura Live",url:"https://tickets.example/one",dates:{start:{localDate:"2030-05-01"}},_embedded:{attractions:[{name:"Sepultura"}],venues:[{city:{name:"São Paulo"}}]}}]}});
  };
  const result=await discover("Sepultura","BR",{ticketmaster:"key"},transport);
  assert.equal(result.events.length,1);assert.equal(result.events[0].status,"listed");assert.equal(result.warnings.length,1);
});
test("Apple developer credentials must allow the current site and remain valid",()=>{
  const token=(origin,expiration)=>[btoa(JSON.stringify({alg:"ES256",kid:"KEYID12345"})),btoa(JSON.stringify({iss:"TEAMID1234",exp:expiration,origin:[origin]})),"fake-signature"].join(".");
  assert.equal(normalize("Ratos de Porão"),"ratos de porao");
  const valid=token("https://shows.example",Math.floor(Date.now()/1000)+3600);
  assert.equal(appleConfiguration(valid,"https://shows.example"),valid);
  assert.throws(()=>appleConfiguration(valid,"https://other.example"),/outro endereço/);
  assert.throws(()=>appleConfiguration(undefined,"https://shows.example"),/Falta a credencial/);
});

test("Upcoming calendar uses concert dates regardless of announcement age",async()=>{
  const requested=[];
  const events=[
    {name:'Sepultura tour',dates:{start:{localDate:'2030-05-01'}},published:'2020-01-01'},
    {name:'Sepultura old show',dates:{start:{localDate:'2020-01-01'}}},
    {name:'Sepultura canceled show',dates:{start:{localDate:'2030-06-01'},status:{code:'cancelled'}}},
    {name:'Sepultura postponed',dates:{start:{localDate:'2030-07-01'},status:{code:'postponed'}}},
    {name:'Sepultura TBD',dates:{start:{localDate:'2030-08-01',dateTBD:true}}},
    {name:'Sepultura bad date',dates:{start:{localDate:'2030-02-31'}}},
  ].map((e,i)=>({...e,id:String(i),url:'https://tickets.example/'+i,_embedded:{attractions:[{name:'Sepultura'}]}}));
  const result=await discover('Sepultura','BR',{ticketmaster:'key',predicthq:'key'},async(input)=>{
    const url=new URL(input);requested.push(url);
    if(url.host==='news.google.com')return new Response('<rss/>');
    if(url.host==='app.ticketmaster.com')return Response.json({_embedded:{events}});
    return Response.json({results:[{title:'Sepultura',state:'predicted',start:'2030-09-01'},{title:'Sepultura',state:'cancelled',start:'2030-09-02'},{title:'Sepultura',state:'active',start:'2030-09-03',published:'2020-01-01'}]});
  });
  assert.deepEqual(result.events.map(e=>e.startsAt),['2030-05-01','2030-09-03']);
  const tm=requested.find(url=>url.host==='app.ticketmaster.com'),phq=requested.find(url=>url.host==='api.predicthq.com');
  assert.ok(tm.searchParams.get('startDateTime'));assert.equal(tm.searchParams.has('publicVisibilityStartDateTime'),false);
  assert.equal(phq.searchParams.get('state'),'active');assert.ok(phq.searchParams.get('start.gte'));
});

test("A title bills the artist only as the act itself, never inside a longer name or a tribute",()=>{
  for(const [artist,title] of [["Queen","Queen Experience In Concert"],["Pink Floyd","Pink Floyd Tribute Night"],["Angra","Angra dos Reis Jazz Festival"],
    ["Rush","Rush Hour Party"],["Kiss","Kiss FM Festival"],["Rush","Big Time Rush - Worldwide Tour"],["Rush","Big Time Rush"],["Queen","Tributo ao Queen"],
    ["Queen","Queen - Tributo"],["Queen","Queen's Greatest Hits Night"],["Blink","Blink-182"],["Sepultura","Sepulturado"]])
    assert.equal(namesArtist(title,artist),false,title);
  for(const title of ["Sepultura","SEPULTURA!","Sepultura - Tour Name","Sepultura – Tour Name","Sepultura | São Paulo","Sepultura: live","Sepultura ao vivo",
    "Sepultura (SP)","Sepultura em Curitiba","Sepultura Tour 2027","Angra + Sepultura","Angra e Sepultura","Rock in Rio: Sepultura","The Sepultura"])
    assert.equal(namesArtist(title,"Sepultura"),true,title);
  assert.equal(namesArtist("Big Time Rush - Worldwide Tour","Big Time Rush"),true);
  assert.equal(namesArtist("Ratos de Porão ao vivo","ratos de porao"),true);
});
test("Provider titles without attraction data must bill the artist, and PredictHQ instants become the venue's day",async()=>{
  const names=["Queen Experience In Concert","Queen - Rhapsody Tour","Tributo ao Queen","Queen"];
  const result=await discover("Queen","BR",{ticketmaster:"key",predicthq:"key"},async(input)=>{
    const url=new URL(input);
    if(url.host==="news.google.com")return new Response("<rss/>");
    if(url.host==="app.ticketmaster.com")return Response.json({_embedded:{events:names.map((name,index)=>({name,url:"https://tickets.example/"+index,dates:{start:{localDate:"2030-05-0"+(index+1)}}}))}});
    return Response.json({results:[
      {title:"Queen Experience In Concert",state:"active",start:"2030-06-01T03:00:00Z",timezone:"America/Sao_Paulo"},
      {title:"Queen",state:"active",start:"2030-06-06T00:30:00Z",timezone:"America/Sao_Paulo"},
      {title:"Queen",state:"active",start:"2030-06-08T00:30:00Z",start_local:"2030-06-07T21:30:00"},
      {title:"Queen",state:"active",start:"2030-06-09T00:30:00Z",timezone:"Not/AZone"},
      {title:"Queen",state:"active",start:"2030-06-12"},
    ]});
  });
  assert.deepEqual(result.events.filter(event=>event.source==="Ticketmaster").map(event=>event.title),["Queen - Rhapsody Tour","Queen"]);
  // 00:30 UTC is 21:30 of the previous day in São Paulo: the same day Ticketmaster's localDate would carry.
  assert.deepEqual(result.events.filter(event=>event.source==="PredictHQ").map(event=>event.startsAt),["2030-06-05","2030-06-07","2030-06-09","2030-06-12"]);
});

test("Calendar validates real dates and preserves today's concerts around UTC midnight",async()=>{
  const {todayInBrazil,upcomingDate}=await import('../../src/core/bot.ts');
  assert.equal(todayInBrazil(new Date('2026-10-30T01:00:00Z')),'2026-10-29');
  assert.equal(upcomingDate('2026-10-29','2026-10-29'),true);
  assert.equal(upcomingDate('2026-10-28','2026-10-29'),false);
  assert.equal(upcomingDate('2027-02-29','2026-10-29'),false);
  assert.equal(upcomingDate('2028-02-29','2026-10-29'),true);
  assert.equal(upcomingDate('','2026-10-29'),false);
});
