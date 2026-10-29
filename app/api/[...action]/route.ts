import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { appleConfiguration, appleLibrary, digest, normalize, type Candidate, type ShowEvent } from "../../../lib/bot-core";
import { addArtist, dashboard, database, scan, settings, SITE_ORIGIN, saveEvents, UserError, watchlist } from "../../../lib/cloud-bot";

export const dynamic = "force-dynamic";
function json(value: unknown, status = 200, cookie?: string) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(cookie ? {"Set-Cookie":cookie} : {}) } });
}
const cookieName = "rockshowbot_apple";
function cookie(request: Request) { return request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(cookieName + "="))?.slice(cookieName.length + 1) || ""; }
function cookieHeader(value: string, origin: string, clear = false) { return `${cookieName}=${value}; Path=/api/apple; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 600}${origin.startsWith("https:") ? "; Secure" : ""}`; }
function originFor(request: Request) { const url = new URL(request.url); return ["localhost","127.0.0.1","::1"].includes(url.hostname) ? url.origin : SITE_ORIGIN; }
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
    if (request.method === "GET") {
      if (action === "dashboard") return json(await dashboard());
      if (action === "automation/context") {
        const preferences = await settings();
        const alerts = preferences.notifications ? (await database().prepare("SELECT * FROM show_events WHERE notified=0 ORDER BY created_at LIMIT 100").all()).results : [];
        return json({ artists: await watchlist(), settings: {...preferences,countries:JSON.parse(preferences.countries)}, pendingAlerts: alerts, website: SITE_ORIGIN });
      }
      throw new UserError("Página não encontrada.", 404);
    }
    if (request.method !== "POST") throw new UserError("Método inválido.", 405);
    const rawBody = await request.text();
    if (rawBody.length > 1000000) throw new UserError("Requisição muito grande.", 413);
    let body:any;
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { throw new UserError("Formato de requisição inválido."); }
    if (!body || typeof body!=="object" || Array.isArray(body)) throw new UserError("Formato de requisição inválido.");
    if (action === "artists") return json({ added: await addArtist(body.name) });
    if (action === "artists/remove") {
      await database().prepare("DELETE FROM watch_artists WHERE id=?").bind(String(body.id)).run();
      return json({ok:true});
    }
    if (action === "settings") {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new UserError("Informe um e-mail válido.");
      if (!Array.isArray(body.countries)) throw new UserError("Escolha os países para acompanhar.");
      const countries = [...new Set(body.countries.map((value:unknown) => String(value).toUpperCase()))] as string[];
      if (!countries.length || countries.length > 30 || countries.some(value => !/^[A-Z]{2}$/.test(value))) throw new UserError("Escolha entre 1 e 30 países válidos.");
      if (body.notifications && !email) throw new UserError("Informe seu e-mail para ativar alertas.");
      await database().prepare("INSERT INTO bot_settings(id,email,notifications,countries) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,notifications=excluded.notifications,countries=excluded.countries")
        .bind(email, body.notifications === true ? 1 : 0, JSON.stringify(countries)).run();
      return json({ok:true});
    }
    if (action === "scan" || action === "automation/scan") return json(await scan(Number(body.offset || 0)));
    if (action === "events" || action === "automation/events") return json({added:await saveEvents((body.events || []) as ShowEvent[])});
    if (action === "events/remove") {
      await database().prepare("DELETE FROM show_events WHERE id=?").bind(String(body.id)).run();
      return json({ok:true});
    }
    if (action === "automation/ack") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((id:unknown) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)).slice(0,100) : [];
      for (const id of ids) await database().prepare("UPDATE show_events SET notified=1 WHERE id=?").bind(id).run();
      return json({acknowledged:ids.length});
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
        const candidates = await appleLibrary(body.userToken,token,originFor(request));
        await database().prepare("UPDATE music_imports SET phase='ready',candidates=?,expires=? WHERE id=?").bind(JSON.stringify(candidates),Date.now()+600000,session.id).run();
        return json({candidates});
      } catch (error) {
        await database().prepare("DELETE FROM music_imports WHERE id=?").bind(session.id).run();
        throw new UserError((error as Error).message || "Não foi possível consultar sua biblioteca Apple Music.");
      }
    }
    if (action === "apple/import") {
      const session = await importSession(request,user!.userId,"ready");
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
