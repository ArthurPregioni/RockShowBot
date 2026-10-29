import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deezerArtists,deezerUserID,catalogArtists,spotifyArtists,spotifyAuthorization,spotifyExchange,musicProviders} from '../lib/music-providers.ts';

test('Deezer accepts profile IDs, rejects playlists and arbitrary URLs',()=>{
  assert.equal(deezerUserID('https://www.deezer.com/br/profile/2529'),'2529');
  assert.equal(deezerUserID('2529'),'2529');
  for(const input of ['https://evil.test/profile/2529','https://www.deezer.com/playlist/2529','https://deezer.com@evil.test/profile/2','https://www.deezer.com:999/profile/2','http://deezer.com/profile/2',null])assert.throws(()=>deezerUserID(input));
});
test('Deezer paginates favorite artists and deduplicates names without credentials',async()=>{
  const pages=[{data:[{id:1,name:'Angra'}],next:'https://api.deezer.com/user/2529/artists?index=100'},{data:[{id:2,name:'Sepultura'},{id:3,name:'ANGRA'}]}];
  const artists=await deezerArtists('2529',async(url,options)=>{
    assert.equal(url.pathname,'/user/2529/artists');assert.equal(options.headers,undefined);assert.equal(options.redirect,'manual');return Response.json(pages.shift());
  });
  assert.equal(artists.length,2);assert.ok(artists.some(a=>a.name==='Sepultura'));
  await assert.rejects(()=>deezerArtists('2',async()=>Response.json({error:{code:800}})),/privado/);
  await assert.rejects(()=>deezerArtists('2',async()=>Response.json({data:[],next:'https://evil.test/user/2/artists'})),/paginação/);
  await assert.rejects(()=>deezerArtists('2',async()=>Response.json({data:[],next:'https://api.deezer.com/user/2/artists?limit=100'})),/paginação/);
});
test('Apple catalog requests artists only and reports upstream errors',async()=>{
  const result=await catalogArtists('Angra','apple',async(url)=>{
    assert.equal(url.host,'itunes.apple.com');assert.equal(url.searchParams.get('entity'),'musicArtist');
    return Response.json({results:[{wrapperType:'artist',artistId:1,artistName:'Angra'},{wrapperType:'track',artistId:2,artistName:'Not an artist result'}]});
  });
  assert.deepEqual(result,[{id:'1',name:'Angra'}]);
  await assert.rejects(()=>catalogArtists('x','apple'),/2 a 100/);
  await assert.rejects(()=>catalogArtists('Angra','other'),/Escolha/);
  await assert.rejects(()=>catalogArtists('Angra','apple',async()=>new Response('',{status:429})),/limitou/);
});
test('Spotify OAuth uses PKCE and artist-only permission; credentials stay on trusted hosts',async()=>{
  const verifier='a'.repeat(64),uri='https://shows.test/api/music/spotify/callback';
  const url=new URL(await spotifyAuthorization('client',uri,'state-value',verifier));
  assert.equal(url.searchParams.get('scope'),'user-follow-read');assert.equal(url.searchParams.get('state'),'state-value');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const expected=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
  assert.equal(url.searchParams.get('code_challenge'),expected);assert.equal(url.searchParams.has('client_secret'),false);
  const token=await spotifyExchange('client',uri,'code',verifier,async(endpoint,options)=>{
    assert.equal(endpoint,'https://accounts.spotify.com/api/token');assert.equal(options.body.get('code_verifier'),verifier);assert.equal(options.redirect,'manual');return Response.json({access_token:'token'});
  });
  assert.equal(token,'token');
  const artists=await spotifyArtists(token,async(endpoint,options)=>{assert.equal(endpoint.pathname,'/v1/me/following');assert.equal(endpoint.searchParams.get('type'),'artist');assert.equal(options.headers.Authorization,'Bearer token');return Response.json({artists:{items:[{id:'1',name:'Angra'}],next:null}});});
  assert.deepEqual(artists,[{id:'1',name:'Angra'}]);
  await assert.rejects(()=>spotifyArtists('secret',async()=>Response.json({artists:{items:[],next:'https://evil.test/steal'}})),/paginação/);
});
test('Provider availability is independent and does not pretend YouTube Music is implemented',()=>{
  const providers=musicProviders(false);
  assert.equal(providers.find(p=>p.id==='apple').ready,false);
  assert.equal(providers.find(p=>p.id==='spotify').ready,false);
  assert.equal(providers.find(p=>p.id==='deezer').ready,true);
  assert.equal(providers.find(p=>p.id==='youtube').ready,false);
  assert.equal(musicProviders(false,'client').find(p=>p.id==='spotify').ready,true);
});
