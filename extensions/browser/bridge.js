(() => {
  const api=globalThis.browser||chrome;
  if(window.top!==window||location.pathname!=='/music/browser-import')return;
  let delivered=false,busy=false;
  window.addEventListener('message',async event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.type!=='rockshowbot:request-artists'||busy||delivered)return;
    busy=true;
    try{
      let result;
      // The app can finish loading before tabs.create resolves in the background script.
      for(let attempt=0;attempt<8;attempt++){
        result=await api.runtime.sendMessage({type:'take-artists'});
        if(result?.ok)break;
        await new Promise(resolve=>setTimeout(resolve,400));
      }
      if(!result?.ok)throw new Error(result?.error||'Não foi possível receber os artistas.');
      delivered=true;
      window.postMessage({type:'rockshowbot:artists',...result.value},location.origin);
    }catch(e){window.postMessage({type:'rockshowbot:extension-error',error:e.message},location.origin);}
    finally{busy=false;}
  });
})();
