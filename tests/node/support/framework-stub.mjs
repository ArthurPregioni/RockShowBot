// Test-only stand-in for the framework's production server, so deploy/node/server.mjs can run without a build.
// Passed to node with --import: it maps the framework entry to this same file.
import http from 'node:http';
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(specifier,context,next){return specifier==='vinext/server/prod-server'?{url:${JSON.stringify(import.meta.url)},shortCircuit:true}:next(specifier,context);}`));
// Answers with what the wrapped application would receive. It does not model the real framework.
export async function startProdServer({port,host}){
 const server=http.createServer(async(req,res)=>{
  let bytes=0;try{for await(const chunk of req)bytes+=chunk.length;}catch{return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({path:req.url,method:req.method,id:req.headers['oai-authenticated-user-id'],email:req.headers['oai-authenticated-user-email'],bytes}));
 });
 await new Promise(resolve=>server.listen(port,host,resolve));
 return {server,port:server.address().port};
}
