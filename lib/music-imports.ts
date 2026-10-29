import { env } from "cloudflare:workers";
import { digest, type Candidate } from "./bot-core";
import { database, addArtist, UserError } from "./cloud-bot";
import { browserArtists, catalogArtists, deezerArtists, spotifyArtists, spotifyAuthorization, spotifyExchange } from "./music-providers";

const cookieName="rockshowbot_music";
type Session={id:string;owner:string;phase:string;expires:number;candidates:string};
function rawCookie(request:Request){return request.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith(cookieName+"="))?.slice(cookieName.length+1)||"";}
function header(raw:string,origin:string){return `${cookieName}=${raw}; Path=/api/music; HttpOnly; SameSite=Lax; Max-Age=${raw?600:0}${origin.startsWith("https:")?"; Secure":""}`;}
function result(value:unknown,cookie?:string){return new Response(JSON.stringify(value),{headers:{"Content-Type":"application/json","Cache-Control":"no-store",...(cookie?{"Set-Cookie":cookie}:{})}});}
async function session(request:Request,owner:string){
  const raw=rawCookie(request);if(!raw)throw new UserError("Importação expirada. Escolha o serviço novamente.");
  const found=await database().prepare("SELECT * FROM music_imports WHERE id=? AND owner=?").bind(await digest(raw),owner).first<Session>();
  if(!found||found.expires<Date.now()||!found.phase.startsWith("music:"))throw new UserError("Importação expirada. Escolha o serviço novamente.");
  return found;
}
async function create(request:Request,owner:string,phase:string,payload:unknown){
  const raw=crypto.randomUUID()+crypto.randomUUID(),id=await digest(raw);
  await database().prepare("DELETE FROM music_imports WHERE expires<? OR (id=? AND owner=?)").bind(Date.now(),await digest(rawCookie(request)),owner).run();
  await database().prepare("INSERT INTO music_imports(id,owner,phase,expires,candidates) VALUES(?,?,?,?,?)").bind(id,owner,phase,Date.now()+600000,JSON.stringify(payload)).run();return raw;
}
export async function musicAction(request:Request,action:string,body:any,owner:string,origin:string):Promise<Response>{
  try {
    const redirectURI=origin+"/api/music/spotify/callback";
    if(request.method==="GET"&&action==="music/spotify/callback"){
      const s=await session(request,owner);
      if(s.phase!=="music:spotify:pending")throw new UserError("Autorização já utilizada. Conecte novamente.");
      const metadata=JSON.parse(s.candidates),url=new URL(request.url);
      if(!url.searchParams.get("state")||url.searchParams.get("state")!==metadata.state)throw new UserError("Retorno Spotify inválido. Conecte novamente.");
      const claim=await database().prepare("UPDATE music_imports SET phase='music:spotify:reading',candidates='[]' WHERE id=? AND phase='music:spotify:pending'").bind(s.id).run();
      if(claim.meta.changes!==1)throw new UserError("Autorização já utilizada.");
      try {
        if(url.searchParams.has("error"))throw new Error("Autorização Spotify cancelada. Você pode tentar novamente.");
        const code=url.searchParams.get("code");if(!code||code.length>4000)throw new Error("O Spotify não retornou um código válido.");
        if(!env.SPOTIFY_CLIENT_ID)throw new Error("A credencial do aplicativo Spotify não está configurada.");
        const token=await spotifyExchange(env.SPOTIFY_CLIENT_ID,redirectURI,code,metadata.verifier);
        const candidates=await spotifyArtists(token);
        await database().prepare("UPDATE music_imports SET phase='music:spotify:ready',candidates=?,expires=? WHERE id=?").bind(JSON.stringify(candidates),Date.now()+600000,s.id).run();
      }catch(e){await database().prepare("UPDATE music_imports SET phase='music:spotify:failed',candidates=? WHERE id=?").bind(JSON.stringify({error:(e as Error).message}),s.id).run();}
      return new Response(null,{status:303,headers:{Location:origin+"/?music=spotify","Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
    }
    if(request.method==="GET"&&action==="music/selection"){
      const s=await session(request,owner);
      if(s.phase.endsWith(":failed"))throw new UserError(JSON.parse(s.candidates).error);
      if(!s.phase.endsWith(":ready"))throw new UserError("A importação ainda não foi concluída.");
      return result({provider:s.phase.split(":")[1],candidates:JSON.parse(s.candidates)});
    }
    if(request.method!=="POST")throw new UserError("Ação não encontrada.",404);
    if(action==="music/spotify/start"){
      if(!env.SPOTIFY_CLIENT_ID)throw new UserError("Login Spotify indisponível: falta a credencial do aplicativo nesta instalação.");
      const state=crypto.randomUUID()+crypto.randomUUID(),verifier=(crypto.randomUUID()+crypto.randomUUID()).replace(/-/g,"");
      const raw=await create(request,owner,"music:spotify:pending",{state,verifier});
      return result({url:await spotifyAuthorization(env.SPOTIFY_CLIENT_ID,redirectURI,state,verifier)},header(raw,origin));
    }
    if(action==="music/browser/prepare"){
      if(body.captureFormat!==2)throw new UserError("Atualize a extensão RockShowBot para a versão 0.2.0 ou mais recente. A versão antiga pode confundir álbuns com artistas.");
      const candidates=browserArtists(body.provider,body.artists);
      const raw=await create(request,owner,`music:browser-v2-${body.provider}:ready`,candidates);
      return result({provider:body.provider,candidates},header(raw,origin));
    }
    if(action==="music/deezer/artists"||action==="music/catalog"){
      const provider=action==="music/catalog"?"catalog":"deezer";
      const candidates=provider==="deezer"?await deezerArtists(body.profile):await catalogArtists(body.query,body.provider);
      const raw=await create(request,owner,`music:${provider}:ready`,candidates);
      return result({provider,candidates},header(raw,origin));
    }
    if(action==="music/import"){
      const s=await session(request,owner);
      if(/^music:browser-(apple|spotify):ready$/.test(s.phase))throw new UserError("Essa leitura veio da extensão antiga. Atualize a extensão e faça uma nova leitura da biblioteca.");
      if(!s.phase.endsWith(":ready"))throw new UserError("Escolha os artistas novamente.");
      if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>4000)throw new UserError("Selecione ao menos um artista.");
      const claim=await database().prepare("UPDATE music_imports SET phase='music:importing' WHERE id=? AND phase=?").bind(s.id,s.phase).run();
      if(claim.meta.changes!==1)throw new UserError("Essa importação já está em andamento.");
      const selected=new Set(body.ids);let added=0;
      try{
        for(const artist of JSON.parse(s.candidates) as Candidate[])if(selected.has(artist.id))added+=await addArtist(artist.name);
        await database().prepare("DELETE FROM music_imports WHERE id=?").bind(s.id).run();
      }catch(e){await database().prepare("UPDATE music_imports SET phase=? WHERE id=?").bind(s.phase,s.id).run();throw e;}
      return result({added},header("",origin));
    }
    if(action==="music/cancel"){
      await database().prepare("DELETE FROM music_imports WHERE id=? AND owner=?").bind(await digest(rawCookie(request)),owner).run();return result({ok:true},header("",origin));
    }
    throw new UserError("Ação não encontrada.",404);
  }catch(e){if(e instanceof UserError)throw e;throw new UserError((e as Error).message||"Não foi possível consultar o serviço de música.");}
}
