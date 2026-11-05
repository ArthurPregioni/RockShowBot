import {normalize} from './text.ts';
const places:Record<string,string[]>={
 BR:['brasil','brazil','sao paulo','rio de janeiro','curitiba','porto alegre','belo horizonte','brasilia','recife','fortaleza','goiania','salvador','maceio','ipatinga','foz do iguacu'],
 AR:['argentina','buenos aires','rosario','la plata'],CL:['chile','santiago','vina del mar'],UY:['uruguai','uruguay','montevideo'],PY:['paraguai','paraguay','asuncion'],PE:['peru','lima'],CO:['colombia','bogota','medellin'],EC:['equador','ecuador','quito','guayaquil'],BO:['bolivia','la paz'],VE:['venezuela','caracas'],GY:['guiana','guyana'],SR:['suriname'],GF:['guiana francesa','french guiana'],MX:['mexico'],US:['estados unidos','united states','eua','usa'],CA:['canada'],PT:['portugal','lisboa','porto'],ES:['espanha','espana','madrid'],GB:['reino unido','united kingdom','londres','london'],FR:['franca','france','paris'],DE:['alemanha','germany','berlim','berlin'],AU:['australia'],JP:['japao','japan'],
};
const words=(text:string,phrase:string)=>(` ${text} `).includes(` ${phrase} `);
export function concertNewsStatus(title:string,artist:string,country:string,source=''):'unverified'|'reported'|null{
 const value=normalize(title);
 if(!words(value,normalize(artist)))return null;
 if(!places[country]?.some(place=>words(value,place)))return null;
 // These are not positive claims about a future performance by this artist.
 if(/\b(?:tributo|cover|homenageia|homenagem|fashion show|desfile|resenha|documentario|relembre|relembra|como foi|o que aconteceu|nega|negou|desmente|desmentiu|cancel\w*|adiad\w*|afasta\w*|aposent\w*)\b/.test(value)||/\bnao (?:vem|vira|fara|tocara|vai|pretende|acontecera)\b/.test(value))return null;
 // Album and song names cannot establish the performing artist (e.g. "Ego Death").
 const withoutQuotes=normalize(title.replace(/[“"‘'][^”"’']+[”"’']/g,' '));
 if(!words(withoutQuotes,normalize(artist)))return null;
 const concert=/\b(?:shows?|turne|tour|conciertos?|concertos?|concerts?|festival|festivais|festivales|palcos?|apresentac\w*)\b/.test(value);
 const uncertain=/\b(?:rumor(?:es)?|possive[il]\w*|pode|podera|poderia|deve|devem|negocia\w*|cotad\w*|planeja\w*|especula\w*|em estudo)\b/.test(value);
 const announcement=/\b(?:anuncia\w*|confirma\w*|retorna|retornara|volta|voltara|vem|vira|fara|tocara|se apresentara|realizara)\b/.test(value);
 const shortDestination=/^(?:no|ao|vem ao|volta ao|na|em) /.test(value.slice(normalize(artist).length).trim());
 if(/flesch/i.test(source)&&value.startsWith(normalize(artist)+' ')&&(shortDestination||concert&&(uncertain||announcement)))return 'unverified';
 if(!concert)return null;
 if(uncertain)return 'unverified';
 return announcement?'reported':null;
}
