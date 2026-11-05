import {test} from 'node:test';
import assert from 'node:assert/strict';
import {concertNewsStatus} from '../../src/core/concert-evidence.ts';
import {newsItems} from '../../src/core/bot.ts';
import {renderAlert} from '../../src/core/events.ts';
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
test('Digest summarizes all items, limits source links and escapes article text',()=>{
 const events=Array.from({length:12},(_,i)=>({id:String(i),artist:'Band '+i,title:'Band pode tocar no Brasil <script>bad()</script>',country:'BR',city:'',starts_at:'',url:'https://news.example/story-'+i,source:'News <img src=x>',status:'unverified',notified:0}));
 const message=renderAlert('qa-digest',events,'https://shows.example');
 assert.equal(message.count,12);assert.match(message.body,/Mais 7 novidade/);assert.equal((message.body.match(/https:\/\//g)||[]).length,1);
 assert.equal((message.html.match(/href=/g)||[]).length,6);assert.ok(!message.html.includes('<script>'));assert.ok(!message.html.includes('<img'));assert.match(message.html,/&lt;script&gt;/);assert.match(message.html,/12 possibilidade/);
});
