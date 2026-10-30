// Read-only source diagnostics. Does not change the radar or send messages.
import {OFFICIAL_SOURCES,JOURNALISM_SOURCES} from '../src/lib/radar-sources.ts';
import {collectSource} from '../src/lib/official-discovery.ts';
const artists=process.argv.slice(2);
if(!artists.length)artists.push('Sepultura','Iron Maiden','Metallica');
const sources=[...OFFICIAL_SOURCES,...JOURNALISM_SOURCES];
let failures=0;
for(let offset=0;offset<sources.length;offset+=2) {
 const results=await Promise.all(sources.slice(offset,offset+2).map(source=>collectSource(source,artists,source.countries)));
 for(const result of results){
  if(result.warnings.length)failures++;
  console.log(JSON.stringify({source:result.name,pagesRead:result.inspected.length,datedEvents:result.events.filter(e=>e.status==='listed').length,unverifiedLeads:result.events.filter(e=>e.status==='unverified').length,candidateLinks:result.candidates.length,warnings:result.warnings}));
 }
}
console.log(`${sources.length} fontes consultadas; ${failures} com avisos. Uma resposta sem eventos não comprova ausência de shows. Nenhum dado salvo ou e-mail enviado.`);
