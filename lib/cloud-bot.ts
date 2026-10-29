import { musicProviders } from "./music-providers";
import { env } from "cloudflare:workers";
import { appleConfiguration, discover, digest, normalize, webURL, todayInBrazil, upcomingDate, type ShowEvent } from "./bot-core";

export const SITE_ORIGIN = (env.ROCKSHOWBOT_SITE_ORIGIN || "https://rockshowbot-arthur.socialyak11.chatgpt.site").replace(/\/+$/, "");
export class UserError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function database() {
  if (!env.DB) throw new Error("D1 unavailable");
  return env.DB;
}
export type Settings = { id: number; email: string; notifications: number; countries: string; schedule: string };
export async function settings(): Promise<Settings> {
  return await database().prepare("SELECT * FROM bot_settings WHERE id=1").first<Settings>()
    || { id: 1, email: "", notifications: 0, countries: '["BR"]', schedule: "pending" };
}
export async function watchlist() {
  return (await database().prepare("SELECT id,name,normalized FROM watch_artists ORDER BY name COLLATE NOCASE").all<{id:string;name:string;normalized:string}>()).results;
}
export function appleStatus(origin = SITE_ORIGIN) {
  try { appleConfiguration(env.APPLE_MUSIC_DEVELOPER_TOKEN, origin); return { ready: true, message: "Pronto para conectar", origin }; }
  catch (error) { return { ready: false, message: (error as Error).message, origin }; }
}
export async function dashboard() {
  const [artists, preferences, shows, lastRun] = await Promise.all([
    watchlist(), settings(),
    database().prepare("SELECT * FROM show_events WHERE (starts_at='' OR starts_at>=?) AND country IN (SELECT value FROM json_each(COALESCE((SELECT countries FROM bot_settings WHERE id=1),'[\"BR\"]'))) AND EXISTS (SELECT 1 FROM watch_artists a WHERE a.name=show_events.artist) ORDER BY CASE WHEN starts_at='' THEN 1 ELSE 0 END, starts_at, artist, created_at DESC LIMIT 300").bind(todayInBrazil()).all(),
    database().prepare("SELECT * FROM scan_runs ORDER BY created_at DESC LIMIT 1").first(),
  ]);
  return { artists, settings: { ...preferences, countries: JSON.parse(preferences.countries) }, events: shows.results, lastRun,
    apple: appleStatus(), music: musicProviders(appleStatus().ready,env.SPOTIFY_CLIENT_ID), sources: { news: true, ticketmaster: !!env.TICKETMASTER_API_KEY, predicthq: !!env.PREDICTHQ_API_KEY } };
}
export async function addArtist(name: string) {
  if (typeof name !== "string" || !normalize(name) || name.trim().length > 160) throw new UserError("Informe um nome de artista com até 160 caracteres.");
  const result = await database().prepare("INSERT OR IGNORE INTO watch_artists(id,name,normalized) VALUES(?,?,?)")
    .bind(crypto.randomUUID(), name.trim(), normalize(name)).run();
  return result.meta.changes;
}
export async function saveEvents(input: ShowEvent[]) {
  if (!Array.isArray(input) || input.length > 100) throw new UserError("Envie até 100 eventos por vez.");
  const [artists, preferences] = await Promise.all([watchlist(), settings()]);
  const countries = JSON.parse(preferences.countries) as string[];
  let added = 0;
  for (const event of input) {
    if (!event || typeof event.artist !== "string" || typeof event.title !== "string" || typeof event.url !== "string") continue;
    const artist = artists.find(item => item.normalized === normalize(event.artist));
    if (!artist || !countries.includes(event.country) || !event.title.trim()) continue;
    let link: string;
    try { link = webURL(event.url); } catch { continue; }
    if (link.length > 2000) continue;
    const date = typeof event.startsAt === "string" ? event.startsAt.slice(0, 10) : "";
    if (date && !upcomingDate(date)) continue;
    const city = String(event.city || "").slice(0, 160);
    const key = date ? [artist.normalized, date, normalize(city), event.country].join("|") : artist.normalized + "|" + link;
    const id = await digest(key);
    const result = await database().prepare("INSERT OR IGNORE INTO show_events(id,artist,title,country,city,starts_at,url,source,status) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id, artist.name, event.title.slice(0, 400), event.country, city, date, link, String(event.source || new URL(link).hostname).slice(0, 200), event.status === "listed" && date ? "listed" : "unverified").run();
    added += result.meta.changes;
  }
  return added;
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
