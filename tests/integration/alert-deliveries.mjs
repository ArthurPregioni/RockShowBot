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
 const tip={artist:name,title:name+' pode fazer show no Suriname',country:'SR',city:'',startsAt:'',url:'https://www.youtube.com/watch?v=abcdefghijk&qa='+encodeURIComponent(name),source:'José Norberto Flesch',status:'unverified'};
 await post('events',{events:[tip]});let delivery=(await post('automation/alerts/prepare',{})).delivery;assert.ok(delivery);assert.equal(delivery.possibilities,1);
 const claims=await Promise.all([client.request.post(base+'/api/automation/alerts/claim',{data:{id:delivery.id}}),client.request.post(base+'/api/automation/alerts/claim',{data:{id:delivery.id}})]);assert.deepEqual(claims.map(r=>r.status()).sort(),[200,409]);
 await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-1'});assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 assert.equal((await post('events',{events:[{...tip,url:'https://another.example/article'}]})).added,0);assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 const show={artist:name,title:'Synthetic QA show',country:'SR',city:'Paramaribo/SR',startsAt:'2099-02-20',url:'https://www.ticketmaster.com.br/event/qa-'+encodeURIComponent(name)+'?utm_source=one',source:'QA official fixture',status:'listed'};
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
 // Promotion in place: a dated, already-notified rumor becomes a confirmed date with a resolved city.
 await post('events',{events:[{...tip,startsAt:'2099-03-01'}]});delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.possibilities,1);
 await post('automation/alerts/claim',{id:delivery.id});await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-4'});
 await post('events',{events:[{...show,startsAt:'2099-03-01'}]});delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.concerts,1);assert.equal(delivery.possibilities,0);
 await post('automation/alerts/claim',{id:delivery.id});await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-5'});

 // Press announcements are not rumors and remain off the email queue until primary verification.
 const press={...show,startsAt:'2099-04-01',source:'Cooperativa',url:'https://cooperativa.cl/noticias/qa',status:'reported'};
 await post('events',{events:[press]});assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 let dashboard=await(await client.request.get(base+'/api/dashboard')).json();assert.equal(dashboard.events.find(e=>e.artist===name&&e.starts_at==='2099-04-01').status,'reported');
 await post('events',{events:[{...press,status:'listed'}]});assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 await post('events',{events:[{...show,startsAt:'2099-04-01'}]});delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.concerts,1);
 await post('automation/alerts/claim',{id:delivery.id});await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-6'});
 // Confirmed concerts and rumors created together produce separate frozen summaries.
 const mixedShow={...show,startsAt:'2099-04-10'},mixedRumor={...tip,startsAt:'2099-04-11'};
 await post('events',{events:[mixedShow,mixedRumor]});delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.concerts,1);assert.equal(delivery.possibilities,0);
 assert.doesNotMatch(delivery.body,/RUMORES/);
 await post('events',{events:[{...mixedShow,title:'Updated event title'}]});await post('automation/alerts/claim',{id:delivery.id},409);
 delivery=(await post('automation/alerts/prepare',{})).delivery;assert.match(delivery.body,/10\/04\/2099/);
 await post('automation/alerts/claim',{id:delivery.id});await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-7'});
 delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.concerts,0);assert.equal(delivery.possibilities,1);assert.doesNotMatch(delivery.body,/SHOWS CONFIRMADOS/);
 await post('automation/alerts/claim',{id:delivery.id});await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-8'});
 // Correcting the evidence category of an already-sent announcement does not resend the same dated facts.
 await post('events',{events:[{...mixedRumor,status:'reported',source:'Billboard Argentina',url:'https://billboard.ar/shows/qa'}]});
 await post('events',{events:[{...show,startsAt:mixedRumor.startsAt}]});assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 // Replay the real Santiago Centro + changed URL problem, including deleting and rediscovering the row.
 await post('settings',{email:'qa-alerts@example.test',notifications:true,countries:['SR','CL']});
 const chile={...show,country:'CL',city:'Santiago Centro',startsAt:'2099-05-08',url:'https://puntoticket.com/evento/qa-'+encodeURIComponent(name)};
 await post('events',{events:[chile]});delivery=(await post('automation/alerts/prepare',{})).delivery;assert.equal(delivery.count,1);
 await post('automation/alerts/claim',{id:delivery.id});await post('automation/alerts/ack',{id:delivery.id,messageId:'LOCAL-QA-NO-EMAIL-9'});
 dashboard=await(await client.request.get(base+'/api/dashboard')).json();await post('events/remove',{id:dashboard.events.find(e=>e.artist===name&&e.country==='CL').id});
 await post('events',{events:[{...chile,city:'Santiago',url:'https://cdnp.puntoticket.com/qa-'+encodeURIComponent(name)}]});assert.equal((await post('automation/alerts/prepare',{})).delivery,null);
 await post('automation/ack',{ids:['a'.repeat(64)]},409);
 assert.equal((await context()).pendingAlerts.length,0);
 const data=await(await client.request.get(base+'/api/dashboard')).json();assert.ok(!data.events.some(e=>e.artist===name&&e.status==='unverified'&&['','2099-03-01'].includes(e.starts_at)));assert.ok(data.events.some(e=>e.artist===name&&e.status==='listed'&&e.notified===1&&e.starts_at==='2099-04-11'));
 console.log('QA OK: source/city deduplication, rumor suppression, shared bill count, late co-headliner receipt, distinct dates, concurrent claim, ambiguous send, frozen content, acknowledgment and old endpoint rejection. Separated confidence batches, press announcements excluded, updated content invalidates claims, persistent receipts across deleted rows and Chile city aliases. No emails sent.');
}finally{
 const data=await(await client.request.get(base+'/api/dashboard')).json();for(const event of data.events.filter(e=>e.artist.startsWith(name)))await post('events/remove',{id:event.id});for(const artist of data.artists.filter(a=>a.name.startsWith(name)))await post('artists/remove',{id:artist.id});
 if(original)await post('settings',{email:original.email,notifications:!!original.notifications,countries:original.countries});await browser.close();
}
