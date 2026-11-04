import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
const target='dist/standalone';
mkdirSync(target+'/deploy',{recursive:true});
cpSync('deploy/node',target+'/deploy/node',{recursive:true});
cpSync('drizzle',target+'/drizzle',{recursive:true});
mkdirSync(target+'/deploy/termux',{recursive:true});
for(const name of ['install-web.sh','install-tunnel.sh','tunnel.py','bridge.py'])cpSync('deploy/termux/'+name,target+'/deploy/termux/'+name);
writeFileSync(target+'/server.js',"// All entrypoints enforce RockShowBot authentication.\nimport './deploy/node/server.mjs';\n");
console.log('Native Node artifact ready in dist/standalone (login required).');
