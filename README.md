# RockShowBot

**Instância pessoal hospedada:** [abrir RockShowBot](https://rockshowbot-arthur.socialyak11.chatgpt.site). O acesso é privado pela conta ChatGPT do proprietário. O painel, banco e buscas agendadas ficam na nuvem; seu computador pode ficar desligado.

## Usar a versão hospedada

1. Abra o link acima e entre com sua conta.
2. Clique em **Escolher serviço**, no cartão **Conectar serviço de música**. O seletor mostra as opções e a disponibilidade de cada uma:
   - **Deezer:** abra seu perfil no Deezer, copie o link (ex.: `https://www.deezer.com/br/profile/123`) e use **Importar artistas do perfil**. O perfil e os artistas favoritos precisam estar públicos. A consulta não faz login e não acessa dados privados.
   - **Buscar artistas no catálogo:** pesquise por nome na Apple ou no Deezer. É uma pesquisa pública, sem acesso à sua conta; serve para montar o radar mesmo usando outro streaming.
   - **Apple Music:** importa artistas da biblioteca autorizada, mas o login está indisponível nesta instalação por falta da credencial MusicKit do aplicativo.
   - **Spotify:** importa artistas seguidos após OAuth; está indisponível nesta instalação por falta do Client ID do aplicativo.
   - **YouTube Music:** ainda sem implementação da importação da biblioteca de artistas.
3. Marque os artistas e clique em **Importar**. Nenhum artista é adicionado antes da sua confirmação; nomes repetidos são ignorados. Repita com outros serviços ou pesquisas para completar o radar.
4. Escolha os países em **Onde & como**. Brasil é o padrão; há um atalho para América Latina.
5. Para receber alertas, informe seu e-mail, marque a autorização e salve as preferências. A rotina em nuvem usa o Gmail conectado para enviar um resumo apenas quando houver novidades; mensagens ficam pendentes se o envio falhar.
6. O radar acompanha **shows que ainda vão acontecer**, mesmo que tenham sido anunciados há meses. O painel ordena pela data do show; eventos passados saem da agenda e dos alertas pendentes. **Buscar agora** consulta as APIs de eventos configuradas e notícias recentes como complemento. A rotina das 9h e 21h (America/Sao_Paulo) prioriza agendas oficiais de artistas, casas, festivais e bilheterias, sem limitar a busca à data de publicação. Consulte **Shows com data** para ver a agenda e **Possíveis shows** para ver notícias e rumores. O retorno das APIs pode ser parcial; o bot não garante cobertura completa de todos os locais. Uma data de publicação nunca vira data de show.

### Apple Music na instância hospedada

O fluxo de importação recebe os **artistas da biblioteca autorizada**, mostra a lista para seleção e acompanha apenas os artistas escolhidos. A importação por playlist foi removida da interface, da API e do parser.

Para acessar a **biblioteca privada**, a Apple exige uma credencial MusicKit do Apple Developer Program, obtida por quem mantém o aplicativo. Depois de configurá-la, ainda é necessário validar o login e a autorização com uma conta real. O fluxo implementado consulta a biblioteca uma vez e descarta o token do usuário; uma vinculação persistente com sincronização ainda não foi implementada.

Use o utilitário documentado abaixo com `--origin https://rockshowbot-arthur.socialyak11.chatgpt.site`. O token assinado é configurado como segredo `APPLE_MUSIC_DEVELOPER_TOKEN` nas variáveis de produção do Site. A chave privada `.p8` fica na sua máquina. Peça ao assistente para configurar o token quando o arquivo estiver pronto; não é necessário manter nenhum processo local ligado.

### Spotify na instância hospedada

Quem mantém a instalação cadastra um aplicativo no [Spotify for Developers](https://developer.spotify.com/dashboard) e configura `SPOTIFY_CLIENT_ID` nas variáveis de produção do Site. Cadastre exatamente este retorno HTTPS:

```text
https://rockshowbot-arthur.socialyak11.chatgpt.site/api/music/spotify/callback
```

Depois publique a configuração. O login usa PKCE (sem Client Secret), pede apenas `user-follow-read` e mostra os artistas seguidos para seleção. O modo de desenvolvimento do Spotify exige Premium para o dono do aplicativo e usuários de teste autorizados; confira os [limites atuais](https://developer.spotify.com/documentation/web-api/concepts/quota-modes). O fluxo está implementado e coberto por testes automatizados; login real não foi validado por falta da credencial.

### O que a importação faz

Importações trazem **artistas**, nunca playlists. Apple e Spotify consultam a conta uma vez após autorização; o Deezer consulta favoritos públicos. Tokens de acesso/refresh não são guardados para sincronização. As sessões de importação duram dez minutos, são vinculadas ao usuário e ao navegador e guardam temporariamente os artistas candidatos. No Spotify, o verificador PKCE fica na sessão apenas até o retorno do login. Não existe sincronização contínua da biblioteca: para atualizar o radar, repita a importação.

A pesquisa no catálogo usa a [API pública da Apple](https://performance-partners.apple.com/search-api) ou o endpoint público de artistas do Deezer. A consulta de favoritos foi verificada diretamente em `https://api.deezer.com/user/2529/artists`; a disponibilidade depende do serviço e da visibilidade do perfil. Não é necessário criar aplicativo Deezer para essa consulta pública. Perfis privados não têm suporte neste fluxo.

Para desenvolvimento do painel: Node >=22.13, `npm ci`, `npm run dev` e login local do Sites. O código Python é uma alternativa separada; configurar `.env` para Python não configura os segredos do Site hospedado. Verificação automatizada do painel: `npx tsc --noEmit` e `node --experimental-strip-types --test tests/cloud-bot.test.mjs tests/music-providers.test.mjs`.

### Arquitetura da versão hospedada

O painel React/Vinext e as rotas em `app/api/` executam em Cloudflare Workers pelo Sites. As tabelas persistentes D1 são definidas em `db/schema.ts`, com migrações versionadas em `drizzle/`. A identidade e o acesso privado são fornecidos pelo Sites, sem senha local. As rotas `/api/automation/*` dependem desse acesso privado; não publique essa versão como site anônimo sem implementar autorização própria para essas rotas.

A tarefa vinculada consulta os endpoints e segue `public/automation.txt`. A busca de notícias funciona sem chave de API e produz indícios não verificados. Ela é complementar à agenda: a tarefa em nuvem procura primeiro shows futuros nas fontes oficiais, mesmo quando o anúncio é antigo. Shows esgotados continuam relevantes; shows cancelados e adiados sem nova data não entram como shows marcados. Ticketmaster e PredictHQ são complementos opcionais. A consulta aos artistas da conta Apple Music requer o token de desenvolvedor do aplicativo. O envio na rotina depende de Gmail conectado e de a opção de alertas estar salva.

O código Python abaixo permanece disponível como alternativa self-hosted. Ele não precisa estar executando para a instância Sites funcionar.

Aplicação self-hosted que acompanha artistas e manda alertas de eventos por e-mail. Dá para usar sem nenhuma chave de API: cadastre artistas e adicione dicas de shows manualmente. As dicas ficam claramente marcadas como **não verificadas**.

## O que já funciona

- Apple Music: fluxo de consulta da biblioteca implementado, mas ainda sem credencial do aplicativo ou validação com uma conta real nesta instância. A vinculação de conta não está entregue.
- Spotify como integração alternativa, com seleção de artistas seguidos.
- Cadastro manual de artistas e importação de CSV como alternativa.
- Brasil ativado por padrão; outros países podem ser adicionados por código ISO de duas letras.
- Busca de eventos no Ticketmaster e, opcionalmente, no PredictHQ.
- Dicas manuais da comunidade para anúncios e rumores que as APIs ainda não listaram.
- Deduplicação de eventos e fila de e-mails que tenta novamente depois de falhas SMTP.
- Busca manual e agendamento periódico enquanto o serviço estiver ligado.
- Tela protegida por usuário e senha; endpoint de saúde `/healthz` para a hospedagem.
- SQLite local e volume persistente no exemplo de deploy do Render.

## Tutorial rápido: testar sem contas externas

Você precisa de Python 3.10 ou mais recente. O app e os testes usam apenas a biblioteca padrão.

1. Abra a pasta do projeto e crie sua configuração:

   ```sh
   cp .env.example .env
   ```

2. Edite `.env` e escolha uma senha longa em `APP_PASSWORD`. Para rodar buscas reais, adicione também uma chave Ticketmaster ou PredictHQ. Sem essas chaves, o cadastro, as dicas manuais e a interface continuam funcionando.

3. Carregue as variáveis e inicie o app (com Bash):

   ```sh
   set -a
   . ./.env
   set +a
   python3 rockshowbot.py
   ```

4. Abra <http://localhost:8000>. O navegador pedirá usuário `admin` e a senha que você colocou em `APP_PASSWORD`.

5. Cadastre uma banda, por exemplo `Sepultura`, ou importe `examples/artistas-exemplo.csv` pela seção **Importar CSV**.

6. Em **Dica de possível show**, informe artista, título, data, cidade, região e um link. A data pode ser escolhida no calendário. A dica aparece na lista com o selo **Dica não verificada**. Se houver SMTP configurado, também chega um e-mail.

7. Para testar o envio, preencha seu e-mail, configure SMTP no `.env` e clique em **Enviar e-mail de teste**.

As buscas automáticas ocorrem a cada 12 horas por padrão, enquanto o processo estiver ligado. Mude `SCAN_INTERVAL_HOURS` para outro número de horas. O botão **Buscar shows agora** inicia uma busca manual.

### Configurar fontes de eventos

**Ticketmaster Discovery API**

1. Crie uma chave no [portal de desenvolvedores Ticketmaster](https://developer.ticketmaster.com/).
2. Coloque-a em `TICKETMASTER_API_KEY` no `.env`.
3. Reinicie o app e confirme na página que a fonte aparece como ativa.

**PredictHQ (opcional)**

1. Crie uma conta e consulte os planos e limites no [PredictHQ](https://www.predicthq.com/) e na [documentação da API](https://docs.predicthq.com/api/events/search-events).
2. Coloque o token em `PREDICTHQ_API_KEY`.
3. Reinicie o app. A cobertura depende do plano/país habilitado na conta, e a busca pode não retornar dados para todos os locais.

O Ticketmaster cobre eventos listados nas plataformas que alimentam a Discovery API; isso não significa cobertura de todos os shows ou casas. A busca confere o nome da banda entre as atrações para reduzir homônimos. O PredictHQ é opcional e seu acesso pode ser pago ou limitado por assinatura. Os resultados dessas fontes significam “listado pelo provedor”, não confirmação diretamente com o artista. Eventos listados são removidos 30 dias depois da data do show (`EVENT_RETENTION_DAYS`); dicas pessoais permanecem até o administrador apagá-las. A [política da API Ticketmaster](https://developer.ticketmaster.com/support/terms-of-use/) estabelece limites para retenção e solicitações de remoção de dados.

O Songkick informa que não está aprovando projetos de hobby/educação e que seu uso de API requer licença paga; por isso não é tratado como dependência pronta do projeto ([acesso à API](https://www.songkick.com/developer/)). A API do Bandsintown é destinada a artistas e equipes autorizadas, e a chave é vinculada ao artista ([regras de acesso](https://help.artists.bandsintown.com/en/articles/7053475-what-is-the-bandsintown-api)). Não compartilhe chaves pessoais entre instalações.

### E-mail por SMTP

Configure no `.env`:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=seu-usuario
SMTP_PASSWORD=sua-senha-ou-senha-de-aplicativo
SMTP_FROM="RockShowBot <voce@example.com>"
SMTP_STARTTLS=true
```

Use a senha de aplicativo quando seu provedor exigir; não coloque credenciais reais no Git. Salve um endereço de destino na interface e use **Enviar e-mail de teste**. Alertas não enviados ficam pendentes no banco e são tentados de novo na próxima busca.

## Configuração de desenvolvimento Apple Music (pendente)

O fluxo é **Conectar Apple Music → Autorizar Apple Music → escolher artistas da biblioteca → Importar selecionados**. A leitura consulta os artistas presentes na sua biblioteca; músicas que você apenas escuta sem adicionar à biblioteca podem não aparecer. O usuário escolhe artistas diretamente na lista retornada pela biblioteca; histórico e Replay não fazem parte dessa leitura.

Além da assinatura Apple Music usada na autorização, a versão web precisa de um token assinado com uma chave MusicKit do **Apple Developer Program**. A [documentação de geração de tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens) explica esse requisito. Nenhuma inscrição ou cobrança é iniciada pelo bot.

### 1. Criar a credencial MusicKit

1. Na conta Apple Developer, abra **Certificates, Identifiers & Profiles**.
2. Em **Identifiers**, registre um **Media ID** com MusicKit habilitado.
3. Em **Keys**, crie uma chave **Media Services**, habilite MusicKit e associe-a ao Media ID. Baixe o arquivo `.p8` e guarde-o em local seguro. Anote o **Key ID** e o **Team ID** de dez caracteres. Siga o [guia oficial da Apple](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key).

### 2. Gerar o token para a URL da sua instalação

Gere o token localmente; a chave privada `.p8` não precisa sair da sua máquina. O utilitário opcional usa `cryptography`; o servidor do bot continua usando apenas a biblioteca padrão Python.

```sh
python3 -m venv .venv-token
.venv-token/bin/python -m pip install -r scripts/requirements-token.txt
.venv-token/bin/python scripts/create_apple_token.py \
  --team-id SEUTEAM123 \
  --key-id SUAKEY1234 \
  --private-key /caminho/para/AuthKey_SUAKEY1234.p8 \
  --origin https://SEU-SERVICO.onrender.com
```

Substitua os IDs e a URL pelos seus valores. O token é salvo em `.apple-music-token`, com permissão restrita, validade padrão de 30 dias e uso limitado à origem informada. O utilitário não sobrescreve arquivos existentes: para renovar, use `--output .apple-music-token-next` e atualize a configuração. `--days` aceita de 1 a 180. O `.gitignore` cobre as chaves `.p8`, os tokens e o ambiente virtual.

### 3. Configurar o bot e testar

- **No Render:** coloque o conteúdo do arquivo gerado em `APPLE_MUSIC_DEVELOPER_TOKEN`, nas variáveis do serviço. O bot usa `RENDER_EXTERNAL_URL` como origem automaticamente. Não envie a chave `.p8` ao servidor. Faça o primeiro deploy para obter a URL e depois gere o token para essa URL exata e atualize o serviço.
- **Em outro host:** configure `APPLE_MUSIC_DEVELOPER_TOKEN` e `APPLE_MUSIC_ORIGIN=https://seu-dominio`.
- **Em desenvolvimento local:** gere um token para `http://127.0.0.1:8000`, configure `APPLE_MUSIC_DEVELOPER_TOKEN_FILE=.apple-music-token` e `APPLE_MUSIC_ORIGIN=http://127.0.0.1:8000`. A integração com o provedor deve ser validada no endereço HTTPS hospedado; restrições do navegador/Apple podem afetar origens locais.

Reinicie o app. Clique em **Conectar Apple Music** e depois em **Autorizar Apple Music**, permita a leitura na janela da Apple e marque uma banda na tela de seleção. Confirme que somente essa banda entrou na lista. Ao repetir a importação, nomes já cadastrados são ignorados. A biblioteca Apple Music permanece inalterada.

O token de usuário passa por HTTPS ao backend para consultar a biblioteca e é descartado depois da leitura. O bot pede ao MusicKit para encerrar a autorização local ao terminar a consulta. A lista temporária e o cookie técnico expiram em até dez minutos; somente os nomes selecionados ficam no SQLite. Cada nova importação pede conexão novamente.

Se não aparecer nenhum artista, confira se há músicas ou álbuns adicionados à biblioteca e se a biblioteca está sincronizada com o Apple Music. Se houver erro 401, confira o token de desenvolvedor, sua validade e a origem. Se houver 403, confira a assinatura e autorize novamente. Use a mesma origem exata ao gerar o token e acessar o app; trocar domínio ou protocolo exige um novo token. O login real só pode ser confirmado depois de configurar essa credencial e autorizar sua conta no navegador.

## Conectar Spotify e escolher artistas (alternativa)

1. Abra o [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) e crie um aplicativo com acesso à Web API.
2. Nas configurações desse aplicativo, registre o endereço de retorno exato:
   - Na versão hospedada: `https://SEU-SERVICO.onrender.com/spotify/callback`.
   - Para testar na sua máquina: `http://127.0.0.1:8000/spotify/callback`. Spotify não aceita `localhost` como callback; abra o bot pelo endereço `127.0.0.1` durante esse teste.
3. Copie o **Client ID** para `SPOTIFY_CLIENT_ID` no ambiente do bot. Defina `SPOTIFY_REDIRECT_URI` com o mesmo endereço cadastrado. O fluxo usa PKCE e não precisa de Client Secret.
4. No Render, basta configurar o Client ID: quando `SPOTIFY_REDIRECT_URI` estiver ausente, o bot usa `RENDER_EXTERNAL_URL` para montar o callback. Cadastre esse endereço no Dashboard Spotify depois que a URL do serviço existir.
5. Em **User Management** no Dashboard Spotify, autorize a conta que usará o aplicativo. Em Development Mode, o proprietário precisa ter Spotify Premium e novos aplicativos permitem até cinco usuários autorizados, conforme as [regras atuais](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
6. Reinicie/reimplante o bot. Clique em **Conectar Spotify**, autorize a leitura e selecione os artistas desejados na tela seguinte. Clique em **Importar selecionados**.

Essa importação lê **artistas que você segue** no Spotify. Para experimentar, siga duas bandas na sua conta, conecte, marque apenas uma e confira se só ela entrou na lista do bot. Repetir a importação ignora os nomes já cadastrados. O bot não segue nem deixa de seguir artistas na sua conta e não consulta seu histórico de reprodução.

Tokens de acesso são descartados depois da consulta. A lista temporária para seleção e o cookie de autorização expiram em até dez minutos. Se o processo reiniciar durante a conexão, clique em Conectar Spotify novamente. Os nomes selecionados ficam no SQLite para monitorar shows; a importação é pontual, sem sincronização automática. A senha da conta Spotify é digitada somente na página do Spotify.

Se o Spotify retornar 403, confira Premium do proprietário e a lista de usuários autorizados. Se recusar o callback, confira endereço, protocolo, porta e caminho exatos conforme as [regras de redirect URI](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## Importar artistas por CSV

O importador aceita um nome de artista por linha ou uma coluna com cabeçalho `name`, `artist`, `band`, `artista` ou `banda`. Exemplo:

```csv
artist
Sepultura
Angra
Ratos de Porão
```

Artistas repetidos são ignorados. O exemplo `examples/artistas-exemplo.csv` pode ser usado para experimentar a importação.

## Hospedar no Render

O repositório inclui `Dockerfile` e `render.yaml` para criar um serviço web em Frankfurt, com disco persistente para o SQLite. O blueprint pede que você defina a senha administrativa ao criá-lo.

1. Envie este repositório para um Git remoto que sua conta Render consiga acessar (a cópia de desenvolvimento está em [GitHub](https://github.com/ArthurPregioni/RockShowBot)).
2. Abra o [Render Dashboard](https://dashboard.render.com/blueprint/new), conecte o repositório e crie um **Blueprint**. Revise os recursos e custos que ele vai criar antes de aplicar.
3. O blueprint inclui um serviço web e um disco persistente de 1 GB. **O disco persistente exige um plano pago.** Não aplique o blueprint sem revisar o preço exibido no painel.
4. No painel do serviço, configure `TICKETMASTER_API_KEY` e, se tiver, `PREDICTHQ_API_KEY`, além das variáveis `SMTP_*`.
5. Informe uma senha forte para `APP_PASSWORD` quando o Render pedir, faça o deploy e abra a URL `onrender.com`. O usuário é `admin`.
6. Cadastre artistas e salve seu e-mail na página.

O Render entrega URL pública com HTTPS e espera que o app escute em `0.0.0.0`; esse app usa o `PORT` fornecido pelo serviço. O disco montado em `/var/data` preserva o banco entre reinícios e deploys. O plano grátis pode desligar o processo depois de inatividade, e seu sistema de arquivos padrão é temporário; isso interromperia as buscas agendadas e não preservaria o SQLite. Confira a documentação atual de [Web Services](https://render.com/docs/web-services), [Persistent Disks](https://render.com/docs/disks) e [Blueprints](https://render.com/docs/blueprint-spec).

Não coloque o servidor diretamente na internet sem `APP_PASSWORD`. Use HTTPS para login Basic; o Render termina HTTPS antes de encaminhar o tráfego ao serviço.

### Executar com Docker em outro host

```sh
docker build -t rockshowbot .
docker run --name rockshowbot --restart unless-stopped \
  -p 8000:10000 \
  -e APP_PASSWORD='escolha-uma-senha-forte' \
  -e DATABASE_PATH=/var/data/rockshowbot.db \
  -v rockshowbot-data:/var/data \
  rockshowbot
```

Passe as chaves de API e SMTP também com `-e` ou por um arquivo de segredos protegido. Configure domínio e HTTPS no proxy reverso do host.

## Executar os testes

```sh
python3 -m unittest discover -s tests -v
```

Os testes usam provedores e e-mail falsos; não fazem chamadas externas nem enviam mensagens. Cobrem CSV, correspondência de artista, deduplicação, fila de e-mail, dicas comunitárias e autenticação da interface. As integrações Apple Music e Spotify percorrem HTTP real no bot até a seleção e gravação, substituindo as respostas externas. Também conferem expiração, paginação e descarte dos tokens, além de PKCE no Spotify. Validar o consentimento real exige credenciais do provedor e autorização da sua conta. Para verificar também a assinatura criptográfica do utilitário Apple, execute a suíte com `.venv-token/bin/python -m unittest discover -s tests -v` depois de instalar sua dependência opcional.

O código de autorização do navegador tem testes separados (Node.js 22+):

```sh
node --test tests/apple_music_browser.test.cjs
```

Esses testes substituem o SDK MusicKit por um simulador e verificam cancelamento, mensagens de erro e descarte da autorização antes de abrir a seleção; não equivalem ao login real com a Apple.

## Privacidade e operação

- Este MVP é uma instalação pessoal com um login administrativo compartilhado; não tem cadastro de múltiplos usuários.
- `APP_PASSWORD` protege a interface. Use uma senha única e HTTPS quando publicada.
- `ADMIN_CONTACT` pode exibir um contato na página pública de privacidade.
- Chaves de API e SMTP ficam em variáveis de ambiente. O e-mail de destino, artistas, regiões e eventos ficam no SQLite local.
- O servidor/hospedagem registra horário, IP e caminho das requisições em seus logs.
- Em hospedagem, configure `DATABASE_PATH` dentro do disco persistente e faça backups regulares desse arquivo. A página **Privacidade** explica os dados guardados e a retenção.
- O botão de busca e as buscas agendadas consultam todos os provedores configurados para cada artista e país; monitore as cotas dos provedores.
- A interface aceita dicas pessoais. Elas não passam por moderação externa e recebem o selo de não verificadas.
- Apple Music importa artistas da biblioteca; Spotify importa artistas seguidos. Deezer e YouTube Music ainda não estão integrados.

## Licença

MIT. Consulte [LICENSE](LICENSE).
