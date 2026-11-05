import {normalize} from './text.ts';
const places:Record<string,string[]>={
 BR:['brasil','brazil','sao paulo','rio de janeiro','curitiba','porto alegre','belo horizonte','brasilia','recife','fortaleza','goiania','salvador','maceio','ipatinga','foz do iguacu'],
 AR:['argentina','buenos aires','rosario','la plata'],CL:['chile','santiago','vina del mar'],UY:['uruguai','uruguay','montevideo'],PY:['paraguai','paraguay','asuncion'],PE:['peru','lima'],CO:['colombia','bogota','medellin'],EC:['equador','ecuador','quito','guayaquil'],BO:['bolivia','la paz'],VE:['venezuela','caracas'],GY:['guiana','guyana'],SR:['suriname'],GF:['guiana francesa','french guiana'],MX:['mexico'],US:['estados unidos','united states','eua','usa'],CA:['canada'],PT:['portugal','lisboa','porto'],ES:['espanha','espana','madrid'],GB:['reino unido','united kingdom','londres','london'],FR:['franca','france','paris'],DE:['alemanha','germany','berlim','berlin'],AU:['australia'],JP:['japao','japan'],
};
const words=(text:string,phrase:string)=>(` ${text} `).includes(` ${phrase} `);
const concertNoun='(?:shows?|turne|tour|conciertos?|concertos?|concerts?|festival|festivais|festivales|palcos?|apresentac\\w*)';
const determiners='(?:(?:um|uma|uns|umas|o|a|os|as|nova|novo|novas|novos|mais|outra|outro|sua|seu|sus|una|un|nueva|nuevos|the|an|new) ){0,4}';
const object=determiners+concertNoun;
const adverbs='(?:(?:ainda|tambem|finalmente|novamente|talvez|possivelmente|oficialmente|reportedly|allegedly) ){0,3}';
const modal='(?:pode|podem|podera|poderao|poderia|poderiam|deve|devem|podria|podrian|podra|podran|may|might|could)';
const perform='(?:tocar|se apresentar|apresentar se|presentarse|actuar|perform|play)';
const speculativePerformance=new RegExp(`\\b${modal} ${adverbs}(?:${perform}|(?:fazer|realizar|dar|anunciar|confirmar|hacer|announce) ${object})(?: |$)`);
const plannedPerformance=new RegExp(`\\b(?:negocia|negociam|planeja|planejam|planea|prepara|preparam) ${object}(?: |$)`);
const proposedPerformance=new RegExp(`\\b(?:possivel|possiveis|posible|posibles|possible|rumored|rumoured) ${object}(?: |$)|\\b(?:cotad[oa]s?|previst[oa]s?) para ${object}(?: |$)`);
const announcedPerformance=new RegExp(`\\b(?:anuncia|anunciam|confirma|confirmam|tera|terao|announces|confirms|fara|realizara) ${object}(?: |$)|\\b(?:tocara|se apresentara)(?: |$)`);

export function concertHeadline(title:string,source:string){
 // Google News appends the publisher: "Brasil" in its name is not a destination.
 const parts=title.trim().split(/\s+(?:-|–|—|\|)\s+/);
 if(parts.length>1&&normalize(parts.at(-1)!)===normalize(source))parts.pop();
 return parts.join(' — ');
}
function performerRole(value:string,artist:string){
 const needle=` ${artist} `,padded=` ${value} `;
 let offset=padded.indexOf(needle);
 while(offset>=0){
  const before=padded.slice(0,offset).trim(),after=padded.slice(offset+needle.length).trim();
  const subjectPrefix=/^(?:(?:o|a|os|as|banda|grupo|rapper|cantor|cantora|duo|trio|band|the|el|la) )*(?:o|a|os|as|banda|grupo|rapper|cantor|cantora|duo|trio|band|the|el|la)?$/.test(before)
   ||/^(?:rumores? (?:apontam|indicam|sugerem) (?:que )?(?:a banda )?|flesch (?:diz|afirma|indica|antecipa|adianta)(?: que)?)$/.test(before);
  const startsClaim=/^(?:(?:ja|ainda|tambem|finalmente|agora|oficialmente|novamente|possivelmente|supostamente|reportedly|allegedly) )*(?:pode|podem|podera|poderao|poderia|poderiam|deve|devem|podria|podrian|podra|podran|may|might|could|anuncia|anunciam|confirma|confirmam|retorna|retornara|volta|voltara|vem|vira|fara|tocara|se apresentara|realizara|negocia|negociam|planeja|planejam|planea|prepara|preparam|esta|estaria|announces|confirms|regresa|vuelve)(?: |$)/.test(after);
  const namedPerformance=new RegExp(`${concertNoun} (?:de|do|da|dos|das|of|com)$`).test(before);
  const billed=before.match(/(?:^| )com (.*)$/)?.[1];
  const coheadliner=billed!==undefined&&billed.split(' ').length<=16&&!/\b(?:musica|cancao|album|disco|versao|canta|tocou|lembra)\b/.test(billed);
  if(subjectPrefix&&startsClaim||namedPerformance||coheadliner)return true;
  offset=padded.indexOf(needle,offset+1);
 }
 return false;
}
export function concertNewsStatus(title:string,artist:string,country:string,source=''):'unverified'|'reported'|null{
 const name=normalize(artist);
 // Keep a quoted artist name; discard song/album titles that merely contain it.
 const headline=concertHeadline(title,source).replace(/[“"‘']([^”"’']+)[”"’']/g,(_match,quoted:string)=>normalize(quoted)===name?quoted:' ');
 for(const clause of headline.split(/[;\n]/)){
  const value=normalize(clause);
  if(!words(value,name)||!places[country]?.some(place=>words(value,place)))continue;
  if(/\b(?:tributo|cover|homenageia|homenagem|fashion show|desfile|resenha|documentario|relembre|relembra|como foi|o que aconteceu|nega|negou|desmente|desmentiu|cancel\w*|adiad\w*|afasta\w*|aposent\w*|sonho|sonham|wish)\b/.test(value)||/\bnao (?:vem|vira|fara|tocara|vai|pretende|acontecera)\b/.test(value))continue;
  const shortDestination=/^(?:no|ao|vem ao|volta ao|na|em) /.test(value.slice(name.length).trim());
  if(/flesch/i.test(source)&&value.startsWith(name+' ')&&shortDestination)return 'unverified';
  if(!new RegExp(`\\b${concertNoun}\\b`).test(value)||!performerRole(value,name))continue;
  const destination=`(?:(?:ao|a|aos|as|para|por|no|na|nos|nas|en|in|to|the|o|el|la) ){0,3}(?:${places[country].join('|')}|palcos?|escenarios?|stages?)(?: |$)`;
  const speculativeReturn=new RegExp(`\\b${modal} ${adverbs}(?:vir|voltar|retornar|regressar|regresar|volver|return) ${destination}`).test(value);
  const announcedReturn=new RegExp(`\\b(?:retorna|retornara|volta|voltara|vem|vira|regresa|vuelve) ${destination}`).test(value);
  const speculative=speculativePerformance.test(value)||speculativeReturn||plannedPerformance.test(value)||proposedPerformance.test(value);
  const announced=announcedPerformance.test(value)||announcedReturn;
  if(/flesch/i.test(source)&&(speculative||announced))return 'unverified';
  if(speculative)return 'unverified';
  if(announced)return 'reported';
 }
 return null;
}
