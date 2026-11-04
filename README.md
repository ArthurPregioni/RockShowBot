# RockShowBot

Radar open source de **shows futuros e possíveis shows**, com artistas escolhidos por você e alertas por e-mail. Brasil por padrão, atalho para a América do Sul e outros países configuráveis. Shows confirmados e antecipações ficam separados.

Licença [MIT](LICENSE): você pode usar, modificar, redistribuir e hospedar sua própria cópia, inclusive comercialmente, mantendo o aviso de licença. Cada instalação usa seu próprio banco e suas próprias credenciais.

## Escolha como hospedar

O painel completo tem dois destinos de hospedagem; o servidor Python permanece como alternativa mais simples.

| Recurso | Painel no Sites | Painel Node/Termux | Python alternativo |
| --- | --- | --- | --- |
| Interface | React/Vinext | Mesmo painel React/Vinext | HTML/Python |
| Banco | D1 | SQLite por conta | SQLite compartilhado |
| Login | Conta do proprietário no Sites | Tela de login, sessões e contas isoladas | HTTP Basic administrativo |
| Artistas | Extensão Apple Music/Spotify, catálogo e APIs opcionais | Mesmas importações do painel | APIs oficiais, manual e CSV |
| Fontes | 22 oficiais + Flesch + notícias/APIs e pesquisa da tarefa | Mesmos coletores automáticos; cobertura parcial em páginas bloqueadas | Ticketmaster/PredictHQ e dicas |
| Rotina/e-mail | Tarefas externas + Gmail conectado | Agendador local + SMTP próprio | Agendador local + SMTP próprio |
| Confirmações e recibos | Sim | Sim | Recursos mais simples |

Para usar o painel completo em um Android ligado 24/7, siga o [guia Node/Termux](docs/guides/termux.md). Para a versão privada hospedada, siga o [guia Sites](docs/guides/sites.md). O [guia Python/Docker](docs/guides/standalone.md) cobre a alternativa mais simples. Um fork não herda credenciais, tarefas ou dados de outra instalação.

## Hospedar o painel completo no celular

Compile no computador e transfira o artefato para o Termux:

```sh
npm ci
npm run build:node
npm run test:node
npm run test:node:integration
tar -czf /tmp/rockshowbot-web.tar.gz -C dist/standalone .
```

O artefato inclui login e isolamento entre contas. No Termux, use Node LTS, Python e `termux-services`, extraia o pacote e execute `deploy/termux/install-web.sh`. O [tutorial](docs/guides/termux.md) cobre HTTPS, inicialização, usuários, SMTP, migração e backup. Um endereço HTTPS público permite acesso de fora da sua casa; cada pessoa usa uma conta e seu próprio e-mail de alertas.

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
deploy/node/           servidor nativo, autenticação, contas e SQLite
deploy/termux/         instalação e boot no Android
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
- [Contribuir e customizar](.github/CONTRIBUTING.md)
- [Reportar vulnerabilidades](.github/SECURITY.md)

As fontes podem ter cobertura parcial, mudar de formato ou bloquear coleta. Rumores permanecem identificados como não verificados até haver evidência oficial. YouTube Music ainda não tem importação da biblioteca de artistas.

## Organização do código

- `src/`: painel, servidor web, regras do radar e tipos em `src/types/`.
- `config/`: configurações de Vite, ESLint, PostCSS e Drizzle.
- `selfhosted/`: servidor Python independente.
- `extensions/`, `deploy/`, `scripts/`, `tests/` e `docs/`: extensão, hospedagem, utilitários, QA e documentação.

As entradas mínimas `vite.config.mjs` e `eslint.config.mjs` ficam na raiz para descoberta automática. O mapa completo está em [arquitetura](docs/architecture.md).
