import { normalize, type Candidate } from "../../core/bot.ts";

type Transport = typeof fetch;
type MusicPayload = {
  error?:unknown; data?:unknown[]; next?:string;
  results?:{wrapperType?:string;artistId?:string|number;artistName?:string}[];
  artists?:{items?:unknown[];next?:string};
};
export type MusicProvider = {id:string;name:string;mode:"oauth"|"public"|"browser"|"unavailable";ready:boolean;oauthReady?:boolean;description:string};
export function musicProviders(appleReady:boolean, spotifyClientID?:string):MusicProvider[] {
  return [
    {id:"apple",name:"Apple Music",mode:"browser",ready:true,oauthReady:appleReady,description:"Importe artistas da biblioteca aberta no navegador usando a extensão RockShowBot. Não requer uma conta Apple Developer. Você confirma a seleção antes de salvar."},
    {id:"spotify",name:"Spotify",mode:"browser",ready:true,oauthReady:!!spotifyClientID,description:"Importe os artistas da seção Sua Biblioteca pelo navegador usando a extensão RockShowBot. Não exige cadastrar um aplicativo Spotify."},
    {id:"deezer",name:"Deezer",mode:"public",ready:true,description:"Importe os artistas favoritos de um perfil público pelo link ou ID. Não acessa biblioteca privada nem faz login."},
    {id:"youtube",name:"YouTube Music",mode:"unavailable",ready:false,description:"Importação da biblioteca de artistas ainda não implementada. A API oficial de inscrições do YouTube retorna canais e não representa essa biblioteca."},
  ];
}
export function deezerUserID(value:unknown):string {
  if(typeof value!=="string")throw new Error("Informe o link ou ID numérico do perfil Deezer.");
  const text=value.trim();
  if(/^\d{1,20}$/.test(text))return text;
  try {
    const url=new URL(text);
    const match=url.pathname.match(/^\/(?:[a-z]{2}\/)?profile\/(\d{1,20})\/?$/);
    if(url.protocol==="https:"&&["deezer.com","www.deezer.com"].includes(url.hostname)&&!url.username&&!url.password&&!url.port&&match)return match[1];
  }catch{}
  throw new Error("Use um link como https://www.deezer.com/br/profile/123 ou o ID numérico do perfil. Links de playlists não são aceitos.");
}
function candidates(items:unknown[]):Candidate[] {
  const found=new Map<string,Candidate>();
  for(const value of items){const item=value as {id?:unknown;name?:unknown}|null;if(item?.id&&typeof item.name==="string"&&item.name.trim()&&item.name.length<=160)found.set(normalize(item.name),{id:String(item.id),name:item.name.trim()});}
  return [...found.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
async function read(url:URL,transport:Transport,headers?:Record<string,string>) {
  const response=await transport(url,{headers,redirect:"manual",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(response.status===429?"O serviço limitou as consultas. Aguarde e tente novamente.":"Não foi possível consultar o serviço de música. Tente novamente.");
  return await response.json() as MusicPayload;
}
export async function deezerArtists(profile:unknown,transport:Transport=fetch):Promise<Candidate[]> {
  const id=deezerUserID(profile),items:unknown[]=[];
  let next:URL|null=new URL(`https://api.deezer.com/user/${id}/artists?limit=100`);
  const seen=new Set<string>();
  while(next){
    if(next.origin!=="https://api.deezer.com"||next.pathname!==`/user/${id}/artists`||seen.has(next.href)||seen.size>=40)throw new Error("O Deezer retornou paginação inválida ou uma lista grande demais.");
    seen.add(next.href);
    const payload=await read(next,transport);
    if(payload.error||!Array.isArray(payload.data))throw new Error("Perfil Deezer inexistente, privado ou indisponível. Confira o link e a visibilidade dos artistas favoritos.");
    items.push(...payload.data);next=payload.next?new URL(payload.next):null;
  }
  return candidates(items);
}
export async function catalogArtists(query:unknown,provider:unknown,transport:Transport=fetch):Promise<Candidate[]> {
  if(typeof query!=="string"||query.trim().length<2||query.length>100)throw new Error("Digite de 2 a 100 caracteres para buscar artistas.");
  if(provider==="apple"){
    const url=new URL("https://itunes.apple.com/search");url.search=new URLSearchParams({term:query.trim(),entity:"musicArtist",media:"music",country:"BR",limit:"25"}).toString();
    const payload=await read(url,transport);
    if(!Array.isArray(payload.results))throw new Error("O catálogo Apple não respondeu como esperado.");
    return candidates(payload.results.filter((a)=>a.wrapperType==="artist").map((a)=>({id:a.artistId,name:a.artistName})));
  }
  if(provider!=="deezer")throw new Error("Escolha o catálogo Apple ou Deezer.");
  const url=new URL("https://api.deezer.com/search/artist");url.search=new URLSearchParams({q:query.trim(),limit:"25"}).toString();
  const payload=await read(url,transport);
  if(payload.error||!Array.isArray(payload.data))throw new Error("O catálogo Deezer está indisponível.");
  return candidates(payload.data);
}
export async function spotifyArtists(token:string,transport:Transport=fetch):Promise<Candidate[]> {
  let next:URL|null=new URL("https://api.spotify.com/v1/me/following?type=artist&limit=50");
  const items:unknown[]=[],seen=new Set<string>();
  while(next){
    if(next.origin!=="https://api.spotify.com"||next.pathname!=="/v1/me/following"||seen.has(next.href)||seen.size>=40)throw new Error("O Spotify retornou paginação inválida ou uma lista grande demais.");
    seen.add(next.href);
    const payload=await read(next,transport,{Authorization:`Bearer ${token}`});
    if(!Array.isArray(payload.artists?.items))throw new Error("O Spotify não retornou sua lista de artistas. Verifique a permissão user-follow-read.");
    items.push(...payload.artists.items);next=payload.artists.next?new URL(payload.artists.next):null;
  }
  return candidates(items);
}
export async function spotifyAuthorization(clientID:string,redirectURI:string,state:string,verifier:string) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  const url=new URL("https://accounts.spotify.com/authorize");
  url.search=new URLSearchParams({client_id:clientID,response_type:"code",redirect_uri:redirectURI,scope:"user-follow-read",state,code_challenge_method:"S256",code_challenge:challenge}).toString();
  return url.href;
}
export async function spotifyExchange(clientID:string,redirectURI:string,code:string,verifier:string,transport:Transport=fetch) {
  const response=await transport("https://accounts.spotify.com/api/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientID,grant_type:"authorization_code",code,redirect_uri:redirectURI,code_verifier:verifier}),signal:AbortSignal.timeout(15000),redirect:"manual"});
  if(!response.ok)throw new Error("O Spotify recusou a autorização. Confira o aplicativo, os usuários permitidos e a URL de retorno.");
  const payload=await response.json() as {access_token?:unknown};
  if(typeof payload.access_token!=="string"||!payload.access_token)throw new Error("O Spotify não retornou uma autorização válida.");
  return payload.access_token as string;
}

export function browserArtists(provider:unknown,items:unknown):Candidate[] {
  if(provider!=="apple"&&provider!=="spotify")throw new Error("Origem da biblioteca inválida. Use a extensão no Apple Music ou Spotify.");
  if(!Array.isArray(items)||!items.length||items.length>4000)throw new Error("Envie de 1 a 4000 artistas da biblioteca.");
  for(const artist of items)if(!artist||typeof artist.name!=="string"||!normalize(artist.name)||artist.name.length>160)throw new Error("A extensão retornou um nome de artista inválido. Faça a leitura novamente.");
  return candidates(items.map(artist=>({id:normalize(artist.name),name:artist.name})));
}
