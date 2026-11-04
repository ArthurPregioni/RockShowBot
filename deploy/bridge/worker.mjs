// A fixed public address; application data and sessions remain on the phone.
const updatePath='/_rockshowbot/tunnel';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Strict-Transport-Security':'max-age=31536000'};
const json=(data,status=200)=>Response.json(data,{status,headers});
export function tunnelOrigin(value){
 if(typeof value!=='string')throw new Error('Invalid tunnel');
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!/^[-a-z0-9]+\.trycloudflare\.com$/.test(url.hostname))throw new Error('Invalid tunnel');
 return url.origin;
}
async function authorized(request,secret){
 if(typeof secret!=='string'||secret.length<32)return false;
 const header=request.headers.get('Authorization')||'';
 if(!header.startsWith('Bearer ')||header.length>512)return false;
 const encoder=new TextEncoder();
 const hashes=await Promise.all([header.slice(7),secret].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
 const a=new Uint8Array(hashes[0]),b=new Uint8Array(hashes[1]);let difference=0;
 for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
 return difference===0;
}
export async function handleBridge(request,env,fetcher=fetch){
 const publicURL=new URL(request.url);
 if(publicURL.protocol==='http:'){publicURL.protocol='https:';return Response.redirect(publicURL.toString(),308);}
 if(publicURL.pathname===updatePath){
  if(!await authorized(request,env.ORIGIN_UPDATE_TOKEN))return json({error:'Unauthorized'},401);
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.text();if(body.length>1024)return json({error:'Body too large'},413);
  let origin;try{origin=tunnelOrigin(JSON.parse(body).origin);}catch{return json({error:'Invalid tunnel origin'},400);}
  await env.TUNNEL_STATE.put('origin',origin);
  return json({updated:true});
 }
 let origin;try{origin=tunnelOrigin(await env.TUNNEL_STATE.get('origin'));}catch{
  return new Response('O endereço do celular está sendo atualizado. Tente novamente em instantes.',{status:503,headers:{...headers,'Content-Type':'text/plain; charset=utf-8','Retry-After':'30'}});
 }
 const upstream=new URL(request.url);upstream.protocol='https:';upstream.host=new URL(origin).host;
 const upstreamHeaders=new Headers(request.headers);
 for(const name of ['host','connection','proxy-connection','transfer-encoding'])upstreamHeaders.delete(name);
 // Do not follow an upstream redirect with cookies or authorization attached.
 const forwarded=new Request(new Request(upstream,request),{headers:upstreamHeaders,redirect:'manual'});
 let response;try{response=await fetcher(forwarded,{cache:'no-store'});}catch{
  return new Response('O celular está temporariamente indisponível. Tente novamente em instantes.',{status:503,headers:{...headers,'Content-Type':'text/plain; charset=utf-8','Retry-After':'30'}});
 }
 const output=new Response(response.body,response);
 for(const [name,value]of Object.entries(headers))output.headers.set(name,value);
 const location=output.headers.get('Location');
 if(location){
  const redirect=new URL(location,origin);
  if(redirect.origin===origin)output.headers.set('Location',publicURL.origin+redirect.pathname+redirect.search+redirect.hash);
 }
 return output;
}
const worker={fetch(request,env){return handleBridge(request,env);}};
export default worker;
