/* Runs in the extension's isolated world, only after the user clicks the action. */
globalThis.RockShowBotCollector = (() => {
  const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function libraryRoot(doc, location) {
    if (location.hostname === 'music.apple.com') {
      if (!/\/library\/artists(?:\/|$)/.test(location.pathname)) throw new Error('No Apple Music, abra Biblioteca → Artistas antes de importar. Músicas, álbuns e playlists não são lidos.');
      return {provider:'apple',root:doc.querySelector('[data-testid="library-artists"], .library-artists, [data-testid="artist-list"]') || doc.querySelector('main, [role="main"]')};
    }
    if (location.hostname === 'open.spotify.com') {
      const dedicated = /^\/(?:intl-[a-z]+\/)?collection\/artists\/?$/.test(location.pathname);
      const root = dedicated ? doc.querySelector('main, [role="main"]') : doc.querySelector('[data-testid="your-library"], [data-testid="library-root"], #Desktop_LeftSidebar_Id');
      if (!root) throw new Error('No Spotify, abra Sua Biblioteca e selecione o filtro Artistas. Expanda a barra lateral se necessário. Playlists não são lidas.');
      return {provider:'spotify',root};
    }
    throw new Error('Abra a biblioteca de artistas em music.apple.com ou open.spotify.com e clique na extensão nessa aba.');
  }
  function readArtists(doc, location) {
    const {provider,root} = libraryRoot(doc,location);
    if (!root) throw new Error('A biblioteca ainda não carregou. Faça login no serviço, abra Artistas e tente novamente.');
    const found = new Map();
    function add(value) {
      const name = String(value || '').replace(/\s+/g,' ').trim();
      if (name && name.length <= 160 && !/^(artistas?|artists?|play|reproduzir|shuffle|aleatorio)$/i.test(normalize(name))) found.set(normalize(name),{id:normalize(name),name});
    }
    for (const anchor of root.querySelectorAll('a[href]')) {
      if (anchor.closest('footer, [data-testid="now-playing-widget"], [data-testid="recommendations"]')) continue;
      let url;try {url = new URL(anchor.getAttribute('href'),location.href);}catch{continue;}
      const valid = provider === 'apple' ? url.hostname === 'music.apple.com' && /\/(?:artist\/[^/]+\/|library\/artists\/)[^/?#]+\/?$/.test(url.pathname) : url.hostname === 'open.spotify.com' && /^\/(?:intl-[a-z]+\/)?artist\/[A-Za-z0-9]+\/?$/.test(url.pathname);
      if (!valid) continue;
      const title = anchor.querySelector('[data-testid="artist-name"], [data-testid="artist-lockup-title"], [data-testid="entityTitle"], [data-testid="listrow-title"], .artist-lockup__title, [dir="auto"]');
      const labelled = (anchor.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>doc.getElementById(id)).find(node=>node?.textContent?.trim());
      const rowTitle = anchor.closest('[role="row"], [data-testid="library-item"]')?.querySelector('[data-testid="entityTitle"], [data-testid="listrow-title"]');
      add(title?.textContent || labelled?.textContent || rowTitle?.textContent || anchor.getAttribute('title') || anchor.textContent || anchor.getAttribute('aria-label'));
    }
    if (provider === 'apple') for (const node of root.querySelectorAll('[data-testid="artist-lockup-title"], .artist-lockup__title, .library-artist__name, [data-testid="artist-list-item"] [data-testid="title"]')) add(node.textContent);
    return {provider,artists:[...found.values()]};
  }
  async function collect(options = {}) {
    const {root,provider} = libraryRoot(document,window.location);
    if (!root) throw new Error('Abra a lista de artistas e aguarde ela carregar.');
    const found = new Map();
    const add = () => {for(const artist of readArtists(document,window.location).artists) found.set(artist.id,artist);};
    add();
    // Collect virtualized rows while scrolling only this library, never navigating away.
    const elements = [root,...root.querySelectorAll('div,ul,section'),document.scrollingElement].filter(Boolean);
    const scrollers = [...new Set(elements.filter(el => el.scrollHeight > el.clientHeight + 80 && (el === document.scrollingElement || /auto|scroll/.test(getComputedStyle(el).overflowY))))];
    const positions = scrollers.map(el=>[el,el.scrollTop]);
    let limited = false;
    try {
      if (options.scroll !== false && scrollers.length) {
        for (const el of scrollers) el.scrollTop = 0;
        let stable = 0;
        for (let round=0; round<80; round++) {
          await new Promise(resolve=>setTimeout(resolve,350));add();
          const before = found.size, height = scrollers.map(el=>el.scrollHeight).join(',');
          let bottom = true;
          for (const el of scrollers) {el.scrollTop = Math.min(el.scrollHeight,el.scrollTop + Math.max(200,el.clientHeight*0.8));if(el.scrollTop+el.clientHeight < el.scrollHeight-3)bottom=false;}
          await new Promise(resolve=>setTimeout(resolve,200));add();
          const loading = root.querySelector('[aria-busy="true"], [role="progressbar"]');
          stable = bottom && before === found.size && height === scrollers.map(el=>el.scrollHeight).join(',') && !loading ? stable+1 : 0;
          if (stable >= 4) break;
          if (round === 79 || found.size >= 4000) {limited=true;break;}
        }
      }
    } finally {for(const [el,top] of positions)el.scrollTop=top;}
    if (!found.size) throw new Error('Nenhum artista reconhecido nessa tela. Faça login, abra a seção Artistas da biblioteca e tente novamente. Se os artistas já aparecem, a interface do serviço pode ter mudado; nenhum dado foi enviado.');
    return {provider,artists:[...found.values()].slice(0,4000).sort((a,b)=>a.name.localeCompare(b.name)),limited,notice:limited?'A leitura atingiu o limite de rolagem. A lista pode estar incompleta.':'Lista coletada da interface carregada no navegador. Confira os artistas antes de importar; filtros e mudanças no serviço podem limitar a lista.'};
  }
  return {readArtists,collect};
})();
