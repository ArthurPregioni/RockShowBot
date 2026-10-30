# Arquitetura e organização

O repositório contém duas aplicações independentes. O painel web usa React/Vinext, Workers e D1 no Sites. O servidor `selfhosted/` usa Python, SQLite e SMTP, com uma interface própria. Cada instalação tem um único radar compartilhado por seus administradores; não há isolamento entre múltiplos usuários dentro da mesma instância.

```text
src/
  app/                     páginas e rotas HTTP do painel web
  components/              interface usada pelo painel
  core/                    regras de eventos, preferências e configuração
  features/
    events/                persistência, consolidação e recibos de alertas
    music/                 provedores e sessões de importação de artistas
    preferences/           fila de confirmação por e-mail
    radar/                 catálogo e coleta de fontes
  server/                  autenticação, acesso D1 e orquestração
  platform/sites/          integração com o ambiente Sites
  db/                      esquema persistente do painel
  worker/                  entrada HTTP do Worker
selfhosted/                 aplicação Python independente
extensions/browser/        extensão para Apple Music e Spotify
scripts/                   utilitários de empacotamento, diagnóstico e revisão
  check-public-repo.py      verificação de arquivos e padrões sensíveis
  package-extension.mjs     gera pacotes da extensão
  create_apple_token.py     assina token MusicKit opcional
  check-radar-sources.mjs   diagnóstico público das fontes
public/                    favicon e protocolos publicados das tarefas
drizzle/                   migrações D1 e metadados versionados
deploy/python/             Dockerfile e Compose do servidor Python
deploy/termux/             preset Android, serviço, configuração e backup
docs/                      guias de uso, hospedagem e contribuição
tests/                     web, navegador, integração e Python
tooling/sites/             infraestrutura de build, preview e publicação
```

As configurações Node/Vite/TypeScript e `render.yaml` ficam na raiz para serem descobertas pelas ferramentas. `.openai/hosting.example.json` descreve apenas os bindings genéricos; `.openai/hosting.json` guarda a identidade local da instalação e é ignorado. Builds, bancos, dependências, tokens e preferências de ferramentas ficam fora do Git.

## Fluxo do painel web

As páginas exigem a identidade verificada do Sites. A lista de artistas alimenta a coleta oficial e complementar. Eventos e preferências ficam no D1. A importação da extensão cria uma sessão de dez minutos e só persiste artistas após a confirmação do usuário.

A tarefa externa consulta as rotas `/api/automation/*` e os protocolos em `public/`. O Worker não inicia sozinho agendamentos nem envia e-mails. O envio pelo Gmail depende de uma conta conectada e de duas tarefas criadas pelo operador; veja o [guia Sites](guides/sites.md).

A segurança das rotas de automação depende do Site privado. Essa versão não oferece autenticação própria para um Worker público independente. Para hospedar fora do Sites, use a [aplicação Python](guides/standalone.md), que tem seu próprio login, agendador e SMTP.

## Alertas sem repetição no painel web


O bot consolida o mesmo artista/data/país/cidade mesmo quando outra fonte usa grafia diferente (`São Paulo/SP` e `Sao Paulo`, por exemplo). Uma alteração de título ou fonte não reenvia o show. Datas e países diferentes continuam sendo eventos distintos. Vários artistas acompanhados na mesma página de evento, data e cidade aparecem juntos em uma linha do resumo; o contador usa essas linhas, não o número de bandas.

Uma antecipação genérica é arquivada quando já existe show futuro confirmado para aquele artista e país. Uma possibilidade com outro ano ou outra data continua separada. Antecipações com publicação comprovadamente anterior a 90 dias são arquivadas; a data de publicação nunca é usada como data de show. O histórico fica no banco, com o motivo do arquivamento. Uma confirmação posterior pode gerar uma nova notificação, identificada como show com data, sem reciclar o rumor anterior.

A tarefa prepara e reserva um resumo no servidor antes de enviar: assunto, destinatário e conteúdo ficam congelados e recebem um marcador único. O registro `alert_deliveries` guarda o estado do envio e o ID real do Gmail; `alert_receipts` impede repetir a mesma informação. Após uma resposta ambígua, a tarefa precisa conferir a mensagem em Enviados; ela não reenvia por simples expiração de prazo. O endpoint antigo de confirmação apenas por IDs está desativado. Registros antigos já marcados como enviados são preservados como `legacy-notified`, sem inventar ID ou horário histórico do Gmail.


## Alterações no banco

O esquema do painel está em `src/db/schema.ts`. Use `npm run db:generate` e acrescente uma migração; não edite as migrações já aplicadas. `npm run db:migrate:local` só altera o D1 do preview. A publicação Sites aplica as migrações do artefato ao banco daquela instalação.

A aplicação Python mantém e evolui seu esquema SQLite em `selfhosted/rockshowbot.py`. Ela não usa o banco D1, as tarefas Gmail ou os recibos do painel web.

## Dependências de terceiros

A licença do código do projeto é MIT. A infraestrutura vendorizada do Sites mantém sua licença em `tooling/sites/vite/sites-vite-plugin.LICENSE`. Bibliotecas instaladas e serviços consultados conservam suas próprias licenças e condições de acesso. A licença do bot não redistribui credenciais nem concede direitos sobre o conteúdo dos provedores.
