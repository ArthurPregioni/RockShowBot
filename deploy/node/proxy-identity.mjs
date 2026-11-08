import {timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
// Only the authenticated loopback gateway may assert a public visitor address.
export function clientIdentity(req,key){
 const peer=req.socket.remoteAddress,supplied=req.headers['x-hub-proxy-key'],ip=req.headers['x-hub-client-ip'];
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)||typeof key!=='string'||key.length<32||typeof supplied!=='string'||supplied.length>512||typeof ip!=='string'||!isIP(ip))return peer;
 const a=Buffer.from(key),b=Buffer.from(supplied);
 return a.length===b.length&&timingSafeEqual(a,b)?ip:peer;
}
