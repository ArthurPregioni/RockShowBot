# Importar artistas dos serviços de música


1. Abra a página `/music/browser-import` da sua instalação no mesmo navegador que usa para ouvir música.
2. Baixe o pacote **v0.2.0** Firefox ou Chromium nessa página e extraia o ZIP. Se usou a versão 0.1.0, carregue o `manifest.json` do novo pacote; recarregar a pasta antiga mantém o código antigo. A versão aparece na janela da extensão.
3. **Firefox:** abra `about:debugging#/runtime/this-firefox`, use **Carregar extensão temporária** e selecione o `manifest.json` extraído. A extensão é removida ao reiniciar o Firefox; a lista já importada continua na nuvem. O pacote ainda não foi publicado/assinado em loja.
4. **Chrome/Chromium/Edge:** abra `chrome://extensions` ou `edge://extensions`, ative **Modo do desenvolvedor** e use **Carregar sem compactação** para selecionar a pasta extraída.
5. Entre em [Apple Music](https://music.apple.com/br/library/artists) ou [Spotify](https://open.spotify.com/collection/artists). No Apple Music, abra **Biblioteca → Artistas**. No Spotify, expanda **Sua Biblioteca** e selecione **Artistas**.
6. **Na aba do serviço de música**, clique na extensão RockShowBot. Confira o endereço da sua instalação e clique em **Ler artistas e abrir seleção**. A permissão adicional é solicitada apenas para esse destino.
7. Aguarde a leitura e a rolagem da lista. O painel abre em outra aba; entre nele se solicitado, selecione os artistas e confirme **Importar**. Só os selecionados entram no radar; nomes repetidos são ignorados.

Quem usa este checkout pode gerar e carregar a extensão diretamente:

```sh
npm run extension:build
# Firefox: selecione .extension-build/firefox/manifest.json
# Chromium: carregue a pasta .extension-build/chromium/
```

A extensão acessa o DOM da aba escolhida mediante `activeTab`. Não lê senha, cookies, armazenamento do provedor, playlists ou endpoints privados. A lista de nomes lida fica temporariamente em `storage.session` da extensão por até dez minutos, vinculada à aba de destino, e é descartada após o recebimento. Ao acionar a leitura, os nomes são enviados ao seu painel autenticado para seleção; os candidatos ficam numa sessão temporária no servidor. O endereço da instalação é a única preferência persistente da extensão. Para hospedar uma cópia, configure `ROCKSHOWBOT_SITE_ORIGIN=https://seu-dominio` nas variáveis de produção da sua instalação e altere o destino na janela da extensão. A cópia usa seu próprio banco e autenticação; nenhuma conta do autor é necessária. Ao registrar outro Site, guarde o novo `project_id` no arquivo local `.openai/hosting.json`; ele não entra no Git.

**Limites:** a leitura depende da estrutura e do carregamento da interface do serviço. Filtros, listas virtualizadas e mudanças de layout podem limitar os artistas detectados. Se a leitura atingir o limite, o painel informa que a lista pode estar incompleta. Uma tela não reconhecida gera erro, sem inventar artistas. A extensão importa uma fotografia da biblioteca; ela não cria uma conexão OAuth nem sincroniza continuamente. O computador só precisa estar ligado na importação; as buscas e os alertas ficam na nuvem.

**Verificação:** o fluxo completo da extensão instalada no Chromium foi testado com páginas controladas de biblioteca Apple/Spotify, incluindo seleção, gravação, deduplicação e rejeição de playlists. Os testes não representam autorização ou leitura de uma conta real nos provedores.

## Apple Music pela API oficial (opcional)

O fluxo MusicKit continua disponível para instalações com a credencial do aplicativo. A Apple exige uma chave Media Services e participação no Apple Developer Program por quem mantém a aplicação. O token de desenvolvedor vai no segredo `APPLE_MUSIC_DEVELOPER_TOKEN` do Site. A chave privada `.p8` fica na máquina do operador. O utilitário `scripts/create_apple_token.py` gera o token para a origem exata da sua instalação; o fluxo de login oficial ainda não foi validado com uma conta real nesta instância.

## Spotify pela API oficial

Quem mantém a instalação cadastra um aplicativo no [Spotify for Developers](https://developer.spotify.com/dashboard) e configura `SPOTIFY_CLIENT_ID` nas variáveis de produção do Site. Cadastre exatamente este retorno HTTPS:

```text
https://seu-dominio.example/api/music/spotify/callback
```

Depois publique a configuração. O login usa PKCE (sem Client Secret), pede apenas `user-follow-read` e mostra os artistas seguidos para seleção. O modo de desenvolvimento do Spotify exige Premium para o dono do aplicativo e usuários de teste autorizados; confira os [limites atuais](https://developer.spotify.com/documentation/web-api/concepts/quota-modes). O fluxo está implementado e coberto por testes automatizados; login real não foi validado por falta da credencial.

## O que a importação faz

Importações trazem **artistas**, nunca playlists. A extensão lê a interface da biblioteca Apple/Spotify aberta no navegador. Os fluxos oficiais opcionais consultam a conta uma vez após autorização; o Deezer consulta favoritos públicos. Tokens de acesso/refresh não são guardados para sincronização. As sessões de importação duram dez minutos, são vinculadas ao usuário e ao navegador e guardam temporariamente os artistas candidatos. No Spotify, o verificador PKCE fica na sessão apenas até o retorno do login. Não existe sincronização contínua da biblioteca: para atualizar o radar, repita a importação.

A pesquisa no catálogo usa a [API pública da Apple](https://performance-partners.apple.com/search-api) ou o endpoint público de artistas do Deezer. A consulta de favoritos foi verificada diretamente em `https://api.deezer.com/user/2529/artists`; a disponibilidade depende do serviço e da visibilidade do perfil. Não é necessário criar aplicativo Deezer para essa consulta pública. Perfis privados não têm suporte neste fluxo.

