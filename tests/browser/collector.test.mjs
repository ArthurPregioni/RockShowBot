import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

let browser;
const fixture=await readFile(new URL('../fixtures/apple-library-artists.html',import.meta.url),'utf8');
const source=fileURLToPath(new URL('../../extensions/browser/collector.js',import.meta.url));
const appleURL='https://music.apple.com/br/library/artists/r.k23lvvs';
before(async()=>{browser=await chromium.launch({headless:true,args:['--disable-gpu'],...(process.env.ROCKSHOWBOT_CHROMIUM?{executablePath:process.env.ROCKSHOWBOT_CHROMIUM}:{})});});
after(async()=>{await browser?.close();});
async function open(html=fixture,url=appleURL){
 const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto(url);await page.addScriptTag({path:source});return page;
}

test('Apple selected-artist URL reads name-only options and excludes the adjacent album',async()=>{
 const page=await open();try{
  const result=await page.evaluate(()=>RockShowBotCollector.readArtists(document,location));
  assert.deepEqual(result.artists.map(a=>a.name),['a-ha','Angra','Metallica']);
  assert.equal(result.artists.some(a=>a.name.includes('Hunting High')),false);
 }finally{await page.close();}
});
test('Apple never mistakes a detail pane for the artist library if the list is missing',async()=>{
 const page=await open('<main><div data-testid="artist-detail-container"><a href="/br/artist/a-ha/166566">a-ha</a><a href="/br/library/artists/r.k23lvvs">Hunting High and Low (Deluxe Edition)</a></div></main>');
 try{await assert.rejects(()=>page.evaluate(()=>RockShowBotCollector.readArtists(document,location)),/localizar a lista/);}finally{await page.close();}
});
test('Apple reads all asynchronously rendered virtual rows and restores the list scroll',async()=>{
 const page=await open();try{
  await page.evaluate(()=>{
   const scroll=document.querySelector('#scrollable-page-override'),rows=document.querySelector('[data-testid="virtual-rows"]');
   rows.style.height=(90*54)+'px';rows.setAttribute('aria-rowcount','90');let timer;
   window.renderRows=()=>{
    const start=Math.min(87,Math.floor(scroll.scrollTop/54));rows.replaceChildren();
    for(let i=start;i<Math.min(90,start+4);i++){
     const option=document.createElement('div');option.setAttribute('role','option');option.dataset.testid='library-artists-component';option.style.cssText=`position:absolute;top:${i*54}px;height:54px;`;
     const name=document.createElement('span');name.className='artist-name';name.textContent=i===0?'a-ha':`Artist ${String(i).padStart(3,'0')}`;option.append(name);rows.append(option);
    }
   };
   scroll.addEventListener('scroll',()=>{clearTimeout(timer);const placeholder=document.createElement('div');placeholder.className='artist-placeholder';rows.append(placeholder);timer=setTimeout(window.renderRows,35);});
   scroll.scrollTop=54*20;window.renderRows();
  });
  const original=await page.locator('#scrollable-page-override').evaluate(el=>el.scrollTop);
  const result=await page.evaluate(()=>RockShowBotCollector.collect({stepWait:10,bottomWait:70,maxMs:15000}));
  assert.equal(result.artists.length,90);assert.equal(result.captureFormat,2);assert.equal(result.limited,false);
  assert.ok(result.artists.some(a=>a.name==='a-ha'));assert.ok(result.artists.some(a=>a.name==='Artist 089'));
  assert.equal(await page.locator('#scrollable-page-override').evaluate(el=>el.scrollTop),original);
 }finally{await page.close();}
});
test('Apple uses the scrollable ancestor when the list itself does not own the scrollbar',async()=>{
 const page=await open();try{
  const ids=await page.evaluate(()=>{
   const list=document.querySelector('[data-testid="artist-list-container"]');
   document.querySelector('#scrollable-page-override').style.cssText='height:auto;overflow:visible';
   const parent=document.createElement('section');parent.id='artist-scroll-parent';parent.style.cssText='height:100px;overflow:auto';list.replaceWith(parent);parent.append(list);
   return RockShowBotCollector.scrollContainers(list).map(el=>el.id);
  });
  // A legacy-known scroll container still exists here; remove that hint to test the ancestor.
  const ancestor=await page.evaluate(()=>{
   const el=document.querySelector('#scrollable-page-override');el.id='not-scrollable';el.className='';
   return RockShowBotCollector.scrollContainers(document.querySelector('[data-testid="artist-list-container"]')).map(el=>el.id);
  });
  assert.deepEqual(ancestor,['artist-scroll-parent']);assert.ok(ids.includes('scrollable-page-override'));
 }finally{await page.close();}
});
test('A bounded partial capture is flagged rather than reported as the whole library',async()=>{
 const page=await open();try{
  const result=await page.evaluate(()=>RockShowBotCollector.collect({stepWait:5,bottomWait:100,maxRounds:1}));
  assert.equal(result.limited,true);assert.ok(!result.artists.some(a=>a.name.includes('Deluxe')));
 }finally{await page.close();}
});
test('Spotify continues reading only artist links in its artist collection',async()=>{
 const page=await open('<main><a href="/artist/ArtistAlpha"><span dir="auto">Angra</span></a><a href="/album/AlbumId">Album</a><a href="/playlist/PlaylistId">Playlist</a></main>','https://open.spotify.com/collection/artists');
 try{assert.deepEqual((await page.evaluate(()=>RockShowBotCollector.readArtists(document,location))).artists.map(a=>a.name),['Angra']);}finally{await page.close();}
});
