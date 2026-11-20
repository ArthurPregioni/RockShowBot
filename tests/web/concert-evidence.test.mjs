import {test} from 'node:test';
import assert from 'node:assert/strict';
import {concertNewsStatus} from '../../src/core/concert-evidence.ts';
import {newsItems} from '../../src/core/bot.ts';
import {renderAlert} from '../../src/core/events.ts';
import {screenFinding} from '../../src/features/radar/sources.ts';
test('Rejects real categories of irrelevant articles from the bad digest',()=>{
 for(const [artist,title,country]of [
  ['Aerosmith','Aerosmith faz show com Dave Grohl nos EUA','BR'],
  ['Avenged Sevenfold','Avenged Sevenfold cancela show na Coreia do Sul; Megadeth substitui','BR'],
  ['Pink Floyd','Tributo ao Pink Floyd agita a noite com show em Araras','BR'],
  ['Chico Buarque','Jazz Fusion homenageia Chico Buarque em show gratuito em Ipatinga','BR'],
  ['Led Zeppelin','O show histórico do Led Zeppelin em 2007: o que aconteceu','BR'],
  ['Creed','Esme Creed-Miles attends Victoria’s Secret Fashion Show no Brasil','BR'],
  ['Death','Paramore anuncia shows no Brasil na turnê de “Ego Death At A Bachelorette Party”','BR'],
  ['Red Hot Chili Peppers','Red Hot Chili Peppers nega show anunciado na Argentina','AR'],
  ['The Offspring','Noodles se afasta de shows com The Offspring por saúde no Brasil','BR'],
  ['Radiohead','Radiohead: diretor do Lollapalooza chama banda de sonho para o festival no Brasil','BR'],
  ['Fresno','Simple Plan anuncia turnê no Brasil com Fresno','AR'],
  ['U2','U2 anuncia quarto e último show no Brasil','CL'],
  ['Bon Jovi','Bon Jovi anuncia novos shows em estádios pelo mundo','BR'],
 ])assert.equal(concertNewsStatus(title,artist,country),null,title);
});
test('Requires an explicit future concert claim and a destination supported by the headline',()=>{
 assert.equal(concertNewsStatus('Foo Fighters pode fazer show no Brasil em 2027','Foo Fighters','BR'),'unverified');
 assert.equal(concertNewsStatus('Placebo anuncia shows em Buenos Aires','Placebo','AR'),'reported');
 assert.equal(concertNewsStatus('The Strokes no Brasil!','The Strokes','BR','José Norberto Flesch'),'unverified');
 assert.equal(concertNewsStatus('The Strokes no Brasil!','The Strokes','BR','Portal genérico'),null);
 const xml='<rss><item><title>Foo Fighters pode fazer show no Brasil</title><link>https://news.example/concert</link><source>Jornal</source></item></rss>';
 assert.equal(newsItems(xml,'Foo Fighters','BR').length,1);assert.equal(newsItems(xml,'Foo Fighters','AR').length,0);
});
test('Publisher names, unrelated speculation and longer artist names never establish concert evidence',()=>{
 for(const [artist,title,country,source]of [
  ['Aerosmith','Aerosmith pode anunciar show nos EUA - Rolling Stone Brasil','BR','Rolling Stone Brasil'],
  ['Foo Fighters','Foo Fighters pode lançar álbum depois de show no Brasil','BR','Jornal'],
  ['Foo Fighters','Foo Fighters fala sobre álbum; fã diz que pode haver show no Brasil','BR','Jornal'],
  ['Rush','Big Time Rush pode fazer show no Brasil','BR','Jornal'],
  ['Creed','Esme Creed-Miles pode fazer show no Brasil','BR','Jornal'],
  ['Foo Fighters','Foo Fighters anuncia livro sobre show no Brasil','BR','Jornal'],
  ['Foo Fighters','Foo Fighters pode voltar ao álbum depois de show no Brasil','BR','Jornal'],
  ['Foo Fighters','Foo Fighters retorna ao álbum gravado em show no Brasil','BR','Jornal'],
 ]){
  assert.equal(concertNewsStatus(title,artist,country,source),null,title);
  const xml=`<rss><item><title><![CDATA[${title}]]></title><link>https://news.example/article</link><source>${source}</source></item></rss>`;
  assert.equal(newsItems(xml,artist,country).length,0,'RSS must reject '+title);
 }
 assert.equal(concertNewsStatus('Foo Fighters anuncia show no Brasil e pode lançar álbum','Foo Fighters','BR','Jornal'),'reported');
});
test('Keeps genuine speculative performances, including Spanish headlines and quoted artist names',()=>{
 for(const [artist,title,country]of [
  ['Foo Fighters','Foo Fighters pode fazer show no Brasil','BR'],
  ['Foo Fighters','Rumores de uma possível turnê do Foo Fighters no Brasil','BR'],
  ['Foo Fighters','Foo Fighters negocia shows no Brasil','BR'],
  ['Foo Fighters','"Foo Fighters" pode anunciar uma nova turnê no Brasil','BR'],
  ['Placebo','Placebo podría regresar a Chile con conciertos','CL'],
  ['Placebo','Posible concierto de Placebo en Chile','CL'],
 ])assert.equal(concertNewsStatus(title,artist,country,'Jornal'),'unverified',title);
 assert.equal(concertNewsStatus('Simple Plan anuncia turnê no Brasil com All Time Low e Fresno','Fresno','BR','Jornal'),'reported');
});
test('A place inside a longer foreign name is not evidence for the watched country',()=>{
 for(const [title,country]of [
  ['Metallica pode fazer show em El Salvador','BR'],
  ['Metallica pode fazer show em San Salvador','BR'],
  ['Metallica pode fazer show em Porto Alegre','PT'],
  ['Metallica anuncia show em Porto Rico','PT'],
  ['Metallica pode fazer show na Guiana Francesa','GY'],
 ])assert.equal(concertNewsStatus(title,'Metallica',country,'Jornal'),null,title);
 assert.equal(concertNewsStatus('Metallica pode fazer show em Salvador','Metallica','BR','Jornal'),'unverified');
 assert.equal(concertNewsStatus('Metallica pode fazer show em Porto Alegre','Metallica','BR','Jornal'),'unverified');
 assert.equal(concertNewsStatus('Metallica pode fazer show no Porto','Metallica','PT','Jornal'),'unverified');
 assert.equal(concertNewsStatus('Metallica pode fazer show na Guiana Francesa','Metallica','GF','Jornal'),'unverified');
});
test('A finding is cut to its stored title before classification, and a refusal says why',()=>{
 const tip={artist:'Foo Fighters',title:'possível turnê no Brasil',country:'BR',city:'',startsAt:'',url:'https://example.com/a?utm_source=x',source:'Dica pessoal',status:'unverified'};
 assert.match(screenFinding(tip,'Foo Fighters').refused,/título precisa citar o artista/);
 assert.deepEqual(screenFinding({...tip,title:'Foo Fighters pode fazer show no Brasil'},'Foo Fighters'),{status:'unverified',title:'Foo Fighters pode fazer show no Brasil',url:'https://example.com/a',date:''});
 assert.equal(screenFinding({...tip,title:'Foo Fighters anuncia show no Brasil'},'Foo Fighters').status,'reported');
 assert.match(screenFinding({...tip,url:'javascript:alert(1)'},'Foo Fighters').refused,/link/);
 assert.match(screenFinding({...tip,startsAt:'2020-01-01'},'Foo Fighters','2026-11-19').refused,/data/);
 assert.equal(screenFinding({...tip,status:'listed',startsAt:'2030-01-01'},'Foo Fighters','2026-11-19').status,'listed');
 // The classifier rescans the title per occurrence of the name: 200 KB took about 12 s before the cut.
 const started=performance.now(),long=screenFinding({...tip,title:'x show brasil '+'rush '.repeat(40000)},'Rush');
 assert.ok(performance.now()-started<1000);assert.ok('refused' in long);
 assert.equal(screenFinding({...tip,title:'Foo Fighters pode fazer show no Brasil '+'x'.repeat(1000)},'Foo Fighters').title.length,400);
 const feed=`<rss><item><title>Rush pode fazer show no Brasil ${'rush '.repeat(40000)}</title><link>https://news.example/long</link><source>Jornal</source></item></rss>`;
 const read=performance.now(),items=newsItems(feed,'Rush','BR');
 assert.ok(performance.now()-read<1000);assert.equal(items[0].title.length,400);
});
test('Digest summarizes all items, limits source links and escapes article text',()=>{
 const events=Array.from({length:12},(_,i)=>({id:String(i),artist:'Band '+i,title:'Band pode tocar no Brasil <script>bad()</script>',country:'BR',city:'',starts_at:'',url:'https://news.example/story-'+i,source:'News <img src=x>',status:'unverified',notified:0}));
 const message=renderAlert('qa-digest',events,'https://shows.example');
 assert.equal(message.count,12);assert.match(message.body,/Mais 7 novidade/);assert.equal((message.body.match(/https:\/\//g)||[]).length,1);
 assert.equal((message.html.match(/href=/g)||[]).length,6);assert.ok(!message.html.includes('<script>'));assert.ok(!message.html.includes('<img'));assert.match(message.html,/&lt;script&gt;/);assert.match(message.html,/12 possibilidade/);
});
