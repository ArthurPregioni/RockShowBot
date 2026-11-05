import {freezeCloud} from '../../../features/migration/cloud';
import {migrationDestination} from '../../../core/migration';
import {pendingAlerts,prepareAlert,claimAlert,acknowledgeAlert,alertFailure,alertHistory} from "../../../features/events/deliveries";
import {savePreferences,pendingConfirmations,claimConfirmation,acknowledgeConfirmation,confirmationFailure} from "../../../features/preferences/confirmations";
import { musicAction } from "../../../features/music/imports";
import { sourcesForCountries } from "../../../features/radar/sources";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../server/auth";
import { appleConfiguration, appleLibrary, digest, todayInBrazil, type Candidate, type ShowEvent } from "../../../core/bot";
import { addArtist, dashboard, database, scan, scanOfficialSources, settings, siteOrigin, saveEvents, UserError, watchlist } from "../../../server/bot";

export const dynamic = "force-dynamic";
function json(value: unknown, status = 200, cookie?: string) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(cookie ? {"Set-Cookie":cookie} : {}) } });
}
const cookieName = "rockshowbot_apple";
function cookie(request: Request) { return request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(cookieName + "="))?.slice(cookieName.length + 1) || ""; }
function cookieHeader(value: string, origin: string, clear = false) { return `${cookieName}=${value}; Path=/api/apple; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 600}${origin.startsWith("https:") ? "; Secure" : ""}`; }
function originFor(request: Request) { const url = new URL(request.url); return ["localhost","127.0.0.1","::1"].includes(url.hostname) ? url.origin : siteOrigin(); }
type Session = {id:string; owner:string; phase:string; expires:number; candidates:string};
async function importSession(request: Request, owner: string, phase?: string) {
  const raw = cookie(request);
  if (!raw) throw new UserError("Conexão Apple Music expirada. Conecte novamente.");
  const id = await digest(raw);
  const session = await database().prepare("SELECT * FROM music_imports WHERE id=? AND owner=?").bind(id,owner).first<Session>();
  if (!session || session.expires < Date.now() || (phase && phase !== session.phase)) throw new UserError("Conexão Apple Music expirada ou já utilizada. Conecte novamente.");
  return session;
}
async function handle(request: Request, context: {params: Promise<{action:string[]}>}) {
  const action = (await context.params).action.join("/");
  const automation = action.startsWith("automation/");
  try {
    // Automation routes rely on the verified owner-private Sites dispatch boundary.
    // Cloud tasks use Sites service access; no public/anonymous deployment is supported.
    const user = automation ? null : await getChatGPTUser();
    if (!automation && !user) throw new UserError("Entre com sua conta para continuar.", 401);
    if (request.method === "POST" && !automation) {
      const origin = request.headers.get("origin");
      if (!origin || origin !== originFor(request)) throw new UserError("Origem da requisição inválida.", 403);
    }
    const currentSettings=await settings();
    const migrated=currentSettings.schedule.startsWith('migrated:');
    if(migrated&&!["automation/migration/export","automation/migration/resume","automation/migration/destination"].includes(action)){
      const destination=currentSettings.schedule.slice(9);
      if(action==="automation/context")return json({migrated:true,website:destination,artists:[],settings:{...currentSettings,countries:JSON.parse(currentSettings.countries)},sources:{official:[],journalism:[]},pendingAlerts:[]});
      if(action==="automation/confirmations")return json({confirmations:[]});
      if(action==="automation/alerts/prepare")return json({delivery:null,migrated:true});
      if(action!=="automation/alerts/history")throw new UserError('Esta instalação foi migrada para '+destination,410);
    }
    if (request.method === "GET") {
      if (action.startsWith("music/")) return await musicAction(request,action,{},user!.userId,originFor(request));
      if (action === "automation/migration/export") {
        const tables=["watch_artists","show_events","bot_settings","alert_receipts","alert_deliveries","preference_confirmations","scan_runs"];
        const snapshot=await database().batch(tables.map(table=>database().prepare(`SELECT * FROM ${table} ORDER BY rowid`)));
        return json({format:"rockshowbot-web-sqlite-v1",exportedAt:new Date().toISOString(),tables:Object.fromEntries(tables.map((table,index)=>[table,snapshot[index].results]))});
      }
      if (action === "automation/alerts/history") return json({deliveries:await alertHistory()});
      if (action === "automation/confirmations") return json({confirmations:await pendingConfirmations()});
      if (action === "dashboard") return json(await dashboard());
      if (action === "automation/context") {
        const preferences = await settings();
        const alerts=await pendingAlerts();
        return json({ artists: await watchlist(), settings: {...preferences,countries:JSON.parse(preferences.countries)}, sources:sourcesForCountries(JSON.parse(preferences.countries)), pendingAlerts: alerts, searchScope: {concertDateFrom:todayInBrazil(),announcementDateFilter:null,priority:"official upcoming tour dates, venues, festivals and ticket listings; news and rumors are secondary"}, website: siteOrigin() });
      }
      throw new UserError("Página não encontrada.", 404);
    }
    if (request.method !== "POST") throw new UserError("Método inválido.", 405);
    const rawBody = await request.text();
    if (rawBody.length > 1000000) throw new UserError("Requisição muito grande.", 413);
    let body:Record<string,unknown>;
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { throw new UserError("Formato de requisição inválido."); }
    if (!body || typeof body!=="object" || Array.isArray(body)) throw new UserError("Formato de requisição inválido.");
    if (action.startsWith("music/")) return await musicAction(request,action,body,user!.userId,originFor(request));
    if (action === "artists") return json({ added: await addArtist(body.name) });
    if (action === "artists/remove") {
      await database().prepare("DELETE FROM watch_artists WHERE id=?").bind(String(body.id)).run();
      return json({ok:true});
    }
    if(action==="automation/migration/destination"){
      if(import.meta.env.ROCKSHOWBOT_STANDALONE==="true"||!migrated||body.confirm!=="update-migration-destination")throw new UserError('Alteração do destino inválida.',409);
      let destination:string;try{destination=migrationDestination(body.destination);}catch(error){throw new UserError((error as Error).message);}
      await database().prepare("UPDATE bot_settings SET schedule=?,notifications=0 WHERE id=1 AND schedule LIKE 'migrated:%'").bind('migrated:'+destination).run();
      return json({updated:true,destination});
    }
    if(action==="automation/migration/resume"){
      if(import.meta.env.ROCKSHOWBOT_STANDALONE==="true"||!migrated||body.confirm!=="resume-old-sender"||typeof body.notifications!=="boolean")throw new UserError('Retomada da origem inválida.',409);
      await database().batch([
        database().prepare("UPDATE bot_settings SET schedule='active',notifications=? WHERE id=1").bind(body.notifications?1:0),
        database().prepare("UPDATE alert_deliveries SET status='pending',last_error='' WHERE status='cancelled' AND last_error='Migrado para outro servidor antes do envio.'"),
        database().prepare("UPDATE preference_confirmations SET status='pending',last_error='' WHERE status='superseded' AND last_error='Transferido para o novo servidor.'"),
      ]);
      return json({resumed:true});
    }
    if(action==="automation/migration/freeze"){
      if(import.meta.env.ROCKSHOWBOT_STANDALONE==="true")throw new UserError('Este comando é exclusivo da instância de origem no Sites.',403);
      if(body.confirm!=="move-to-personal-server")throw new UserError('Confirme o destino da migração.');
      return json(await freezeCloud(body.destination));
    }
    if (action === "automation/alerts/prepare") return json(await prepareAlert());
    if (action === "automation/alerts/claim") return json(await claimAlert(body.id));
    if (action === "automation/alerts/ack") return json(await acknowledgeAlert(body.id,body.messageId));
    if (action === "automation/alerts/error") return json(await alertFailure(body.id,body.status,body.error));
    if (action === "settings" || action === "automation/settings") return json(await savePreferences(body));
    if (action === "automation/confirmations/claim") return json(await claimConfirmation(body.id));
    if (action === "automation/confirmations/ack") return json(await acknowledgeConfirmation(body.id,body.messageId));
    if (action === "automation/confirmations/error") return json(await confirmationFailure(body.id,body.status,body.error));
    if (action === "scan" || action === "automation/scan") return json(await scan(Number(body.offset || 0)));
    if (action === "sources/scan" || action === "automation/sources/scan") return json(await scanOfficialSources(Number(body.offset||0)));
    if (action === "events" || action === "automation/events") return json({added:await saveEvents((body.events || []) as ShowEvent[])});
    if (action === "events/remove") {
      await database().prepare("DELETE FROM show_events WHERE id=?").bind(String(body.id)).run();
      return json({ok:true});
    }
    if (action === "automation/ack") {
      throw new UserError("Use /api/automation/alerts/ack com o resumo reservado e o ID real do Gmail.",409);
    }
    if (action === "automation/status") {
      if (body.schedule !== "active") throw new UserError("Estado inválido.");
      await database().prepare("INSERT INTO bot_settings(id,schedule) VALUES(1,'active') ON CONFLICT(id) DO UPDATE SET schedule='active'").run();
      return json({ok:true});
    }
    if (action === "apple/start") {
      let token: string;
      try { token = appleConfiguration(env.APPLE_MUSIC_DEVELOPER_TOKEN, originFor(request)); }
      catch (error) { throw new UserError((error as Error).message); }
      const raw = crypto.randomUUID() + crypto.randomUUID();
      const id = await digest(raw);
      await database().prepare("DELETE FROM music_imports WHERE owner=? OR expires<?").bind(user!.userId,Date.now()).run();
      await database().prepare("INSERT INTO music_imports(id,owner,expires) VALUES(?,?,?)").bind(id,user!.userId,Date.now()+600000).run();
      return json({developerToken:token},200,cookieHeader(raw,originFor(request)));
    }
    if (action === "apple/library") {
      const session = await importSession(request,user!.userId,"pending");
      const claim = await database().prepare("UPDATE music_imports SET phase='reading' WHERE id=? AND phase='pending'").bind(session.id).run();
      if (claim.meta.changes !== 1) throw new UserError("Essa autorização já está sendo utilizada.");
      try {
        const token = appleConfiguration(env.APPLE_MUSIC_DEVELOPER_TOKEN,originFor(request));
        if(typeof body.userToken !== "string")throw new UserError("Autorização Apple Music inválida.");
        const candidates = await appleLibrary(body.userToken,token,originFor(request));
        await database().prepare("UPDATE music_imports SET phase='artists_ready',candidates=?,expires=? WHERE id=?").bind(JSON.stringify(candidates),Date.now()+600000,session.id).run();
        return json({candidates});
      } catch (error) {
        await database().prepare("DELETE FROM music_imports WHERE id=?").bind(session.id).run();
        throw new UserError((error as Error).message || "Não foi possível consultar sua biblioteca Apple Music.");
      }
    }
    if (action === "apple/import") {
      const session = await importSession(request,user!.userId,"artists_ready");
      const selected = new Set(Array.isArray(body.ids) ? body.ids : []);
      let added = 0;
      for (const artist of JSON.parse(session.candidates) as Candidate[]) if (selected.has(artist.id)) added += await addArtist(artist.name);
      await database().prepare("DELETE FROM music_imports WHERE id=?").bind(session.id).run();
      return json({added},200,cookieHeader("",originFor(request),true));
    }
    if (action === "apple/cancel") {
      const id = await digest(cookie(request));
      await database().prepare("DELETE FROM music_imports WHERE id=? AND owner=?").bind(id,user!.userId).run();
      return json({ok:true},200,cookieHeader("",originFor(request),true));
    }
    throw new UserError("Ação não encontrada.",404);
  } catch (error) {
    if (error instanceof UserError) return json({error:error.message},error.status);
    console.error("RockShowBot request failed",action,error instanceof Error ? error.name : "unknown");
    return json({error:"Não foi possível concluir. Tente novamente."},500);
  }
}
export const GET = handle;
export const POST = handle;
