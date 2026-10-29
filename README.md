# RockShowBot

Aplicação self-hosted que acompanha artistas e manda alertas de eventos por e-mail. Dá para usar sem nenhuma chave de API: cadastre artistas e adicione dicas de shows manualmente. As dicas ficam claramente marcadas como **não verificadas**.

## O que já funciona

- Conexão Spotify com seleção dos artistas seguidos que você quer acompanhar.
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

## Conectar Spotify e escolher artistas

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

Os testes usam provedores e e-mail falsos; não fazem chamadas externas nem enviam mensagens. Cobrem CSV, correspondência de artista, deduplicação, fila de e-mail, dicas comunitárias e autenticação da interface. O teste de integração Spotify percorre HTTP real no bot (conexão, callback, seleção e gravação), substituindo somente as respostas externas do Spotify. Também confere PKCE, estado vinculado ao navegador, expiração, paginação e descarte dos tokens. Validar o consentimento real exige um aplicativo Spotify configurado e autorização da sua conta.

## Privacidade e operação

- Este MVP é uma instalação pessoal com um login administrativo compartilhado; não tem cadastro de múltiplos usuários.
- `APP_PASSWORD` protege a interface. Use uma senha única e HTTPS quando publicada.
- `ADMIN_CONTACT` pode exibir um contato na página pública de privacidade.
- Chaves de API e SMTP ficam em variáveis de ambiente. O e-mail de destino, artistas, regiões e eventos ficam no SQLite local.
- O servidor/hospedagem registra horário, IP e caminho das requisições em seus logs.
- Em hospedagem, configure `DATABASE_PATH` dentro do disco persistente e faça backups regulares desse arquivo. A página **Privacidade** explica os dados guardados e a retenção.
- O botão de busca e as buscas agendadas consultam todos os provedores configurados para cada artista e país; monitore as cotas dos provedores.
- A interface aceita dicas pessoais. Elas não passam por moderação externa e recebem o selo de não verificadas.
- Spotify importa artistas seguidos após autorização e seleção. Apple Music, Deezer e YouTube Music ainda não estão integrados.

## Licença

MIT. Consulte [LICENSE](LICENSE).
