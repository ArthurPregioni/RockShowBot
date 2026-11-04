# Painel completo no Android/Termux

O painel React pode rodar em **Node nativo com SQLite**, mantendo as telas, a extensão Apple Music/Spotify, o catálogo ampliado e as regras de consolidação e recibos. Esse destino usa o mesmo código do radar e substitui os serviços D1 e de autenticação do Sites por adaptadores locais. O [servidor Python alternativo](termux-python.md) continua disponível, com menos recursos.

O destino Node tem uma tela de login, sessões revogáveis e contas separadas. Cada pessoa tem seu banco de artistas, países, preferências e histórico. O administrador cria contas em **Conta → Criar conta**, entrega a senha inicial por um canal privado e pode configurar um remetente SMTP comum. A pessoa pode alterar a própria senha; o e-mail de alertas é individual. O operador do aparelho continua tendo acesso aos arquivos dos bancos.

## Preparar o artefato no computador

Use Node 22.13+ com `node:sqlite` disponível. O build é feito no computador para evitar instalar Vite, workerd ou um ambiente de compilação no celular.

```sh
npm ci
npm run test:node
npm run build:node
npm run test:node:integration
tar -czf /tmp/rockshowbot-web.tar.gz -C dist/standalone .
```

`dist/standalone` inclui o painel compilado, as dependências de execução e os scripts de operação. Sua entrada `server.js` exige login. Ele não inclui banco, `.env`, chaves ou credenciais da instalação. Não use o artefato da hospedagem Sites no Android: esse destino depende de Workers/D1.

## Instalar no Termux

Instale Termux seguindo as instruções da distribuição escolhida. No aparelho, são necessários:

```sh
pkg install nodejs-lts python openssh termux-services
```

Copie o artefato para o aparelho pelo USB/SSH e extraia-o em uma pasta própria:

```sh
mkdir -p ~/apps/rockshowbot-web
tar -xzf ~/rockshowbot-web.tar.gz -C ~/apps/rockshowbot-web
bash ~/apps/rockshowbot-web/deploy/termux/install-web.sh
```

A instalação gera `~/.config/rockshowbot/node.env` e `login.txt`, ambos privados. A senha inicial fica em `login.txt`; seu hash fica na configuração. Reexecutar o instalador preserva a configuração. Não publique nenhum desses arquivos.

```sh
export SVDIR="$PREFIX/var/service"
export LOGDIR="$PREFIX/var/log"
service-daemon start
sv-enable rockshowbot-web
sv -w 20 up "$SVDIR/rockshowbot-web"
```

Na primeira inicialização do supervisor, aguarde a criação de `rockshowbot-web/supervise/ok` antes de chamar `sv`. Abra `http://127.0.0.1:8765` no aparelho e entre com as credenciais geradas.

## Acesso fora de casa

O servidor escuta em loopback. Para acesso externo, coloque-o atrás de HTTPS. Um túnel temporário gratuito permite começar sem abrir portas no roteador:

```sh
pkg install cloudflared
bash ~/apps/rockshowbot-web/deploy/termux/install-tunnel.sh
sv -w 20 up "$SVDIR/rockshowbot-tunnel"
cat ~/.config/rockshowbot/public-url.txt
```

O túnel cria um endereço `https://...trycloudflare.com`. O helper atualiza `ROCKSHOWBOT_SITE_ORIGIN` e reinicia somente o painel quando o endereço muda. **Esse endereço muda quando o processo do túnel reinicia**, inclusive após reboot. Para um endereço permanente, configure um domínio com um túnel nomeado ou outro acesso HTTPS fixo. A autenticação é exigida também nas rotas de automação; cabeçalhos de identidade enviados pelo navegador são descartados.

Outras pessoas podem acessar esse endereço de qualquer rede, entrar nas próprias contas e usar seus próprios e-mails de alertas. Na extensão do navegador, cada pessoa informa o endereço HTTPS desta instalação. O computador usado para instalar o servidor pode ficar desligado.

## Agendamento e e-mail

Edite `node.env` para ativar `ROCKSHOWBOT_SCHEDULER=true` e reinicie o painel. O agendador executa consultas às 09h/21h de Brasília, para todas as contas, e verifica confirmações de preferências a cada minuto. As consultas usam os coletores de fontes oficiais, Flesch, notícias e APIs configuradas. Fontes bloqueadas ou dependentes de JavaScript continuam com cobertura parcial; a pesquisa complementar feita por uma tarefa com navegador no Sites não se transforma automaticamente em pesquisa por IA no celular.

Em **Conta → Configurar remetente de e-mail**, o administrador informa SMTP, usuário, credencial de aplicativo e remetente. A credencial fica no arquivo privado e não é exibida novamente. O serviço SMTP é de saída: não exige porta de entrada no roteador. **Sem SMTP, as mensagens permanecem pendentes e não são marcadas como enviadas.**

Uma conta gratuita exclusiva do bot pode ser usada como remetente, desde que o provedor permita SMTP. Google e outros provedores podem exigir verificação de identidade, CAPTCHA e uma credencial de aplicativo. O bot não cria caixas postais nem contorna essas verificações. A senha de login do painel é independente da senha do e-mail.

## Inicialização e operação

O instalador cria `~/.termux/boot/50-rockshowbot-web`. Distribuições que usam Termux:Boot exigem o plugin da mesma origem e sua abertura inicial. A variante Google Play pode oferecer o receptor de boot integrado; confirme no aparelho. Retire as restrições de bateria do Termux e mantenha o wake lock. Valide uma reinicialização real e operação com tela apagada; supervisão não impede o Android de encerrar o aplicativo inteiro.

```sh
sv status "$SVDIR/rockshowbot-web" "$SVDIR/rockshowbot-tunnel"
sv -w 20 restart "$SVDIR/rockshowbot-web"
tail -n 80 ~/.local/state/rockshowbot-web/logs/current
# Desabilitar também a próxima inicialização:
sv-disable rockshowbot-web
sv-disable rockshowbot-tunnel
```

A supervisão reinicia um processo que falhou. O script de boot respeita os serviços desabilitados. A configuração do servidor e os bancos ficam fora do artefato e são preservados ao atualizar o código. Os logs têm rotação de aproximadamente 1 MiB e cinco arquivos anteriores.

## Dados, backup e atualização

| Caminho | Conteúdo |
| --- | --- |
| `~/apps/rockshowbot-web/` | Artefato compilado |
| `~/.config/rockshowbot/node.env` | Configuração e credenciais privadas |
| `~/.config/rockshowbot/login.txt` | Credenciais iniciais; a senha pode ter sido alterada depois |
| `~/.local/share/rockshowbot/web.db` | Radar do administrador, contas e sessões |
| `~/.local/share/rockshowbot/users/<id>.db` | Radar de cada outra conta |
| `~/.local/state/rockshowbot-web/logs/` | Logs do painel |

```sh
python ~/apps/rockshowbot-web/deploy/node/backup.py
```

O backup usa a API SQLite para capturar os bancos mesmo com o serviço ativo. Contém hashes de integridade e dados pessoais, inclusive hashes de senha e sessões; guarde-o de forma privada. Ele não inclui as credenciais SMTP do arquivo de configuração. Preserve `node.env` separadamente. Esse formato é diferente do backup do servidor Python.

Para atualizar, gere um novo artefato no computador, faça backup, pare somente `rockshowbot-web`, extraia em uma pasta nova, preserve a pasta anterior e troque os caminhos do serviço ou mantenha o caminho original da aplicação. Reexecute `install-web.sh`/`install-tunnel.sh` e inicie o serviço. Os diretórios de dados não devem ser substituídos pelo artefato.

## Migração do Sites

A rota privada `/api/automation/migration/export` exporta artistas, eventos, preferências, recibos, resumos congelados, confirmações e histórico de buscas em um único lote D1. Exige o mesmo acesso de serviço do Site privado; sessões temporárias de importação e segredos da hospedagem não entram no arquivo. Guarde o JSON fora do repositório.

Com o destino parado e sem artistas cadastrados:

```sh
node deploy/node/import-cloud.mjs /caminho/backup.json ~/.local/share/rockshowbot/web.db
```

O importador mantém datas, classificações, flags e recibos. Recusa sobrescrever um banco que já tenha artistas. Os alertas do destino ficam desativados durante a transição. **Só encerre o emissor antigo depois de configurar e validar o novo envio.** Antes da troca definitiva, concilie os envios feitos na instância antiga após o snapshot para evitar repetições. O export não cria contas de e-mail e não transfere credenciais do Gmail conectado ao Sites.
