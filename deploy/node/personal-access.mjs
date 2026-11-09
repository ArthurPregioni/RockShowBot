export const PERSONAL_COOKIE='personal_access';
export function personalAccessConfig(origin,env=process.env){
 const domain=env.PERSONAL_ACCESS_DOMAIN||'';
 if(!domain)return null;
 if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)||origin.protocol!=='https:'||!origin.hostname.endsWith('.'+domain))throw Error('Invalid personal access domain');
 const targets=JSON.parse(env.PERSONAL_ACCESS_TARGETS||'{}');
 for(const [name,value] of Object.entries(targets)){
  const url=new URL(value);
  if(!['casahub','financas'].includes(name)||url.protocol!=='https:'||!url.hostname.endsWith('.'+domain)||url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Invalid personal access target');
 }
 return {domain,targets};
}
export function personalCookie(config,token='',clear=false){return `${PERSONAL_COOKIE}=${token}; Path=/; Domain=${config.domain}; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear?0:180*86400}`;}
export function personalOwner(account){return account?.id==='local-owner'&&account.role==='admin';}
