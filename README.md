# RockShowBot

**Instância pessoal hospedada:** [abrir RockShowBot](https://rockshowbot-arthur.socialyak11.chatgpt.site). O acesso é privado pela conta ChatGPT do proprietário. O painel, banco e buscas agendadas ficam na nuvem; seu computador pode ficar desligado.

## Usar a versão hospedada

1. Abra o link acima e entre com sua conta.
2. Clique em **Escolher serviço**, no cartão **Conectar serviço de música**. O seletor mostra as opções e a disponibilidade de cada uma:
   - **Deezer:** abra seu perfil no Deezer, copie o link (ex.: `https://www.deezer.com/br/profile/123`) e use **Importar artistas do perfil**. O perfil e os artistas favoritos precisam estar públicos. A consulta não faz login e não acessa dados privados.
   - **Buscar artistas no catálogo:** pesquise por nome na Apple ou no Deezer. É uma pesquisa pública, sem acesso à sua conta; serve para montar o radar mesmo usando outro streaming.
   - **Apple Music:** use **Importar pelo navegador** e a extensão para ler a seção Biblioteca → Artistas da sua conta aberta no site Apple Music. Não requer Apple Developer.
   - **Spotify:** use **Importar pelo navegador** e a extensão na seção Sua Biblioteca → Artistas do Spotify. Não requer cadastrar aplicativo Spotify para essa leitura.
   - **YouTube Music:** ainda sem implementação da importação da biblioteca de artistas.
3. Marque os artistas e clique em **Importar**. Nenhum artista é adicionado antes da sua confirmação; nomes repetidos são ignorados. Repita com outros serviços ou pesquisas para completar o radar.
4. Escolha os países em **Onde & como**. Brasil é o padrão; há um atalho para os 12 países da América do Sul.
5. Para receber alertas, informe seu e-mail, marque a autorização e salve as preferências. Cada alteração com e-mail preenchido solicita uma confirmação com o resumo dos países e do estado dos alertas, inclusive quando você desativa os alertas. Uma tarefa em nuvem verifica essa fila a cada hora usando o Gmail conectado. A interface distingue confirmação pendente de enviada. Se o Gmail precisar ser reconectado, as mensagens permanecem pendentes; envios ambíguos são verificados antes de qualquer nova tentativa. Os resumos de shows continuam nas rotinas das 9h e 21h.
6. O radar acompanha **shows que ainda vão acontecer**, mesmo que tenham sido anunciados há meses. O painel ordena pela data do show; eventos passados saem da agenda e dos alertas pendentes. **Buscar agora** consulta as APIs de eventos configuradas e notícias recentes como complemento. A rotina das 9h e 21h (America/Sao_Paulo) prioriza agendas oficiais de artistas, casas, festivais e bilheterias, sem limitar a busca à data de publicação. Consulte **Shows com data** para ver a agenda e **Possíveis shows** para ver notícias e rumores. O retorno das APIs pode ser parcial; o bot não garante cobertura completa de todos os locais. Uma data de publicação nunca vira data de show.

### Apple Music e Spotify: importar pelo navegador

1. Abra [a página de importação](https://rockshowbot-arthur.socialyak11.chatgpt.site/music/browser-import) no mesmo navegador que usa para ouvir música.
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

A extensão acessa o DOM da aba escolhida mediante `activeTab`. Não lê senha, cookies, armazenamento do provedor, playlists ou endpoints privados. A lista de nomes lida fica temporariamente em `storage.session` da extensão por até dez minutos, vinculada à aba de destino, e é descartada após o recebimento. Ao acionar a leitura, os nomes são enviados ao seu painel autenticado para seleção; os candidatos ficam numa sessão temporária no servidor. O endereço da instalação é a única preferência persistente da extensão. Para hospedar uma cópia, configure `ROCKSHOWBOT_SITE_ORIGIN=https://seu-dominio` nas variáveis de produção da sua instalação e altere o destino na janela da extensão. A cópia usa seu próprio banco e autenticação; nenhuma conta do autor é necessária. Ao registrar outro Site, use o `project_id` dessa nova instalação, sem reutilizar o ID pessoal deste checkout.

**Limites:** a leitura depende da estrutura e do carregamento da interface do serviço. Filtros, listas virtualizadas e mudanças de layout podem limitar os artistas detectados. Se a leitura atingir o limite, o painel informa que a lista pode estar incompleta. Uma tela não reconhecida gera erro, sem inventar artistas. A extensão importa uma fotografia da biblioteca; ela não cria uma conexão OAuth nem sincroniza continuamente. O computador só precisa estar ligado na importação; as buscas e os alertas ficam na nuvem.

**Verificação:** o fluxo completo da extensão instalada no Chromium foi testado com páginas controladas de biblioteca Apple/Spotify, incluindo seleção, gravação, deduplicação e rejeição de playlists. Os testes não representam autorização ou leitura de uma conta real nos provedores.

### Apple Music pela API oficial (opcional)

O fluxo MusicKit continua disponível para instalações com a credencial do aplicativo. A Apple exige uma chave Media Services e participação no Apple Developer Program por quem mantém a aplicação. O token de desenvolvedor vai no segredo `APPLE_MUSIC_DEVELOPER_TOKEN` do Site. A chave privada `.p8` fica na máquina do operador. O utilitário abaixo gera o token para a origem exata da sua instalação; o fluxo de login oficial ainda não foi validado com uma conta real nesta instância.

### Spotify na instância hospedada

Quem mantém a instalação cadastra um aplicativo no [Spotify for Developers](https://developer.spotify.com/dashboard) e configura `SPOTIFY_CLIENT_ID` nas variáveis de produção do Site. Cadastre exatamente este retorno HTTPS:

```text
https://rockshowbot-arthur.socialyak11.chatgpt.site/api/music/spotify/callback
```

Depois publique a configuração. O login usa PKCE (sem Client Secret), pede apenas `user-follow-read` e mostra os artistas seguidos para seleção. O modo de desenvolvimento do Spotify exige Premium para o dono do aplicativo e usuários de teste autorizados; confira os [limites atuais](https://developer.spotify.com/documentation/web-api/concepts/quota-modes). O fluxo está implementado e coberto por testes automatizados; login real não foi validado por falta da credencial.

### O que a importação faz

Importações trazem **artistas**, nunca playlists. A extensão lê a interface da biblioteca Apple/Spotify aberta no navegador. Os fluxos oficiais opcionais consultam a conta uma vez após autorização; o Deezer consulta favoritos públicos. Tokens de acesso/refresh não são guardados para sincronização. As sessões de importação duram dez minutos, são vinculadas ao usuário e ao navegador e guardam temporariamente os artistas candidatos. No Spotify, o verificador PKCE fica na sessão apenas até o retorno do login. Não existe sincronização contínua da biblioteca: para atualizar o radar, repita a importação.

A pesquisa no catálogo usa a [API pública da Apple](https://performance-partners.apple.com/search-api) ou o endpoint público de artistas do Deezer. A consulta de favoritos foi verificada diretamente em `https://api.deezer.com/user/2529/artists`; a disponibilidade depende do serviço e da visibilidade do perfil. Não é necessário criar aplicativo Deezer para essa consulta pública. Perfis privados não têm suporte neste fluxo.

Para desenvolvimento do painel: Node >=22.13, `npm ci`, `npm run dev` e login local do Sites. O código Python é uma alternativa separada; configurar `.env` para Python não configura os segredos do Site hospedado. Verificação automatizada do painel: `npx tsc --noEmit` e `node --experimental-strip-types --test tests/web/*.test.mjs`.

### Organização do repositório

```text
src/
  app/                 páginas e rotas HTTP
  lib/                 radar, provedores e preferências
  db/                  esquema e acesso ao banco
  worker/              entrada da hospedagem
  components/, hooks/  componentes da interface
  vendor/              estilos e licenças do starter
extensions/browser/    extensão Firefox e Chromium
selfhosted/            servidor Python independente
scripts/               utilitários do projeto
  package-extension.mjs
  create_apple_token.py
tooling/sites/         infraestrutura de build e preview
deploy/                Dockerfile da versão Python
drizzle/               migrações imutáveis do banco
tests/                 testes web, navegador, fixtures e Python
docs/                  documentação e exemplos
public/                arquivos publicados e protocolos das tarefas
```

`rockshowbot.py` na raiz é apenas um lançador compatível com o comando antigo. Os arquivos de configuração do framework ficam na raiz porque são usados pelas ferramentas de build. Pacotes gerados da extensão ficam em `.extension-build/` e `public/downloads/`, fora do Git. Dados locais (`rockshowbot.db`), credenciais e dependências também ficam fora do versionamento. A pasta `src/components/ui/` contém o código do starter; não é outra aplicação.

### Arquitetura da versão hospedada

O painel React/Vinext e as rotas em `src/app/api/` executam em Cloudflare Workers pelo Sites. As tabelas persistentes D1 são definidas em `src/db/schema.ts`, com migrações versionadas em `drizzle/`. A identidade e o acesso privado são fornecidos pelo Sites, sem senha local. As rotas `/api/automation/*` dependem desse acesso privado; não publique essa versão como site anônimo sem implementar autorização própria para essas rotas.

A tarefa de shows consulta os endpoints e segue `public/automation.txt`. A busca de notícias funciona sem chave de API e produz indícios não verificados. Ela é complementar à agenda: a tarefa em nuvem procura primeiro shows futuros nas fontes oficiais, mesmo quando o anúncio é antigo. Shows esgotados continuam relevantes; shows cancelados e adiados sem nova data não entram como shows marcados. Ticketmaster e PredictHQ são complementos opcionais. A API oficial Apple requer token de desenvolvedor; a importação pela extensão lê a interface da biblioteca aberta no navegador sem esse token. O envio de alertas depende de Gmail conectado e de a opção de alertas estar salva. A confirmação de preferências usa uma fila separada em `preference_confirmations`, o protocolo `public/preferences-confirmations.txt` e uma tarefa própria a cada hora. Ela não executa buscas de shows. O Gmail precisa estar autenticado para qualquer envio real.

O código Python abaixo permanece disponível como alternativa self-hosted. Ele não precisa estar executando para a instância Sites funcionar.

Aplicação self-hosted que acompanha artistas e manda alertas de eventos por e-mail. Dá para usar sem nenhuma chave de API: cadastre artistas e adicione dicas de shows manualmente. As dicas ficam claramente marcadas como **não verificadas**.

## Servidor Python independente

O tutorial de instalação, Docker/Render, SMTP e integração pelas APIs fica em [selfhosted/README.md](selfhosted/README.md). Essa versão é independente do painel hospedado; não precisa ficar executando no seu computador para a instância na nuvem funcionar.

## Verificações de desenvolvimento

```sh
npm run check:types
npm run test:web
npm run test:python
# Instalar o navegador de QA uma vez: npx playwright install chromium
npm run test:browser
node --test tests/selfhosted/apple_music_browser.test.cjs
```

Os testes de consentimento das APIs usam respostas controladas e não validam contas reais nos provedores. O QA da extensão instalada cobre captura de páginas controladas, envio para o painel autenticado, seleção e gravação; não representa uma leitura já realizada da biblioteca pessoal do usuário.
