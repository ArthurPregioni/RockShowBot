"use client";
import {useEffect,useState} from 'react';
import {ArrowLeft,Check,Cloud,Download,Music2,RefreshCw} from 'lucide-react';
type Artist={id:string;name:string};
async function api(path:string,body:unknown){
  const r=await fetch('/api/music/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await r.json() as {error?:string;candidates:Artist[];added:number};if(!r.ok)throw new Error(result.error||'Não foi possível importar os artistas.');return result;
}
export default function BrowserImport(){
  const [artists,setArtists]=useState<Artist[]>([]),[provider,setProvider]=useState(''),[selected,setSelected]=useState(new Set<string>()),[filter,setFilter]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState<number|null>(null),[origin,setOrigin]=useState('');
  useEffect(()=>{
    setOrigin(window.location.origin);let active=true,received=false;
    const listener=async(event:MessageEvent)=>{
      if(event.source!==window||event.origin!==window.location.origin)return;
      if(event.data?.type==='rockshowbot:extension-error'&&!received){setError(String(event.data.error||'Falha na leitura.'));return;}
      if(event.data?.type!=='rockshowbot:artists'||received)return;
      received=true;setBusy(true);setError('');
      try{
        const result=await api('browser/prepare',{provider:event.data.provider,artists:event.data.artists});
        if(active){setArtists(result.candidates);setProvider(event.data.provider);setNotice(event.data.limited?'A extensão atingiu o limite de leitura. A lista pode estar incompleta.':String(event.data.notice||'Confira os artistas antes de importar.'));}
      }catch(e){if(active){received=false;setError((e as Error).message);}}
      finally{if(active)setBusy(false);}
    };
    window.addEventListener('message',listener);
    const ask=()=>window.postMessage({type:'rockshowbot:request-artists'},window.location.origin);
    ask();const timer=setInterval(()=>{if(!received)ask();},1000);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('message',listener);};
  },[]);
  async function save(){setBusy(true);setError('');try{const result=await api('import',{ids:[...selected]});setDone(result.added);setArtists([]);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="browser-import-page"><a className="text-button" href="/"><ArrowLeft size={16}/>Voltar ao radar</a><div className="eyebrow">APPLE MUSIC & SPOTIFY</div><h1>Seus artistas, direto da biblioteca.</h1><p className="browser-lead">Importe pelo navegador com a extensão RockShowBot. Você usa sua conta no site de música e escolhe os artistas aqui antes de salvar.</p>
    {error&&<div className="alert error" role="alert">{error}</div>}
    {done!==null?<section className="panel browser-selection"><Check size={28}/><h2>{done} artista(s) adicionado(s) ao radar</h2><p>Nomes que já estavam na lista foram ignorados. Seus artistas estão salvos na nuvem.</p><a className="button" href="/">Abrir radar e buscar shows</a></section>:
    artists.length>0?<section className="panel browser-selection"><span className="eyebrow">LEITURA RECEBIDA DA EXTENSÃO</span><h2>{provider==='apple'?'Apple Music':'Spotify'} · {artists.length} artistas</h2><p role="status">{notice}</p><input aria-label="Filtrar artistas da biblioteca" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filtrar por nome"/><button className="text-button" disabled={busy} onClick={()=>setSelected(selected.size===artists.length?new Set():new Set(artists.map(a=>a.id)))}>{selected.size===artists.length?'Desmarcar todos':'Selecionar todos'}</button><div className="candidate-list">{artists.filter(a=>a.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(artist=><label className="checkbox-row" key={artist.id}><input type="checkbox" disabled={busy} checked={selected.has(artist.id)} onChange={()=>setSelected(old=>{const copy=new Set(old);copy.has(artist.id)?copy.delete(artist.id):copy.add(artist.id);return copy;})}/>{artist.name}</label>)}</div><button className="button full-width" disabled={busy||!selected.size} onClick={save}>{busy?<RefreshCw size={17} className="spinning"/>:<Check size={17}/>}Importar {selected.size} artista(s)</button><p className="field-help">A seleção expira em 10 minutos. Nenhum artista é adicionado antes da confirmação.</p></section>:
    <section className="panel browser-instructions"><h2>{busy?'Recebendo artistas…':'Comece pela extensão'}</h2><ol><li><strong>Instale a extensão neste navegador.</strong><div className="extension-downloads"><a className="button secondary" href="/downloads/rockshowbot-firefox.zip" download><Download size={16}/>Firefox</a><a className="button secondary" href="/downloads/rockshowbot-chromium.zip" download><Download size={16}/>Chrome / Chromium / Edge</a></div><details><summary>Como instalar no Firefox</summary><p>Extraia o ZIP. Abra <code>about:debugging#/runtime/this-firefox</code>, clique em <strong>Carregar extensão temporária</strong> e selecione <code>manifest.json</code> da pasta extraída. A instalação é temporária e termina ao reiniciar o Firefox; os artistas já importados ficam salvos.</p></details><details><summary>Como instalar no Chrome, Chromium ou Edge</summary><p>Extraia o ZIP. Abra <code>chrome://extensions</code> (ou <code>edge://extensions</code>), ative <strong>Modo do desenvolvedor</strong> e use <strong>Carregar sem compactação</strong> para selecionar a pasta extraída.</p></details></li><li><strong>Entre no serviço e abra a lista de artistas.</strong><p><a className="text-button" target="_blank" rel="noreferrer" href="https://music.apple.com/br/library/artists">Abrir Apple Music <Music2 size={15}/></a> ou <a className="text-button" target="_blank" rel="noreferrer" href="https://open.spotify.com/collection/artists">abrir Spotify</a>. No Spotify, expanda Sua Biblioteca e selecione Artistas. Faça login diretamente no serviço, se solicitado.</p></li><li><strong>Na aba de música, clique na extensão RockShowBot.</strong><p>Confira o destino <code>{origin||'URL deste painel'}</code> e clique em <strong>Ler artistas e abrir seleção</strong>. Autorize somente o endereço do seu painel. Aguarde a rolagem da biblioteca e a nova aba com a seleção.</p></li><li><strong>Selecione os artistas e confirme a importação.</strong><p>A extensão consulta a interface que seu navegador já mostra. A leitura pode ser parcial se o serviço limitar a lista ou mudar a página; confira o resultado.</p></li></ol></section>}
    <div className="source-note"><Cloud size={18}/><p>Depois da importação, as buscas de shows e os alertas continuam na nuvem. O computador só precisa estar ligado durante a leitura da biblioteca. Não há sincronização contínua com o streaming.</p></div><p className="muted small">A extensão não lê senha ou cookies e não usa endpoints privados do serviço. Apenas nomes de artistas são enviados ao seu painel, com sua confirmação. A instalação manual ainda não tem assinatura de loja.</p>
  </main>;
}
