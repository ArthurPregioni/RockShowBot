import {test} from "node:test";
import assert from "node:assert/strict";
import {appleLibrary,appleConfiguration,publicApplePlaylist,publicPlaylistURL,parsePublicPlaylist,newsItems,discover,normalize} from "../lib/bot-core.ts";

const playlistHTML = `<script type="application/ld+json">{"@type":"MusicPlaylist","name":"Minha playlist","numTracks":2}</script><script type="application/json" id="serialized-server-data">${JSON.stringify({data:[{contentDescriptor:{kind:"song",identifiers:{storeAdamID:"track1"}},artistName:"Angra",subtitleLinks:[{title:"Angra",segue:{destination:{contentDescriptor:{kind:"artist",identifiers:{storeAdamID:"a"}}}}}]},{contentDescriptor:{kind:"song",identifiers:{storeAdamID:"track2"}},artistName:"Angra",subtitleLinks:[{title:"Angra",segue:{destination:{contentDescriptor:{kind:"artist",identifiers:{storeAdamID:"a"}}}}}]},{contentDescriptor:{kind:"playlist"},title:"Curador da playlist"}]})}</script>`;
test("Public Apple playlists import only track artists, deduplicate, and keep a source title",()=>{
  const result=parsePublicPlaylist(playlistHTML);assert.equal(result.name,"Minha playlist");assert.equal(result.visibleTracks,2);assert.deepEqual(result.candidates,[{id:"a",name:"Angra"}]);
  assert.throws(()=>parsePublicPlaylist('<html>Private playlist</html>'),/Não encontrei artistas/);
});
test("Playlist imports allow only Apple public playlist URLs and reject hostile redirects",async()=>{
  const url="https://music.apple.com/br/playlist/minha/pl.u-abc123";
  assert.equal(publicPlaylistURL(url+"?tracking=example"),url);
  for(const invalid of ["http://127.0.0.1/playlist/x/pl.u-abc","https://music.apple.com.untrusted.example/br/playlist/x/pl.u-abc","https://user:password@music.apple.com/br/playlist/x/pl.u-abc","https://music.apple.com/us/artist/a/123"]){assert.throws(()=>publicPlaylistURL(invalid));}
  await assert.rejects(()=>publicApplePlaylist(url,async()=>new Response(null,{status:302,headers:{location:"https://untrusted.example/steal"}})),/link de playlist/);
  const result=await publicApplePlaylist(url,async()=>new Response(playlistHTML));assert.equal(result.candidates[0].name,"Angra");
});

test("Apple library pagination reads candidates without disclosing tokens to another host",async()=>{
  const requests=[];
  const responses=[{data:[{id:"s",attributes:{name:"Sepultura"}}],next:"/v1/me/library/artists?offset=25"},{data:[{id:"a",attributes:{name:"Angra"}},{id:"s",attributes:{name:"Sepultura"}}]}];
  const transport=async(url,options)=>{requests.push([url.href,options]);return Response.json(responses.shift());};
  const artists=await appleLibrary("user-token","developer-token","https://shows.example",transport);
  assert.deepEqual(artists.map(a=>a.name),["Angra","Sepultura"]);
  assert.equal(requests.length,2);
  assert.equal(requests[0][1].headers["Music-User-Token"],"user-token");
  const hostile=async()=>Response.json({data:[],next:"https://untrusted.example/steal"});
  await assert.rejects(()=>appleLibrary("user-token","developer-token","https://shows.example",hostile),/paginação inválida/);
});
test("News remains unverified and publication date is never a concert date",()=>{
  const xml=`<rss><channel><item><title><![CDATA[Sepultura anuncia show no Brasil &amp; turnê]]></title><link>https://example.com/article</link><pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate><source url="https://example.com">Produtora</source></item><item><title>Outra banda anuncia show</title><link>https://example.com/other</link></item></channel></rss>`;
  const results=newsItems(xml,"Sepultura","BR");
  assert.equal(results.length,1);assert.equal(results[0].startsAt,"");assert.equal(results[0].status,"unverified");assert.equal(results[0].source,"Produtora");assert.ok(results[0].title.includes("& turnê"));
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
