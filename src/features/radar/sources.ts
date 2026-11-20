import catalog from "./catalog.json" with { type: "json" };
import {upcomingDate,webURL,type ShowEvent} from "../../core/bot.ts";
import {concertNewsStatus} from "../../core/concert-evidence.ts";
import {canonicalURL} from "../../core/events.ts";

export type RadarSource = {id:string;name:string;kind:string;countries:string[];url:string;feed?:string;profiles?:string[]};
export const OFFICIAL_SOURCES: RadarSource[] = catalog.official;
export const JOURNALISM_SOURCES: RadarSource[] = catalog.journalism;
export function sourcesForCountries(countries:string[]) {
  const relevant = (source:RadarSource) => source.countries.some(country=>countries.includes(country));
  return {official:OFFICIAL_SOURCES.filter(relevant),journalism:JOURNALISM_SOURCES.filter(relevant)};
}
export function officialURL(value:string, base?:string) {
  try {
    const url = new URL(value,base);
    if(url.protocol!=="https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.replace(/^www\./,"");
    if(!OFFICIAL_SOURCES.some(source=>{const domain=new URL(source.url).hostname.replace(/^www\./,"");return host===domain||host.endsWith("."+domain);})) return null;
    url.hash="";return url.href;
  } catch {return null;}
}
export function isJournalism(source:string,url:string) {
  if(/flesch|billboard|cooperativa|rolling stone|\bciudad\b|\bindy\b/i.test(source))return true;
  try { const parsed=new URL(url);return /(^|\.)(x\.com|twitter\.com|instagram\.com|youtube\.com|youtu\.be|billboard\.ar|billboard\.com|cooperativa\.cl|ciudad\.com\.ar|indy\.com\.ar)$/.test(parsed.hostname); }
  catch{return false;}
}

export function findingStatus(status:string,date:string,source:string,url:string){
  if(status==="reported"||date&&status==="listed"&&isJournalism(source,url))return "reported";
  return status==="listed"&&date?"listed":"unverified";
}
export type Finding={status:"listed"|"reported"|"unverified";title:string;url:string;date:string};
/** What the store keeps from one finding, or why it refuses it. The tip form applies the same rule to explain a refusal. */
export function screenFinding(event:ShowEvent,artist:string,today?:string):Finding|{refused:string}{
  // Cut to the stored length before classifying: the classifier rescans the title for every occurrence of the artist name.
  const title=String(event.title||"").slice(0,400);
  if(!title.trim())return {refused:"Informe um título."};
  let url:string;try{url=canonicalURL(webURL(event.url));}catch{return {refused:"Informe um link http:// ou https:// válido."};}
  if(url.length>2000)return {refused:"O link é longo demais."};
  const date=typeof event.startsAt==="string"?event.startsAt.slice(0,10):"";
  if(date&&!upcomingDate(date,today))return {refused:"A data é inválida ou já passou."};
  const source=String(event.source||""),status=findingStatus(event.status,date,source,url);
  if(status!=="unverified")return {status,title,url,date};
  const classification=concertNewsStatus(title,artist,event.country,source);
  return classification?{status:classification,title,url,date}:{refused:"O título precisa citar o artista e o país ou a cidade e dizer que ele pode ou vai se apresentar. Exemplo: “Foo Fighters pode fazer show no Brasil”."};
}
