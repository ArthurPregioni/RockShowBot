/* Reads the rendered library in the extension's isolated world after a user action. */
globalThis.RockShowBotCollector = (() => {
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const appleListSelector = '[data-testid="artist-list-container"], [data-testid="library-artists"], .library-artists, [data-testid="artist-list"]';
  const detailSelector = '[data-testid="artist-detail-container"], [data-testid="artist-detail-grid"], [data-testid="library-album-component"], [data-testid="now-playing-widget"], [data-testid="recommendations"], footer';

  function libraryRoot(doc, location) {
    if (location.hostname === 'music.apple.com') {
      if (!/\/library\/artists(?:\/|$)/.test(location.pathname)) throw new Error('No Apple Music, abra Biblioteca → Artistas para importar a lista.');
      // Apple keeps the selected artist and their albums beside a separate virtualized list.
      // Never fall back to main: its artist links can label albums in the detail pane.
      const root = doc.querySelector(appleListSelector);
      if (!root) throw new Error('Não consegui localizar a lista de artistas do Apple Music. Aguarde a biblioteca carregar e tente novamente. O painel de álbuns não será usado como lista de artistas.');
      return {provider:'apple',root};
    }
    if (location.hostname === 'open.spotify.com') {
      const dedicated = /^\/(?:intl-[a-z]+\/)?collection\/artists\/?$/.test(location.pathname);
      const root = dedicated ? doc.querySelector('main, [role="main"]') : doc.querySelector('[data-testid="your-library"], [data-testid="library-root"], #Desktop_LeftSidebar_Id');
      if (!root) throw new Error('No Spotify, abra Sua Biblioteca e selecione Artistas. Expanda a barra lateral se necessário.');
      return {provider:'spotify',root};
    }
    throw new Error('Abra a biblioteca de artistas em music.apple.com ou open.spotify.com e clique na extensão nessa aba.');
  }

  function readArtists(doc, location) {
    const {provider,root} = libraryRoot(doc,location);
    const found = new Map();
    function add(value) {
      const name = String(value || '').replace(/\s+/g,' ').trim();
      if (name && name.length <= 160 && !/^(artistas?|artists?|play|reproduzir|shuffle|aleatorio)$/i.test(normalize(name))) found.set(normalize(name),{id:normalize(name),name});
    }
    if (provider === 'apple') {
      // Selectors verified against Apple's public List component. Artist entries are
      // role=option divs, not anchors. Album titles must never be collected globally.
      for (const option of root.querySelectorAll('[data-testid="library-artists-component"][role="option"], [data-testid="artist-list-item"], [role="option"]')) {
        if (option.closest(detailSelector)) continue;
        const name = option.querySelector('.artist-name, [data-testid="artist-name"], [data-testid="title"]');
        if (name) add(name.textContent);
      }
      if (found.size) return {provider,artists:[...found.values()]};
    }
    // Compatibility for link-based library layouts, always scoped to the library list.
    for (const anchor of root.querySelectorAll('a[href]')) {
      if (anchor.closest(detailSelector)) continue;
      let url;try {url = new URL(anchor.getAttribute('href'),location.href);}catch{continue;}
      const valid = provider === 'apple'
        ? url.hostname === 'music.apple.com' && /\/(?:artist\/[^/]+\/|library\/artists?\/)[^/?#]+\/?$/.test(url.pathname)
        : url.hostname === 'open.spotify.com' && /^\/(?:intl-[a-z]+\/)?artist\/[A-Za-z0-9]+\/?$/.test(url.pathname);
      if (!valid) continue;
      const title = anchor.querySelector('[data-testid="artist-name"], [data-testid="entityTitle"], [data-testid="listrow-title"], [dir="auto"]');
      const labelled = (anchor.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>doc.getElementById(id)).find(node=>node?.textContent?.trim());
      const rowTitle = anchor.closest('[role="row"], [data-testid="library-item"]')?.querySelector('[data-testid="entityTitle"], [data-testid="listrow-title"]');
      add(title?.textContent || labelled?.textContent || rowTitle?.textContent || anchor.getAttribute('title') || anchor.textContent || anchor.getAttribute('aria-label'));
    }
    return {provider,artists:[...found.values()]};
  }

  function scrollContainers(root) {
    const scrollable = el => el.id === 'scrollable-page-override' || el.classList.contains('scrollable-container') || el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(el).overflowY);
    const inside=[root,...root.querySelectorAll('#scrollable-page-override, .scrollable-container, div,ul,section')].filter(scrollable);
    // Prefer the list's own scroll area. Scrolling its outer page as well can move
    // the list offscreen and make the provider stop rendering virtualized rows.
    if(inside.length)return [...new Set(inside)];
    for(let parent=root.parentElement;parent;parent=parent.parentElement)if(scrollable(parent))return [parent];
    return [];
  }

  async function collect(options = {}) {
    const {root,provider} = libraryRoot(document,window.location);
    if (!root.getClientRects().length) throw new Error('A lista de artistas está oculta. No Apple Music, use Voltar a Artistas para mostrar a lista e acione a extensão novamente.');
    const found = new Map();
    const maxArtists = 4000, maxRounds = options.maxRounds ?? 300, maxMs = options.maxMs ?? 90000;
    const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
    const stepWait = options.stepWait ?? 250, bottomWait = options.bottomWait ?? 1800;
    let lastAdded = Date.now(), lastChange = Date.now(), limited = false;
    const add = () => {
      for(const artist of readArtists(document,window.location).artists) {
        if(found.has(artist.id))continue;
        if(found.size>=maxArtists){limited=true;break;}
        found.set(artist.id,artist);lastAdded=Date.now();
      }
    };
    const pending = () => !!root.querySelector('.artist-placeholder, [data-testid="loading-spinner"], [aria-busy="true"], [role="progressbar"]');
    const observer = new MutationObserver(()=>{lastChange=Date.now();add();});
    observer.observe(root,{subtree:true,childList:true,characterData:true});
    const started = Date.now(), scrollers = scrollContainers(root), positions = scrollers.map(el=>[el,el.scrollTop]);
    try {
      add();
      if (options.scroll !== false && scrollers.length) {
        for(const el of scrollers)el.scrollTop=0;
        let completed=false;
        for(let round=0;round<maxRounds;round++) {
          await delay(stepWait);add();
          // Don't scroll past rows that Apple is still replacing with artist placeholders.
          while(pending() && Date.now()-started<maxMs){await delay(stepWait);add();}
          if(Date.now()-started>=maxMs || limited){limited=true;break;}
          const atBottom = scrollers.every(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-2);
          if(atBottom && !pending() && Date.now()-Math.max(lastAdded,lastChange)>=bottomWait){completed=true;break;}
          if(!atBottom)for(const el of scrollers)el.scrollTop=Math.min(el.scrollHeight,el.scrollTop+Math.max(1,Math.floor(el.clientHeight*0.7)));
          if(round===maxRounds-1)limited=true;
        }
        if(!completed)limited=true;
      }
      add();
    } finally {
      observer.disconnect();for(const [el,top]of positions)el.scrollTop=top;
    }
    if(!found.size)throw new Error('Nenhum nome foi encontrado na lista de artistas. Aguarde o carregamento da biblioteca e tente novamente. Nenhum álbum será importado como artista.');
    const countNode=root.querySelector('[aria-rowcount], [aria-setsize]');
    const expected=Number(countNode?.getAttribute('aria-rowcount')||countNode?.getAttribute('aria-setsize')||0);
    if(expected>found.size)limited=true;
    return {captureFormat:2,provider,artists:[...found.values()].sort((a,b)=>a.name.localeCompare(b.name)),limited,
      notice:limited?'A leitura não alcançou toda a lista de artistas. Confira os itens e tente novamente após o carregamento da biblioteca.':'Nomes coletados exclusivamente da lista de artistas. A extensão percorreu a rolagem da lista; confira a seleção antes de importar.'};
  }
  return {readArtists,scrollContainers,collect};
})();
