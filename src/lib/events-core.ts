import {normalize,webURL,todayInBrazil,COUNTRY_NAMES} from "./bot-core.ts";

export type StoredEvent={id:string;artist:string;title:string;country:string;city:string;starts_at:string;url:string;source:string;status:string;notified:number;identity_key?:string;published_at?:string;suppress_reason?:string;created_at?:string};
export function canonicalCity(city:string,country:string){
  let value=normalize(city.split(/[,/|]/)[0]);
  const aliases:Record<string,string>={"santiago de chile":"santiago","cidade de buenos aires":"buenos aires","ciudad autonoma de buenos aires":"buenos aires",caba:"buenos aires","sao paulo sp":"sao paulo","buenos aires argentina":"buenos aires"};
  value=aliases[value]||value;
  const suffix=normalize(COUNTRY_NAMES[country]||"");if(suffix&&value.endsWith(" "+suffix))value=value.slice(0,-suffix.length).trim();
  return value;
}
export function canonicalURL(value:string){
  const url=new URL(webURL(value));url.hash="";url.hostname=url.hostname.replace(/^www\./,"");
  for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|inapp$|authuser$|ref$)/i.test(key))url.searchParams.delete(key);
  url.searchParams.sort();url.pathname=url.pathname.replace(/\/+$/,"")||"/";return url.href;
}
export function scopeYear(event:StoredEvent){
  if(event.starts_at)return event.starts_at.slice(0,4);
  const years=[...new Set(event.title.match(/\b20\d{2}\b/g)||[])];return years.length===1?years[0]:"";
}
export function eventIdentity(event:StoredEvent){
  return event.starts_at?[normalize(event.artist),event.country,event.starts_at,canonicalCity(event.city,event.country)].join("|"):[normalize(event.artist),event.country,"possibility",scopeYear(event)].join("|");
}
export function eventRevision(event:StoredEvent){return [eventIdentity(event),event.status==="listed"?"listed":"unverified"].join("|");}
export function notificationIdentity(event:StoredEvent){return event.starts_at?[event.country,event.starts_at,canonicalCity(event.city,event.country),canonicalURL(event.url),event.status].join("|"):eventRevision(event);}
export function suppressReason(event:StoredEvent,all:StoredEvent[],today=todayInBrazil()){
  if(event.status!=="unverified")return "";
  if(event.published_at&&/^\d{4}-\d{2}-\d{2}/.test(event.published_at)&&Date.parse(event.published_at)<Date.parse(today)-90*86400000)return "Antecipação publicada há mais de 90 dias; consultar a agenda oficial.";
  const year=scopeYear(event);
  const confirmed=all.some(other=>other.status==="listed"&&other.starts_at>=today&&normalize(other.artist)===normalize(event.artist)&&other.country===event.country&&
    (event.starts_at?other.starts_at===event.starts_at&&(!event.city||!other.city||canonicalCity(event.city,event.country)===canonicalCity(other.city,event.country)):!year||other.starts_at.startsWith(year+"-")));
  return confirmed?"Antecipação superada por show confirmado do artista neste país.":"";
}
export function preferredEvent(group:StoredEvent[]){return [...group].sort((a,b)=>(b.status==="listed"?1:0)-(a.status==="listed"?1:0)||b.notified-a.notified||(a.created_at||"").localeCompare(b.created_at||"")||a.id.localeCompare(b.id))[0];}
export type AlertGroup={key:string;artists:string[];date:string;country:string;city:string;title:string;url:string;source:string;status:string;eventIds:string[]};
export function groupAlerts(events:StoredEvent[]):AlertGroup[]{
  const groups=new Map<string,AlertGroup>();
  for(const event of events){
    // A shared event page on the SAME date/city joins tracked co-headliners; different dates remain separate shows.
    const key=event.starts_at?[event.country,event.starts_at,canonicalCity(event.city,event.country),canonicalURL(event.url),event.status].join("|"):eventIdentity(event);
    const old=groups.get(key);
    if(old){if(!old.artists.includes(event.artist))old.artists.push(event.artist);old.eventIds.push(event.id);if(event.status==="listed")old.status="listed";}
    else groups.set(key,{key,artists:[event.artist],date:event.starts_at,country:event.country,city:event.city,title:event.title,url:event.url,source:event.source,status:event.status,eventIds:[event.id]});
  }
  return [...groups.values()].sort((a,b)=>(a.status==="listed"?0:1)-(b.status==="listed"?0:1)||(a.date||"9999").localeCompare(b.date||"9999")||a.artists.join().localeCompare(b.artists.join()));
}
export function renderAlert(id:string,events:StoredEvent[],website:string){
  const groups=groupAlerts(events),listed=groups.filter(g=>g.status==="listed"),rumors=groups.filter(g=>g.status!=="listed");
  const lines=[`RockShowBot — ${listed.length} show(s) com data e ${rumors.length} possibilidade(s) nova(s).`,"","Somente informações ainda não notificadas. Datas diferentes do mesmo artista são shows distintos."];
  for(const [title,items] of [["SHOWS COM DATA — fonte oficial ou provedor de eventos",listed],["POSSIBILIDADES — NÃO VERIFICADO",rumors]] as const){
    if(!items.length)continue;lines.push("",title);
    for(const item of items){const date=item.date?item.date.split("-").reverse().join("/"):"sem data confirmada";lines.push(`- ${item.status==="listed"?"":"NÃO VERIFICADO — "}${date} — ${item.artists.join(" + ")} — ${item.city?item.city+" / ":""}${COUNTRY_NAMES[item.country]||item.country}`,`  ${item.source}: ${item.url}`);}
  }
  lines.push("",`Abrir o RockShowBot: ${website}`,`ID do resumo: ${id}`);
  return {subject:`RockShowBot: ${groups.length} novidade(s) [RSB-${id}]`,body:lines.join("\n"),count:groups.length,concerts:listed.length,possibilities:rumors.length};
}
