import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
const target='dist/standalone';
mkdirSync(target+'/deploy',{recursive:true});
cpSync('deploy/node',target+'/deploy/node',{recursive:true});
cpSync('drizzle',target+'/drizzle',{recursive:true});
writeFileSync(target+'/server.js',"// All entrypoints enforce RockShowBot authentication.\nimport './deploy/node/server.mjs';\n");
console.log('Native Node artifact ready in dist/standalone (login required).');
