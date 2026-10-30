// Requires a running LOCAL preview. Exercises the outbox without sending mail.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.ROCKSHOWBOT_QA_URL||'http://127.0.0.1:5173';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'This test must never run against production.');
const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:process.env.ROCKSHOWBOT_QA_CHROME||chromium.executablePath()}),client=await browser.newContext(),page=await client.newPage();
let original;const name='RSB Alert QA '+Date.now();
async function post(path,data,status=200){const response=await client.request.post(base+'/api/'+path,{headers:{Origin:base},data});assert.equal(response.status(),status,await response.text());return response.json();}
async function context(){return (await(await client.request.get(base+'/api/automation/context')).json());}
try{
 await page.goto(base+'/signin-with-chatgpt?return_to=/');await page.getByText('22 fontes oficiais',{exact:true}).waitFor();original=(await context()).settings;
 // A country unused by the local development fixtures isolates this flow without deleting user data.
 await post('settings',{email:'qa-alerts@example.test',notifications:true,countries:['SR']});
 for(const band of [name,name+' Cohead',name+' Later'])await post('artists',{name:band});
 const tip={artist:name,title:'Possível turnê',country:'SR',city:'',startsAt:'',url:'https://www.youtube.com/watch?v=abcdefghijk',source:'José Norberto Flesch',status:'unverified'};
 await post('events',{events:[tip]});let delivery=(await post('automation/alerts/prepare',{})).delivery;assert.ok(delivery);assert.equal(delivery.possibilities,1);
 const claims=await Promise.all([client.request.post(base+'/api/automation/alerts/claim',{data:{id:delivery.id}}),client.request.post(base+'/api/automation/alerts/claim',{data:{id:delivery.id}})]);assert.deepEqual(claims.map(r=>r.status()).sort(),[200,409]);
 await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-1'});assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 assert.equal((await post('events',{events:[{...tip,url:'https://another.example/article'}]})).added,0);assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 const show={artist:name,title:'Synthetic QA show',country:'SR',city:'Paramaribo/SR',startsAt:'2099-02-20',url:'https://www.ticketmaster.com.br/event/qa?utm_source=one',source:'QA official fixture',status:'listed'};
 await post('events',{events:[show]});delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.concerts,1);assert.equal(delivery.possibilities,0);
 assert.equal((await post('events',{events:[{...show,city:'Paramaribo, Suriname',url:'https://different.example/official',source:'Another QA source'}]})).added,0);
 await post('events',{events:[show,{...show,artist:name+' Cohead'}]});delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.count,1);assert.match(delivery.body,/Cohead/);
 const claimed=await post('automation/alerts/claim',{id:delivery.id});assert.equal(claimed.body,delivery.body);assert.equal(claimed.subject,delivery.subject);
 await post('automation/alerts/error',{id:delivery.id,status:'unknown',error:'LOCAL QA ambiguous result'});
 assert.equal((await post('automation/alerts/prepare',{})).needsReconciliation,true);await post('automation/alerts/claim',{id:delivery.id},409);
 await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-2'});assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 await post('events',{events:[{...show,artist:name+' Later'}]});assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 await post('events',{events:[{...show,startsAt:'2099-02-21'}]});delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.concerts,1);assert.match(delivery.body,/21\/02\/2099/);
 await post('automation/alerts/claim',{id:delivery.id});await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-3'});
 await post('automation/ack',{ids:['a'.repeat(64)]},409);
 assert.equal((await context()).pendingAlerts.length,0);
 const data=await(await client.request.get(base+'/api/dashboard')).json();assert.ok(!data.events.some(e=>e.artist===name&&e.status==='unverified'));
 console.log('QA OK: source/city deduplication, rumor suppression, shared bill count, late co-headliner receipt, distinct dates, concurrent claim, ambiguous send, frozen content, acknowledgment and old endpoint rejection. No emails sent.');
}finally{
 const data=await(await client.request.get(base+'/api/dashboard')).json();for(const event of data.events.filter(e=>e.artist.startsWith(name)))await post('events/remove',{id:event.id});for(const artist of data.artists.filter(a=>a.name.startsWith(name)))await post('artists/remove',{id:artist.id});
 if(original)await post('settings',{email:original.email,notifications:!!original.notifications,countries:original.countries});await browser.close();
}
