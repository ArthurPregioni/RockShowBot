const api=globalThis.browser||chrome;
const field=document.querySelector('#site'),button=document.querySelector('#capture'),status=document.querySelector('#status');
document.querySelector('#version').textContent='v'+api.runtime.getManifest().version;
const defaultOrigin='https://rockshowbot-arthur.socialyak11.chatgpt.site';
api.storage.local.get('siteOrigin').then(value=>{field.value=value.siteOrigin||defaultOrigin;});
button.addEventListener('click',async()=>{
  status.className='';button.disabled=true;
  try{
    const url=new URL(field.value.trim());
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Informe apenas a origem HTTPS do painel, sem caminho.');
    // Call permissions.request directly from this click, before awaiting other work.
    const granted=await api.permissions.request({origins:[url.origin+'/*']});
    if(!granted)throw new Error('É necessário autorizar o endereço do seu painel para receber a seleção.');
    const [tab]=await api.tabs.query({active:true,currentWindow:true});
    status.textContent='Lendo e rolando a lista de artistas… mantenha esta janela aberta. Pode levar até 90 segundos.';
    const result=await api.runtime.sendMessage({type:'capture',tabId:tab.id,origin:url.origin});
    if(!result?.ok)throw new Error(result?.error||'Falha ao ler a biblioteca.');
    status.textContent=`${result.value.count} artista(s). Confira e confirme a importação na nova aba.`;
  }catch(e){status.className='error';status.textContent=e.message;}
  finally{button.disabled=false;}
});
