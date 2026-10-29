const api = globalThis.browser || chrome;
const bridgeID = 'rockshowbot-import-bridge';
function siteOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '') || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname))) throw new Error('Use a URL HTTPS do seu RockShowBot, sem caminho. HTTP só é permitido em localhost/127.0.0.1.');
  return url.origin;
}
async function capture(message) {
  const origin = siteOrigin(message.origin);
  if (!await api.permissions.contains({origins:[origin+'/*']})) throw new Error('Autorize o acesso somente ao endereço do seu RockShowBot.');
  const tab = await api.tabs.get(message.tabId);
  const url = new URL(tab.url);
  if (url.protocol !== 'https:' || !['music.apple.com','open.spotify.com'].includes(url.hostname)) throw new Error('Acione a extensão na aba Apple Music ou Spotify aberta na biblioteca de artistas.');
  await api.scripting.executeScript({target:{tabId:tab.id},files:['collector.js']});
  const results = await api.scripting.executeScript({target:{tabId:tab.id},func:async()=>{
    try{return {ok:true,value:await globalThis.RockShowBotCollector.collect()};}catch(e){return {ok:false,error:e.message};}
  }});
  const result = results[0]?.result;
  if (!result?.ok) throw new Error(result?.error || 'Não foi possível ler os artistas da aba.');
  const value = result.value;
  if (!['apple','spotify'].includes(value.provider) || !Array.isArray(value.artists) || !value.artists.length || value.artists.length > 4000) throw new Error('A biblioteca não retornou uma lista válida de artistas.');
  const scripts = await api.scripting.getRegisteredContentScripts({ids:[bridgeID]});
  if(scripts.length) await api.scripting.unregisterContentScripts({ids:[bridgeID]});
  await api.scripting.registerContentScripts([{id:bridgeID,matches:[origin+'/music/browser-import*'],js:['bridge.js'],runAt:'document_start',allFrames:false}]);
  await api.storage.local.set({siteOrigin:origin});
  const stored=await api.storage.session.get(null);
  const expired=Object.entries(stored).filter(([key,data])=>key.startsWith('import:')&&data.expires<Date.now()).map(([key])=>key);
  if(expired.length)await api.storage.session.remove(expired);
  const target = await api.tabs.create({url:origin+'/music/browser-import'});
  await api.storage.session.set({['import:'+target.id]:{origin,expires:Date.now()+600000,...value}});
  return {count:value.artists.length};
}
async function take(sender) {
  if(sender.frameId!==0||!sender.tab?.id||!sender.url)throw new Error('Aba de destino inválida.');
  const url=new URL(sender.url),key='import:'+sender.tab.id;
  const record=(await api.storage.session.get(key))[key];
  if(!record||record.expires<Date.now())throw new Error('A leitura expirou ou já foi recebida. Volte à aba de música e importe novamente.');
  if(url.origin!==record.origin||url.pathname!=='/music/browser-import')throw new Error('Endereço de destino inválido.');
  await api.storage.session.remove(key);
  return {captureFormat:record.captureFormat,provider:record.provider,artists:record.artists,limited:record.limited,notice:record.notice};
}
api.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message || typeof message!=='object')return false;
  let work;
  if(message.type==='capture'&&sender.url===api.runtime.getURL('popup.html')) work=capture(message);
  else if(message.type==='take-artists') work=take(sender);
  else return false;
  work.then(value=>respond({ok:true,value}),error=>respond({ok:false,error:error.message||'Não foi possível concluir a importação.'}));
  return true;
});
api.tabs.onRemoved.addListener(tabId=>{api.storage.session.remove('import:'+tabId).catch(()=>{});});
