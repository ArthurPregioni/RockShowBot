# Endereço fixo gratuito para o celular

O servidor Node e os bancos continuam no Termux. Um Worker pequeno oferece o endereço `https://rockshowbot.sua-conta.workers.dev` e encaminha as requisições ao túnel atual do aparelho. O celular informa mudanças de túnel por uma rota autenticada. Essa ponte é opcional e não usa o banco ou a autenticação do Sites.

## Preparar no computador

Na pasta do projeto, autentique sua própria conta Cloudflare gratuita:

```sh
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write workers_kv:write
mkdir -p .local/bridge
cp deploy/bridge/wrangler.example.jsonc .local/bridge/wrangler.jsonc
npx wrangler kv namespace create rockshowbot-tunnel --config .local/bridge/wrangler.jsonc
```

No arquivo copiado, substitua `REPLACE_WITH_YOUR_NAMESPACE_ID` pelo ID retornado. Ajuste `name` se quiser outro nome para o Worker. Se sua conta ainda não tiver um subdomínio `workers.dev`, abra **Workers & Pages** no painel Cloudflare e escolha um. O endereço resultante combina o nome do Worker e o subdomínio da conta. Não altere um subdomínio já usado por outros projetos sem considerar seus endereços.

Publique a ponte:

```sh
npx wrangler deploy --config .local/bridge/wrangler.jsonc
```

Gere a configuração privada com a URL efetivamente retornada pelo deploy. Substitua o endereço de exemplo na primeira linha; o comando não exibe o segredo:

```sh
ROCKSHOWBOT_PUBLIC_ORIGIN='https://rockshowbot.sua-conta.workers.dev' python3 - <<'PY'
import json, secrets, os
from pathlib import Path
origin = os.environ['ROCKSHOWBOT_PUBLIC_ORIGIN'].strip().rstrip('/')
path = Path('.local/bridge/bridge.json')
if path.exists():
    raise SystemExit('Configuração existente preservada; não regenere a chave sem atualizar o Worker e o celular.')
descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w') as output:
    json.dump({'publicOrigin': origin, 'updateToken': secrets.token_urlsafe(32)}, output)
PY
```

Cadastre a mesma chave no Worker por stdin, sem colocá-la no histórico do shell:

```sh
python3 - <<'PY'
import json, subprocess
from pathlib import Path
settings = json.loads(Path('.local/bridge/bridge.json').read_text())
subprocess.run(['npx', 'wrangler', 'secret', 'put', 'ORIGIN_UPDATE_TOKEN', '--config', '.local/bridge/wrangler.jsonc'], input=settings['updateToken'] + '\n', text=True, check=True)
PY
```

## Configurar o aparelho

Transfira `bridge.json` para `~/.config/rockshowbot/bridge.json` no Termux pelo seu canal privado de administração, aplique `chmod 600` e confirme que a aplicação inclui `deploy/termux/bridge.py` e a versão atual de `tunnel.py`. Reinicie somente o serviço `rockshowbot-tunnel`. O helper mantém `ROCKSHOWBOT_SITE_ORIGIN` e `public-url.txt` com a URL fixa, guarda o endereço variável em `tunnel-url.txt` e repete a atualização se a rede estiver indisponível. A chave da ponte não permite administrar a conta Cloudflare, ler bancos ou autenticar no aplicativo.

No primeiro uso, aguarde o HTTPS da Cloudflare ficar disponível. Depois, abra a URL fixa, entre no painel e teste o acesso após reiniciar o túnel. A mudança de destino no KV pode levar 60 segundos ou mais para aparecer em outra região. Os cookies pertencem ao novo endereço; faça login novamente e atualize o endereço de destino na extensão de importação.

Se estiver migrando de um Site já pausado, sua rota privada `POST /api/automation/migration/destination` aceita `{"confirm":"update-migration-destination","destination":"https://seu-worker.sua-conta.workers.dev"}`. Ela só troca o redirecionamento e mantém os envios da origem desativados.

Para voltar ao túnel temporário, remova apenas a configuração da ponte do caminho ativo (por exemplo, renomeando `bridge.json` para `bridge.disabled.json`) e reinicie o serviço do túnel. Isso altera o endereço público de novo. Preserve a configuração e a chave para poder retomar a ponte.

## Limites e manutenção

O plano gratuito tem [100 mil requisições Workers por dia](https://developers.cloudflare.com/workers/platform/limits/) e [limites próprios de KV](https://developers.cloudflare.com/kv/platform/pricing/). Cada acesso externo usa a ponte; o agendador do celular continua fazendo suas consultas localmente. Este procedimento não ativa plano pago. O serviço depende de energia, internet no aparelho e disponibilidade da Cloudflare.

O Worker exige HTTPS, não armazena sessões nem conteúdo das páginas, não faz cache dos dados privados e não segue redirecionamentos do servidor com cookies anexados. O segredo só vai para a rota de atualização da ponte e permanece fora do Git. Faça backup dos bancos e preserve os arquivos privados `node.env`, `bridge.json` e a configuração Wrangler da sua instalação.
