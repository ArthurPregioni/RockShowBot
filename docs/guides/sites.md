# Hospedar sua própria instância no Sites

Este caminho fornece o painel React, a extensão Apple Music/Spotify e o catálogo ampliado. Ele depende do **Sites**, de acesso privado e de tarefas em nuvem com Gmail conectado. Para um VPS ou Docker sem essas dependências, use o [servidor Python](standalone.md), com seus recursos próprios.

## 1. Preparar sua cópia e o preview

Faça um fork ou clone. Instale Node.js 22.13+ e execute na raiz:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run build
npm run db:migrate:local
npm run dev
```

Abra <http://localhost:5173/signin-with-chatgpt?return_to=/>. A identidade é fictícia e serve apenas para desenvolvimento local. O banco começa vazio. O preview não envia e-mails nem cria tarefas. Aplique as migrações pendentes ao atualizar o esquema, depois de gerar um novo build.

O arquivo de exemplo `.openai/hosting.example.json` declara `DB` como binding D1. Ele permite desenvolver e construir um clone sem nenhum ID de Site. O manifesto real `.openai/hosting.json` fica fora do Git.

## 2. Criar e publicar um Site próprio

No ambiente que oferece o plugin Sites, forneça sua cópia e peça:

> Crie um novo Site privado do RockShowBot a partir deste repositório. Use um banco D1 próprio com binding DB. Registre o novo projeto, configure ROCKSHOWBOT_SITE_ORIGIN com a URL HTTPS obtida, aplique as migrações versionadas e publique. Preserve o acesso privado. Não reutilize dados ou credenciais de outra instalação.

O fluxo do plugin registra o projeto e grava seu ID em `.openai/hosting.json`, faz build e publica o artefato. Os segredos são configurados pelas ferramentas nativas de hospedagem; não entram no manifesto, no Git nem no JavaScript do navegador. A URL de produção precisa ser configurada **antes de usar callbacks ou preparar mensagens de e-mail**. Não há fallback para a instalação do autor.

A autenticação é fornecida pelo Sites. **O código atual exige que o Site permaneça privado ao proprietário.** As rotas de automação confiam na autorização do serviço de hospedagem, que valida o acesso da tarefa. Não publique esse Worker em um endereço anônimo nem confie em cabeçalhos de identidade enviados diretamente por visitantes. O servidor Python é o caminho disponível para hospedagem independente com login próprio.

## 3. Configurar as variáveis

| Variável | Uso |
| --- | --- |
| `ROCKSHOWBOT_SITE_ORIGIN` | Obrigatória em produção: `https://seu-dominio.example`, sem caminho |
| `APPLE_MUSIC_DEVELOPER_TOKEN` | Opcional, somente login MusicKit oficial |
| `SPOTIFY_CLIENT_ID` | Opcional, somente login Spotify oficial por PKCE |
| `TICKETMASTER_API_KEY` | Opcional, complemento da Discovery API |
| `PREDICTHQ_API_KEY` | Opcional, complemento PredictHQ |

A extensão não exige credenciais MusicKit/Spotify. A configuração local `.dev.vars` não configura produção; `.env` pertence ao servidor Python e não é lido pelo painel web.

Configure APIs oficiais seguindo o [guia de serviços de música](music-services.md). Registre o callback Spotify exato da **sua** instalação: `https://seu-dominio.example/api/music/spotify/callback`.

## 4. Criar suas tarefas de busca e e-mail

Conecte o Gmail que enviará as mensagens. No painel do seu Site, importe artistas, selecione países, informe o destinatário, autorize os alertas e salve.

Peça ao ambiente Sites para verificar as tarefas já vinculadas antes de criar estas duas. Elas devem estar associadas ao **novo Site**, obter acesso de serviço a cada execução e ler o protocolo da própria instalação:

| Tarefa | Horário sugerido, America/Sao_Paulo | Instrução persistente |
| --- | --- | --- |
| Shows futuros e alertas | Todos os dias às 09h e 21h | Seguir `/automation.txt`: consultar artistas/países, pesquisar agendas oficiais, separar antecipações e enviar somente o resumo reservado pelo servidor |
| Confirmação de preferências | A cada hora, minuto 15 | Seguir `/preferences-confirmations.txt`: entregar somente confirmações pendentes, sem pesquisar shows |

Exemplo de pedido:

> Configure e vincule a este novo Site as duas tarefas da tabela, no fuso America/Sao_Paulo. Antes de criar, confira se já existem tarefas equivalentes. Use o Gmail que conectei e os protocolos publicados pelo próprio Site. Obtenha o acesso privado de serviço em cada execução, sem colocar tokens nas instruções. Verifique uma execução das buscas e a persistência dos dados. Para testar o e-mail, envie apenas a confirmação que solicitei ao salvar minhas preferências.

A criação do Site não copia essas tarefas de outro usuário. `npm run dev`, `npm run build` e um simples deploy também não as criam. Se seu ambiente não oferece Sites, tarefas e Gmail, este modo não tem envio automático disponível.

## 5. Importar artistas e usar

Gere a extensão com `npm run extension:build` ou baixe-a em `/music/browser-import` no Site publicado. Instale-a no navegador, preencha a URL da **sua** instalação e leia a biblioteca de artistas. A primeira utilização não tem destino pré-preenchido. A preferência de destino fica apenas no navegador.

Veja [como usar o painel](using.md). O computador só precisa ficar ligado durante a importação pelo navegador; o radar e as tarefas operam na nuvem.

## Atualizar e manter

Faça alterações no seu fork, execute as verificações do [guia de contribuição](../../CONTRIBUTING.md) e publique no mesmo projeto registrado localmente. Preserve o manifesto e as configurações do operador; confirme que o Site continua privado. As migrações são incrementais. Antes de mudanças de esquema, exporte um backup do D1 com as ferramentas da sua hospedagem.

As instruções de tarefas ficam no repositório para cada instalação usar a mesma versão do protocolo. As tarefas atualizam dados pela API; não precisam reconstruir ou publicar o Site em cada busca. Nenhuma credencial, banco ou tarefa da instalação do autor é distribuída neste repositório.
