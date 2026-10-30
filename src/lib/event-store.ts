import {database,UserError} from "./database.ts";
import {normalize,digest,webURL,upcomingDate,todayInBrazil,type ShowEvent} from "./bot-core.ts";
import {isJournalism} from "./radar-sources.ts";
import {canonicalCity,canonicalURL,eventIdentity,preferredEvent,suppressReason,type StoredEvent} from "./events-core.ts";

export async function reconcileEvents(){
  const db=database();
  const all=(await db.prepare("SELECT * FROM show_events WHERE status IN ('listed','unverified')").all<StoredEvent>()).results;
  const dateGroups=new Map<string,StoredEvent[]>();
  for(const event of all)if(event.starts_at){const key=[normalize(event.artist),event.country,event.starts_at].join("|");const group=dateGroups.get(key)||[];group.push(event);dateGroups.set(key,group);}
  for(const group of dateGroups.values()){
    const cities=[...new Set(group.map(e=>canonicalCity(e.city,e.country)).filter(Boolean))];
    if(cities.length===1)for(const event of group)if(!event.city)event.city=group.find(e=>!!e.city)!.city;
  }
  const groups=new Map<string,StoredEvent[]>();
  for(const event of all){const key=eventIdentity(event);const group=groups.get(key)||[];group.push(event);groups.set(key,group);}
  for(const [key,group] of groups){
    const winner=preferredEvent(group),duplicates=group.filter(e=>e.id!==winner.id);
    const notified=group.some(e=>e.notified&&e.status===winner.status)?1:0;
    if(duplicates.length||winner.identity_key!==key||winner.notified!==notified){
      const statements=duplicates.map(e=>db.prepare("UPDATE show_events SET status='duplicate',identity_key=?,suppress_reason=? WHERE id=?").bind("duplicate:"+e.id,"Duplicata consolidada em "+winner.id,e.id));
      statements.push(db.prepare("UPDATE show_events SET identity_key=?,city=?,notified=MAX(notified,?) WHERE id=?").bind(key,winner.city,notified,winner.id));
      await db.batch(statements);
    }
  }
  const active=(await db.prepare("SELECT * FROM show_events WHERE status IN ('listed','unverified')").all<StoredEvent>()).results;
  for(const event of active){const reason=suppressReason(event,active);if(reason)await db.prepare("UPDATE show_events SET status='superseded',suppress_reason=? WHERE id=? AND status='unverified'").bind(reason,event.id).run();}
}
export async function visibleEvents(countries:string[]){
  await reconcileEvents();
  return (await database().prepare("SELECT * FROM show_events WHERE status IN ('listed','unverified') AND (starts_at='' OR starts_at>=?) AND country IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM watch_artists a WHERE a.name=show_events.artist) ORDER BY CASE WHEN status='listed' THEN 0 ELSE 1 END,CASE WHEN starts_at='' THEN 1 ELSE 0 END,starts_at,artist LIMIT 300").bind(todayInBrazil(),JSON.stringify(countries)).all<StoredEvent>()).results;
}
export async function storeEvents(input:ShowEvent[],artists:{name:string;normalized:string}[],countries:string[]){
  if(!Array.isArray(input)||input.length>100)throw new UserError("Envie até 100 eventos por vez.");
  await reconcileEvents();let added=0;
  for(const event of input){
    if(!event||typeof event.artist!=="string"||typeof event.title!=="string"||typeof event.url!=="string")continue;
    const artist=artists.find(a=>a.normalized===normalize(event.artist));if(!artist||!countries.includes(event.country)||!event.title.trim())continue;
    let link:string;try{link=canonicalURL(webURL(event.url));}catch{continue;}if(link.length>2000)continue;
    const date=typeof event.startsAt==="string"?event.startsAt.slice(0,10):"";if(date&&!upcomingDate(date))continue;
    const published=typeof event.publishedAt==="string"&&/^\d{4}-\d{2}-\d{2}/.test(event.publishedAt)&&!Number.isNaN(Date.parse(event.publishedAt))?new Date(event.publishedAt).toISOString():"";
    const status=event.status==="listed"&&date&&!isJournalism(String(event.source||""),link)?"listed":"unverified";
    const incoming:StoredEvent={id:"",artist:artist.name,title:event.title.slice(0,400),country:event.country,city:String(event.city||"").slice(0,160),starts_at:date,url:link,source:String(event.source||new URL(link).hostname).slice(0,200),status,notified:0,published_at:published};
    const db=database();let key=eventIdentity(incoming);
    let existing=await db.prepare("SELECT * FROM show_events WHERE identity_key=?").bind(key).first<StoredEvent>();
    if(!existing&&date){
      const nearby=(await db.prepare("SELECT * FROM show_events WHERE artist=? AND country=? AND starts_at=? AND status IN ('listed','unverified')").bind(artist.name,event.country,date).all<StoredEvent>()).results;
      const matches=nearby.filter(e=>!e.city||!incoming.city||canonicalCity(e.city,e.country)===canonicalCity(incoming.city,incoming.country));
      if(matches.length===1){existing=matches[0];if(!incoming.city)incoming.city=existing.city;key=eventIdentity(incoming);}
    }
    if(existing){
      // A confirmed show cannot be downgraded by a later news result; source/title changes do not re-arm notifications.
      const upgrade=existing.status!=="listed"&&status==="listed";
      const keep=existing.status==="listed"&&status!=="listed";
      const archived=["superseded","duplicate"].includes(existing.status)&&status!=="listed";
      if(!keep&&!archived)await db.prepare("UPDATE show_events SET identity_key=?,title=?,city=?,url=?,source=?,status=?,published_at=CASE WHEN ?<>'' THEN ? ELSE published_at END,suppress_reason='',notified=CASE WHEN ? THEN 0 ELSE notified END WHERE id=?")
        .bind(key,incoming.title,incoming.city,link,incoming.source,status,published,published,upgrade?1:0,existing.id).run();
      else if(published)await db.prepare("UPDATE show_events SET published_at=? WHERE id=? AND published_at=''").bind(published,existing.id).run();
      if(upgrade)added++;
    }else{
      const active=(await db.prepare("SELECT * FROM show_events WHERE artist=? AND country=? AND status='listed'").bind(artist.name,event.country).all<StoredEvent>()).results;
      const reason=suppressReason(incoming,active);incoming.status=reason?"superseded":status;
      const result=await db.prepare("INSERT OR IGNORE INTO show_events(id,artist,title,country,city,starts_at,url,source,status,identity_key,published_at,suppress_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(await digest(key),artist.name,incoming.title,event.country,incoming.city,date,link,incoming.source,incoming.status,key,published,reason).run();
      if(!reason)added+=result.meta.changes;
    }
  }
  await reconcileEvents();return added;
}
