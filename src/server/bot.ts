import { musicProviders } from "../features/music/providers";
import { collectSource, sourceBatch } from "../features/radar/discovery";
import { storeEvents, visibleEvents } from "../features/events/store";
import {database,UserError,siteOrigin} from "./database";
export {database,UserError,siteOrigin} from "./database";
import { env } from "cloudflare:workers";
import { appleConfiguration, discover, normalize, type ShowEvent } from "../core/bot";

export type Settings = { id: number; email: string; notifications: number; countries: string; schedule: string };
export async function settings(): Promise<Settings> {
  return await database().prepare("SELECT * FROM bot_settings WHERE id=1").first<Settings>()
    || { id: 1, email: "", notifications: 0, countries: '["BR"]', schedule: "pending" };
}
export async function watchlist() {
  return (await database().prepare("SELECT id,name,normalized FROM watch_artists ORDER BY name COLLATE NOCASE").all<{id:string;name:string;normalized:string}>()).results;
}
export function appleStatus(origin = siteOrigin()) {
  try { appleConfiguration(env.APPLE_MUSIC_DEVELOPER_TOKEN, origin); return { ready: true, message: "Pronto para conectar", origin }; }
  catch (error) { return { ready: false, message: (error as Error).message, origin }; }
}
export async function dashboard() {
  const preferences=await settings();
  const [artists, shows, lastRun, confirmation] = await Promise.all([
    watchlist(),
    visibleEvents(JSON.parse(preferences.countries)),
    database().prepare("SELECT * FROM scan_runs ORDER BY created_at DESC LIMIT 1").first(),
    database().prepare("SELECT status,last_error,created_at,sent_at FROM preference_confirmations ORDER BY created_at DESC,rowid DESC LIMIT 1").first(),
  ]);
  return { artists, settings: { ...preferences, countries: JSON.parse(preferences.countries) }, events: shows, lastRun, confirmation,
    apple: appleStatus(), music: musicProviders(appleStatus().ready,env.SPOTIFY_CLIENT_ID), sources: { news: true, ticketmaster: !!env.TICKETMASTER_API_KEY, predicthq: !!env.PREDICTHQ_API_KEY } };
}
export async function addArtist(name: unknown) {
  if (typeof name !== "string" || !normalize(name) || name.trim().length > 160) throw new UserError("Informe um nome de artista com até 160 caracteres.");
  const result = await database().prepare("INSERT OR IGNORE INTO watch_artists(id,name,normalized) VALUES(?,?,?)")
    .bind(crypto.randomUUID(), name.trim(), normalize(name)).run();
  return result.meta.changes;
}
export async function saveEvents(input:ShowEvent[]) {
  const [artists,preferences]=await Promise.all([watchlist(),settings()]);
  return storeEvents(input,artists,JSON.parse(preferences.countries));
}
export async function scan(offset = 0) {
  if (!Number.isInteger(offset) || offset < 0) throw new UserError("Posição de busca inválida.");
  const [artists, preferences] = await Promise.all([watchlist(), settings()]);
  const countries = JSON.parse(preferences.countries) as string[];
  const pairs = artists.flatMap(artist => countries.map(country => ({artist: artist.name, country})));
  const batch = pairs.slice(offset, offset + 8);
  let added = 0;
  const warnings: string[] = [];
  // Eight artist/country pairs keep each request bounded, independently of watchlist size.
  for (const pair of batch) {
    const found = await discover(pair.artist, pair.country, {ticketmaster: env.TICKETMASTER_API_KEY, predicthq: env.PREDICTHQ_API_KEY});
    added += await saveEvents(found.events);
    warnings.push(...found.warnings);
  }
  await database().prepare("DELETE FROM show_events WHERE starts_at<>'' AND starts_at<date('now','-30 day')").run();
  await database().prepare("DELETE FROM show_events WHERE starts_at='' AND created_at<datetime('now','-60 day')").run();
  await database().prepare("INSERT INTO scan_runs(id,new_events,warnings) VALUES(?,?,?)").bind(crypto.randomUUID(), added, JSON.stringify(warnings)).run();
  return { added, warnings, total: pairs.length, nextOffset: offset + batch.length < pairs.length ? offset + batch.length : null };
}

export async function scanOfficialSources(offset=0) {
  if(!Number.isInteger(offset)||offset<0)throw new UserError("Posição de fonte inválida.");
  const [artists,preferences]=await Promise.all([watchlist(),settings()]);
  const countries=JSON.parse(preferences.countries) as string[];
  if(!artists.length)return {added:0,results:[],warnings:[],total:0,nextOffset:null};
  const selection=sourceBatch(countries,offset);
  const results=await Promise.all(selection.batch.map(source=>collectSource(source,artists.map(artist=>artist.name),countries)));
  let added=0;
  for(const result of results)for(let start=0;start<result.events.length;start+=100)added+=await saveEvents(result.events.slice(start,start+100));
  const warnings=results.flatMap(result=>result.warnings);
  await database().prepare("INSERT INTO scan_runs(id,new_events,warnings) VALUES(?,?,?)").bind(crypto.randomUUID(),added,JSON.stringify(warnings)).run();
  return {added,results,warnings,total:selection.total,nextOffset:selection.nextOffset};
}
