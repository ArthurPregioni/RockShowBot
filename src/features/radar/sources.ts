import catalog from "./catalog.json" with { type: "json" };

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
  if(/flesch/i.test(source))return true;
  try { const parsed=new URL(url);return /(^|\.)(x\.com|twitter\.com|instagram\.com|youtube\.com|youtu\.be)$/.test(parsed.hostname); }
  catch{return false;}
}
