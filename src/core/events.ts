import {normalize,webURL,todayInBrazil,COUNTRY_NAMES} from "./bot.ts";
import {emailLayout,emailLink,htmlEscape} from './email.ts';

export type StoredEvent={id:string;artist:string;title:string;country:string;city:string;starts_at:string;url:string;source:string;status:string;notified:number;identity_key?:string;published_at?:string;suppress_reason?:string;created_at?:string};
export function canonicalCity(city:string,country:string){
  let value=normalize(city.split(/[,/|]/)[0]);
  const aliases:Record<string,string>={"santiago de chile":"santiago","cidade de buenos aires":"buenos aires","ciudad autonoma de buenos aires":"buenos aires",caba:"buenos aires","sao paulo sp":"sao paulo","buenos aires argentina":"buenos aires"};
  value=aliases[value]||value;
  if(country==="CL"&&value==="santiago centro")value="santiago";
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
export function eventRevision(event:StoredEvent){return [eventIdentity(event),event.status].join("|");}
export function notificationIdentity(event:StoredEvent){return eventRevision(event);}
// Keep the shared bill receipt as well as the source-independent artist/date receipt.
export function sharedNotificationIdentity(event:StoredEvent){return event.starts_at?[event.country,event.starts_at,canonicalCity(event.city,event.country),canonicalURL(event.url),event.status].join("|"):eventRevision(event);}
export function suppressReason(event:StoredEvent,all:StoredEvent[],today=todayInBrazil()){
  if(!["unverified","reported"].includes(event.status))return "";
  if(event.status==="unverified"&&event.published_at&&/^\d{4}-\d{2}-\d{2}/.test(event.published_at)&&Date.parse(event.published_at)<Date.parse(today)-90*86400000)return "Antecipação publicada há mais de 90 dias; consultar a agenda oficial.";
  const year=scopeYear(event);
  const confirmed=all.some(other=>other.status==="listed"&&other.starts_at>=today&&normalize(other.artist)===normalize(event.artist)&&other.country===event.country&&
    (event.starts_at?other.starts_at===event.starts_at&&(!event.city||!other.city||canonicalCity(event.city,event.country)===canonicalCity(other.city,event.country)):!year||other.starts_at.startsWith(year+"-")));
  return confirmed?"Antecipação superada por show confirmado do artista neste país.":"";
}
export function preferredEvent(group:StoredEvent[]){return [...group].sort((a,b)=>confidenceRank(b.status)-confidenceRank(a.status)||b.notified-a.notified||(a.created_at||"").localeCompare(b.created_at||"")||a.id.localeCompare(b.id))[0];}
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
export function confidenceRank(status:string){return status==="listed"?2:status==="reported"?1:0;}
export function alertBatch(events:StoredEvent[]){
  // Press announcements remain on the dashboard while we seek primary evidence.
  const listed=events.filter(event=>event.status==="listed");
  return listed.length?listed:events.filter(event=>event.status==="unverified");
}
export function canonicalReceiptRevision(revision:string){
  const parts=revision.split("|");
  if(parts.length===5&&/^\d{4}-\d{2}-\d{2}$/.test(parts[2]))parts[3]=canonicalCity(parts[3],parts[1]);
  return parts.join("|");
}
export function alertCounts(events:StoredEvent[]){
  const groups=groupAlerts(events);return {count:groups.length,concerts:groups.filter(g=>g.status==="listed").length,possibilities:groups.filter(g=>g.status==="unverified").length};
}
export function renderAlert(id:string,events:StoredEvent[],website:string){
  const statuses=new Set(events.map(event=>event.status));
  if(!events.length||statuses.size!==1||!['listed','unverified'].includes(events[0].status))throw new Error("Separe shows confirmados e rumores antes de preparar o e-mail.");
  const groups=groupAlerts(events),confirmed=events[0].status==="listed";
  const places=[...new Set(groups.map(item=>COUNTRY_NAMES[item.country]||item.country))].join(', '),artists=new Set(groups.flatMap(item=>item.artists)).size;
  const title=confirmed?`${groups.length} show(s) confirmado(s) no seu radar`:`${groups.length} possibilidade(s) não confirmada(s)`;
  const summary=`Novidades de ${artists} artista(s) em ${places}. ${confirmed?'Datas sustentadas por fonte oficial ou provedor de eventos.':'Antecipações de apresentações futuras; ainda não há confirmação oficial.'}`;
  const lines=[title,summary,'',confirmed?'SHOWS CONFIRMADOS':'Possíveis shows — sem confirmação oficial'];
  let content='';
  for(const item of groups.slice(0,5)){
    const date=item.date?item.date.split('-').reverse().join('/'):'sem data confirmada',location=[item.city,COUNTRY_NAMES[item.country]||item.country].filter(Boolean).join(' / '),headline=item.title.replace(/\s+-\s+[^-]+$/,'').slice(0,220);
    lines.push(`\n${date} — ${item.artists.join(' + ')} — ${location}`,`${confirmed?'':headline+' · '}Fonte: ${item.source}.`);
    content+=`<div style="border-top:1px solid #e5e6eb;padding:18px 0"><h2 style="font-size:18px;margin:0 0 8px">${htmlEscape(item.artists.join(' + '))}</h2><p style="margin:0 0 8px;color:#545867">${htmlEscape(date+' · '+location)}</p>${confirmed?'':`<p style="line-height:1.5;margin:8px 0">${htmlEscape(headline)}</p>`}<a href="${emailLink(item.url)}" style="color:#a02443;font-size:13px">Fonte: ${htmlEscape(item.source)}</a></div>`;
  }
  if(groups.length>5){const remaining=`Mais ${groups.length-5} novidade(s) disponíveis no painel.`;lines.push('',remaining);content+=`<p>${htmlEscape(remaining)}</p>`;}
  lines.push("",`Abrir o RockShowBot: ${website}`,`ID do resumo: ${id}`);
  return {subject:`RockShowBot: ${groups.length} ${confirmed?"show(s) confirmado(s)":"possibilidade(s) não confirmada(s)"} [RSB-${id}]`,body:lines.join("\n"),html:emailLayout(title,summary,content,website,'ID do resumo: '+id),...alertCounts(events)};
}
