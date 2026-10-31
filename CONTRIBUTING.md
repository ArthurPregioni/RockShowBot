# Contribuir com o RockShowBot

Forks, instalações próprias, correções, novos provedores e melhorias nos guias são bem-vindos. O projeto usa a licença MIT; contribuições devem ser compatíveis com ela. Não é necessário obter autorização do autor para hospedar ou modificar uma cópia.

## Preparar o ambiente

Leia a [arquitetura](docs/architecture.md) e escolha a aplicação que vai alterar. O [README](README.md) traz a comparação e os comandos de instalação.

Para o painel web, use Node.js 22.13+ e `npm ci`. Para Python, use Python 3.10+; o servidor não exige pacotes externos. A assinatura opcional de tokens MusicKit tem sua dependência em `scripts/requirements-token.txt`.

## Onde alterar

| Mudança | Local |
| --- | --- |
| Páginas e rotas do painel | `src/app/` |
| Componentes usados na interface | `src/components/` |
| Regras de identidade, datas e preferências | `src/core/` |
| Alertas e persistência de eventos | `src/features/events/` |
| Importação de artistas | `src/features/music/`, `extensions/browser/` |
| Nova fonte oficial | `src/features/radar/catalog.json` e, se necessário, `discovery.ts` |
| Confirmação de preferências | `src/features/preferences/` |
| Autenticação e orquestração | `src/server/` |
| Aplicação independente | `selfhosted/` |
| Banco do painel | `src/db/schema.ts` e nova migração em `drizzle/` |

Use ID estável, países ISO e HTTPS no catálogo. Teste coletores com HTML/JSON controlado, sem depender de shows reais ou de contas pessoais. Preserve a distinção entre confirmação oficial e rumor, e não use a data da notícia como data do show.

## Validar antes do pull request

```sh
npm test
npm run lint -- --max-warnings=0
npm run check:types
npm run check:repo
npm run build
npm audit
```

Para mudanças na extensão, instale Chromium com `npx playwright install chromium` e rode `npm run test:browser` e `npm run extension:build`. Para mudanças de persistência/envio, rode `npm run test:delivery-flow` com `npm run dev` em outro terminal. Esse teste aceita somente um preview local e não envia mensagens.

Para mudanças de hospedagem Python, construa a imagem com `docker build -f deploy/python/Dockerfile -t rockshowbot-local-qa .` e execute `python3 tests/integration/standalone-docker.py`. O teste usa senha aleatória, contêiner e volume próprios, verifica login e persistência e remove apenas os recursos que criou. Não envia e-mails.

Se alterar o esquema, gere uma nova migração com `npm run db:generate`; nunca reescreva SQL já aplicado. Atualize o guia correspondente sempre que mudar um comando, variável ou recurso disponível.

Explique no pull request o problema, o comportamento resultante e como verificou a mudança. Use exemplos pequenos e sem dados pessoais. Não acrescente componentes, bibliotecas ou configurações sem um uso concreto no projeto.

Para mudanças no preset Termux, os testes Python cobrem configuração e arquivos gerados. `python3 tests/integration/termux-runit.py` exercita o ciclo completo do serviço em um contêiner Linux com runit real e wake lock simulado. A validação de reboot e restrições do Android precisa ser feita no aparelho.

## Dados e credenciais

Use os arquivos de exemplo. `.env`, `.dev.vars`, bancos, chaves, tokens e `.openai/hosting.json` não entram no Git. Faça testes de e-mail com transportes controlados; não envie mensagens de QA para usuários reais. Não inclua logs com cabeçalhos de autorização, e-mails pessoais ou IDs da sua biblioteca.

`npm run check:repo` procura arquivos sensíveis e padrões comuns de credenciais nos arquivos versionáveis e verifica links locais da documentação. `python3 scripts/check-public-repo.py --history` também examina os blobs disponíveis no histórico Git. Essa checagem por padrões complementa a revisão; não garante a detecção de todo tipo de segredo.

## Licenças

Mantenha o aviso MIT e as licenças de código de terceiros que redistribuir. Não adicione músicas, imagens, logos ou bases de eventos sem direito de redistribuição. Configurar uma fonte no catálogo não implica afiliação com o provedor. Cada operador deve usar suas próprias contas e cumprir as condições de acesso dos serviços que escolher.
