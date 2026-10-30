import {normalize,upcomingDate,COUNTRY_NAMES,type ShowEvent} from "../../core/bot.ts";
import {officialURL,sourcesForCountries,type RadarSource} from "./sources.ts";

const array = <T,>(value:T|T[]|null|undefined):T[] => value==null?[]:Array.isArray(value)?value:[value];
const record = (value:unknown):Record<string,unknown> => value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
function text(value:string) {
  return value.replace(/<[^>]*>/g," ").replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([\da-f]+));/gi,(match,decimal,hex)=>{
    if(decimal||hex){const code=parseInt(decimal||hex,decimal?10:16);return code<=0x10ffff?String.fromCodePoint(code):"";}
    return ({"&amp;":"&","&quot;":'"',"&apos;":"'","&lt;":"<","&gt;":">"} as Record<string,string>)[match.toLowerCase()]||"";
  }).replace(/\s+/g," ").trim();
}
function matches(value:string,artist:string) {return (` ${normalize(value)} `).includes(` ${normalize(artist)} `);}
function countryCode(value:unknown) {
  const name=String(typeof value==="string"?value:record(value).name||record(value).identifier||"");
  const aliases:Record<string,string>={brazil:"BR",bolivia:"BO",colombia:"CO",ecuador:"EC",peru:"PE",paraguay:"PY",uruguay:"UY",venezuela:"VE",guyana:"GY",suriname:"SR"};
  return /^[A-Z]{2}$/.test(name)?name:aliases[normalize(name)]||Object.entries(COUNTRY_NAMES).find(([,label])=>normalize(label)===normalize(name))?.[0]||"";
}
export type SourcePage = {events:ShowEvent[];candidates:{artist:string;url:string;title:string}[]};
export function officialPage(html:string,pageURL:string,source:RadarSource,artists:string[],countries:string[],today?:string):SourcePage {
  const events:ShowEvent[]=[],candidates:SourcePage["candidates"]=[];
  const objects:Record<string,unknown>[]=[];
  function walk(input:unknown,depth=0) {
    if(!input||typeof input!=="object"||depth>16||objects.length>=1000)return;
    const value=record(input);
    if(Array.isArray(input)){input.forEach(item=>walk(item,depth+1));return;}
    if(array(value["@type"]).some(type=>/^(?:https?:\/\/schema.org\/)?(?:MusicEvent|Event|Festival)$/.test(String(type))))objects.push(value);
    for(const nested of Object.values(value))if(typeof nested==="object")walk(nested,depth+1);
  }
  for(const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{walk(JSON.parse(script[1]));}catch{/* A malformed block must not discard valid independent blocks. */}
  }
  for(const event of objects) {
    if(typeof event.name!=="string"||typeof event.startDate!=="string"||!upcomingDate(event.startDate,today))continue;
    if(event.eventStatus&&!/\/(EventScheduled|EventRescheduled)$/.test(String(event.eventStatus))&&!["EventScheduled","EventRescheduled"].includes(String(event.eventStatus)))continue;
    if(String(event.eventAttendanceMode||"").includes("OnlineEventAttendanceMode"))continue;
    // Festival ranges do not establish the artist's performance date.
    if(event.endDate&&String(event.endDate).slice(0,10)!==event.startDate.slice(0,10))continue;
    const places=array(event.location).map(record).filter(place=>place.address);
    for(const place of places) {
      const country=countryCode(record(place.address).addressCountry);
      if(!countries.includes(country)||!source.countries.includes(country))continue;
      const url=officialURL(String(event.url||event["@id"]||pageURL),pageURL);
      if(!url)continue;
      const performers=array(event.performer||event.performers).map(item=>typeof item==="string"?item:String(record(item).name||""));
      for(const artist of artists) {
        if(performers.length?!performers.some(name=>normalize(name)===normalize(artist)):!(normalize(event.name)===normalize(artist)||normalize(event.name).startsWith(normalize(artist)+" ")))continue;
        events.push({artist,title:text(event.name),country,city:String(record(place.address).addressLocality||""),startsAt:event.startDate.slice(0,10),url,source:source.name,status:"listed"});
      }
    }
  }
  for(const link of html.matchAll(/<a\b([^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const url=officialURL(text(link[2]),pageURL);
    if(!url||url===pageURL||/\.(?:jpg|jpeg|png|webp|svg|pdf|zip)(?:\?|$)/i.test(url))continue;
    const attrs=[...link[0].matchAll(/\b(?:alt|title|aria-label)\s*=\s*["']([^"']+)["']/gi)].map(item=>item[1]).join(" ");
    const title=text(link[3]+" "+attrs);
    for(const artist of artists)if(matches(title,artist)&&!candidates.some(item=>item.artist===artist&&item.url===url))candidates.push({artist,url,title:title.slice(0,400)});
    if(candidates.length>=100)break;
  }
  return {events,candidates};
}
export function fleschItems(xml:string,artists:string[],countries:string[]):ShowEvent[] {
  if(!countries.includes("BR"))return [];
  const found:ShowEvent[]=[];
  for(const entry of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const title=text((entry[1].match(/<title>([\s\S]*?)<\/title>/)||[])[1]||"");
    const id=(entry[1].match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)||[])[1];
    if(!id||!/(?:^| )(?:brasil|brazil)(?: |$)/.test(normalize(title)))continue;
    const publication=(entry[1].match(/<published>([^<]+)<\/published>/)||[])[1]||"";
    if(publication&&!Number.isNaN(Date.parse(publication))&&Date.parse(publication)<Date.now()-90*86400000)continue;
    // Titles may simply say "ARTIST NO BRASIL"; no concert keyword is required.
    const subject=normalize(title).split(/\b(?:no|ao|vem ao|volta ao) (?:brasil|brazil)\b/)[0].trim();
    for(const artist of artists)if(subject===normalize(artist))found.push({artist,title,country:"BR",city:"",startsAt:"",url:"https://www.youtube.com/watch?v="+id,source:"José Norberto Flesch",...(publication?{publishedAt:publication}:{}),status:"unverified"});
  }
  return found;
}
export function fleschPublicPage(html:string,artists:string[],countries:string[]):ShowEvent[] {
  const script=html.match(/(?:var\s+)?ytInitialData\s*=\s*(\{[^\n]*?\});?\s*<\/script>/)?.[1];
  if(!script)return [];
  const entries:string[]=[];let visited=0;
  function walk(input:unknown,depth=0) {
    if(!input||typeof input!=="object"||depth>25||visited++>20000)return;
    const value=record(input);
    if(Array.isArray(input)){input.forEach(item=>walk(item,depth+1));return;}
    const id=value.videoId||((value.contentType==="LOCKUP_CONTENT_TYPE_VIDEO")?value.contentId:"");
    const titleData=record(value.title),metadata=record(record(value.metadata).lockupMetadataViewModel);
    const title=array(titleData.runs).map(run=>String(record(run).text||"")).join("")||titleData.simpleText||record(metadata.title).content;
    const age=normalize(String(record(value.publishedTimeText).simpleText||JSON.stringify(metadata.metadata||"")));
    const stale=/(?:[1-9]\d* )?(?:years? ago|anos? atras)/.test(age)||/(?:[4-9]|\d{2,}) (?:months? ago|meses? atras)/.test(age)||/ha (?:[1-9]\d* )?anos?/.test(age)||/ha (?:[4-9]|\d{2,}) meses?/.test(age);
    if(!stale&&typeof id==="string"&&/^[\w-]{11}$/.test(id)&&typeof title==="string")entries.push(`<entry><title>${title.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</title><yt:videoId>${id}</yt:videoId></entry>`);
    for(const nested of Object.values(value))if(typeof nested==="object")walk(nested,depth+1);
  }
  try{walk(JSON.parse(script));}catch{return [];}
  const found=fleschItems(entries.join(""),artists,countries);
  return found.filter((event,index)=>found.findIndex(other=>other.artist===event.artist&&other.url===event.url)===index);
}
async function readPage(url:string,transport:typeof fetch) {
  let current=url;
  for(let redirects=0;redirects<=3;redirects++) {
    const response=await transport(current,{redirect:"manual",headers:{Accept:"text/html,application/xhtml+xml,application/atom+xml","User-Agent":"RockShowBot/1.0 (public concert calendar)"},signal:AbortSignal.timeout(10000)});
    if([301,302,303,307,308].includes(response.status)) {
      const next=officialURL(response.headers.get("location")||"",current);
      const youtubeRedirect=new URL(current).hostname==="www.youtube.com"&&(()=>{try{const target=new URL(response.headers.get("location")||"",current);return target.origin==="https://www.youtube.com"&&!target.username&&!target.password?target.href:null;}catch{return null;}})();
      if(!next&&!youtubeRedirect)throw new Error("redirecionamento fora das fontes oficiais");current=next||youtubeRedirect as string;continue;
    }
    if(!response.ok)throw new Error("HTTP "+response.status);
    if(Number(response.headers.get("content-length"))>2000000)throw new Error("página maior que 2 MB");
    const reader=response.body?.getReader();if(!reader)return {html:"",url:current};
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2000000)throw new Error("página maior que 2 MB");chunks.push(part.value);}}
    finally{await reader.cancel();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const html=new TextDecoder().decode(bytes);
    if(/(?:just a moment|verify you are human|access denied|disculpa, detectamos actividad sospechosa)/i.test(html.slice(0,20000)))throw new Error("proteção contra consultas automáticas");
    return {html,url:current};
  }
  throw new Error("redirecionamentos em excesso");
}
export async function collectSource(source:RadarSource,artists:string[],countries:string[],transport:typeof fetch=fetch) {
  const events:ShowEvent[]=[],candidates:SourcePage["candidates"]=[],warnings:string[]=[];
  const inspected:string[]=[];
  try {
    let page;
    try{page=await readPage(source.feed||source.url,transport);}
    catch(error){
      if(source.kind!=="journalist"||!source.feed)throw error;
      warnings.push(`${source.name}: feed indisponível (${(error as Error).message}); tentando página pública do canal.`);
      page=await readPage(source.url+"/videos",transport);
    }
    inspected.push(page.url);
    if(source.kind==="journalist")events.push(...(page.url.includes("/feeds/")?fleschItems(page.html,artists,countries):fleschPublicPage(page.html,artists,countries)));
    else {
      const result=officialPage(page.html,page.url,source,artists,countries);events.push(...result.events);candidates.push(...result.candidates);
      // Bounded requests: two event detail pages per source; the cloud research follows the rest.
      for(const url of [...new Set(candidates.map(item=>item.url))].slice(0,2)) {
        try{const detail=await readPage(url,transport);inspected.push(detail.url);events.push(...officialPage(detail.html,detail.url,source,artists,countries).events);}
        catch(error){warnings.push(`${source.name}: ${url} — ${(error as Error).message}.`);}
      }
    }
  }catch(error){warnings.push(`${source.name}: ${(error as Error).message}. Complementar pela pesquisa pública.`);}
  return {source:source.id,name:source.name,events,candidates,inspected,warnings,coverage:source.kind==="journalist"?"recent public feed or public channel page; partial coverage":"structured data and up to two detail pages; cloud research required for completeness"};
}
export function sourceBatch(countries:string[],offset:number) {
  const relevant=sourcesForCountries(countries),sources=[...relevant.official,...relevant.journalism];
  return {batch:sources.slice(offset,offset+2),total:sources.length,nextOffset:offset+2<sources.length?offset+2:null};
}
