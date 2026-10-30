# RockShowBot

Radar open source de **shows futuros e possíveis shows**, com artistas escolhidos por você e alertas por e-mail. Brasil por padrão, atalho para a América do Sul e outros países configuráveis. Shows confirmados e antecipações ficam separados.

Licença [MIT](LICENSE): você pode usar, modificar, redistribuir e hospedar sua própria cópia, inclusive comercialmente, mantendo o aviso de licença. Cada instalação usa seu próprio banco e suas próprias credenciais.

## Escolha como hospedar

O repositório contém duas aplicações com recursos diferentes:

| Recurso | Painel web no Sites | Servidor Python independente |
| --- | --- | --- |
| Interface | React/Vinext | HTML servido pelo Python |
| Hospedagem | Sites com acesso privado | Docker/VPS ou Render com disco persistente |
| Banco | D1 da própria instalação | SQLite em volume persistente |
| Autenticação | Conta do proprietário no Sites | Usuário e senha administrativa |
| Artistas Apple Music/Spotify | Extensão pelo navegador ou APIs opcionais | APIs oficiais com credenciais próprias |
| Outras importações | Deezer público, catálogo Apple/Deezer, cadastro manual | Cadastro manual e CSV |
| Fontes de shows | 22 fontes oficiais + Flesch + notícias; APIs opcionais | Ticketmaster/PredictHQ e dicas manuais |
| Agendamento e e-mail | Tarefas externas + Gmail conectado, configurados pelo operador | Agendador no processo + SMTP próprio |
| Confirmação de preferências por e-mail | Sim, com tarefa configurada | Não implementada |
| Consolidação e recibos de alertas | Eventos equivalentes e histórico de envios | Deduplicação básica por evento |

**Para rodar em infraestrutura própria, comece pelo [guia Python/Docker](docs/guides/standalone.md).** Para ter o painel com extensão e catálogo ampliado, siga o [guia Sites](docs/guides/sites.md). Um fork não herda a hospedagem, o Gmail nem as tarefas de outra pessoa. Cada instância tem um radar pessoal; não há cadastro de usuários com dados isolados.

## Começar com Python ou Docker

Requisitos: Python 3.10+ **ou** Docker com Compose. Execute na raiz:

```sh
git clone https://github.com/ArthurPregioni/RockShowBot.git
cd RockShowBot
cp selfhosted/.env.example .env
```

Edite `.env`: escolha `APP_PASSWORD` com pelo menos 16 caracteres. Para buscas automáticas reais, configure Ticketmaster ou PredictHQ; para receber e-mails, configure SMTP. Sem essas credenciais, a interface, os artistas e as dicas manuais continuam disponíveis.

Com Python, carregue as variáveis em Bash e inicie:

```sh
set -a
. ./.env
set +a
python3 -m selfhosted.rockshowbot
```

Ou, com Docker:

```sh
docker compose -f deploy/python/compose.yaml up -d --build
```

Abra <http://127.0.0.1:8000>, entre com `APP_USER`/`APP_PASSWORD`, adicione artistas e salve os países e seu e-mail. O guia detalha [SMTP, provedores e hospedagem com HTTPS](docs/guides/standalone.md). O serviço precisa ficar ligado no servidor para executar as buscas; seu computador pessoal pode ficar desligado.

## Desenvolver o painel web

Requisitos: Node.js 22.13+ e npm. Os comandos usam o lockfile versionado:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run build
npm run db:migrate:local
npm run dev
```

Abra <http://localhost:5173/signin-with-chatgpt?return_to=/>. O preview local usa uma identidade fictícia; banco e e-mails pessoais não são copiados. O envio automático depende da configuração de tarefas descrita no [guia de hospedagem Sites](docs/guides/sites.md).

```sh
npm test
npm run lint -- --max-warnings=0
npm run check:types
npm run check:repo
npm audit
# QA de navegador; instale Chromium uma vez:
npx playwright install chromium
npm run test:browser
# Com npm run dev em outro terminal; não envia e-mails:
npm run test:delivery-flow
```

Os testes de provedores usam respostas controladas e não comprovam login em uma conta real de streaming.

## Onde encontrar cada coisa

```text
src/                   painel web: páginas, componentes, regras e funcionalidades
selfhosted/            servidor Python e sua configuração de exemplo
extensions/browser/    extensão Apple Music e Spotify
public/                protocolos das tarefas e arquivos públicos do painel
drizzle/               migrações D1
deploy/python/         Dockerfile e Compose
scripts/               utilitários do projeto
tests/                 QA por aplicação e tipo de teste
tooling/sites/         infraestrutura da hospedagem Sites
docs/                  guias de uso, instalação e arquitetura
```

Os arquivos na raiz são configurações das ferramentas e documentação de entrada. A [arquitetura](docs/architecture.md) explica as divisões internas. Não edite `dist/`, `.extension-build/`, dependências ou bancos gerados.

- [Documentação completa](docs/README.md)
- [Usar o painel e importar artistas](docs/guides/using.md)
- [Apple Music, Spotify e outros serviços](docs/guides/music-services.md)
- [Fontes e como ampliar a cobertura](docs/guides/sources.md)
- [Contribuir e customizar](CONTRIBUTING.md)
- [Reportar vulnerabilidades](SECURITY.md)

As fontes podem ter cobertura parcial, mudar de formato ou bloquear coleta. Rumores permanecem identificados como não verificados até haver evidência oficial. YouTube Music ainda não tem importação da biblioteca de artistas.
