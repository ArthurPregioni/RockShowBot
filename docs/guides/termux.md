# Preparar um Android com Termux

Este preset prepara o **servidor Python independente** para funcionar no Termux nativo, sem root, Docker, proot ou instalação Node. Ele instala somente os arquivos do RockShowBot. O perfil inicial usa `127.0.0.1:8765`, senha gerada no aparelho e dados fora do checkout, para conviver com outros serviços no celular.

**Estado da migração:** esta preparação não transfere o painel Sites, os dados da nuvem ou as tarefas Gmail. O backend Python tem recursos diferentes. Antes de trocar a instância principal, siga a seção de migração ao fim deste guia. A hospedagem atual continua operando até a troca ser executada deliberadamente.

## 1. Preparar o Motorola One Fusion+ ou outro Android

Instale Termux e Termux:Boot pela mesma origem, seguindo as [instruções oficiais de instalação](https://github.com/termux/termux-app#installation). Plugins e aplicativo principal precisam ter assinaturas compatíveis. **Abra o Termux:Boot uma vez** para habilitar sua execução após reiniciar, conforme o [guia oficial](https://github.com/termux/termux-boot#how-to-use).

No Termux:

```sh
pkg update
pkg install git python termux-services nano
mkdir -p ~/apps
git clone https://github.com/ArthurPregioni/RockShowBot.git ~/apps/rockshowbot
cd ~/apps/rockshowbot
python deploy/termux/manage.py install
```

Se já clonou nesse caminho, use sua cópia existente. O instalador não inicia buscas nem envia mensagens. Ele gera uma senha administrativa aleatória e deixa o serviço parado até você configurá-lo e executar `rockshowbot start`. Reexecutar `install` preserva a configuração, os dados e o estado de ativação.

`termux-services` fornece supervisão por runit. Se houver problema com o supervisor, reabra o Termux após instalar o pacote, como orienta sua [documentação](https://github.com/termux/termux-services).

## 2. Configurar

```sh
nano ~/.config/rockshowbot/server.env
```

A senha gerada está em `APP_PASSWORD`; use-a para entrar no painel com `APP_USER=admin`. O arquivo tem permissão restrita ao usuário do Termux. Trate-o como configuração de dados: `CHAVE=valor`, com aspas para valores com espaços ou `#`. Não há execução de comandos nem expansão de variáveis nesse arquivo.

Preencha os provedores e SMTP que vai usar:

```dotenv
TICKETMASTER_API_KEY=
PREDICTHQ_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM="RockShowBot <voce@example.com>"
SMTP_STARTTLS=true
```

Para buscas reais nesta versão, configure Ticketmaster ou PredictHQ. Sem eles, a interface aceita artistas e dicas manuais. SMTP vazio mantém os alertas pendentes. Depois de configurar SMTP, salve o e-mail de destino no painel. Os detalhes estão no [guia do servidor Python](standalone.md).

A porta padrão é **8765**. Pode mudá-la em `PORT` se outro serviço já a usar. `DATABASE_PATH` é gerenciado pelo preset; fica fixo no diretório persistente da aplicação. O agendador Python consulta os provedores a cada `SCAN_INTERVAL_HOURS` horas; a primeira busca automática ocorre depois desse intervalo. Também é possível iniciar uma busca pelo painel.

## 3. Iniciar e operar

```sh
rockshowbot doctor
rockshowbot start
```

No navegador **do celular**, abra <http://127.0.0.1:8765>. O login usa a senha do arquivo privado. `doctor` mostra modelo, versão do Android e arquitetura detectados no aparelho, caminhos, estado do serviço e se SMTP/fontes foram configurados. Ele não imprime senhas, tokens ou chaves.

```sh
rockshowbot status
rockshowbot logs
rockshowbot restart
rockshowbot stop
```

`restart` aplica mudanças na configuração. `stop` também desabilita a inicialização automática do RockShowBot; `start` a habilita novamente. Falhas do processo são supervisionadas pelo runit. Os logs têm rotação de aproximadamente 1 MiB por arquivo, com cinco arquivos anteriores.

O comando `run` é a entrada interna do supervisor; não é necessário executá-lo manualmente. A instalação recusa sobrescrever um serviço homônimo que não tenha sido criado por este preset.

## 4. Funcionamento após reiniciar e com a tela apagada

O instalador cria somente `~/.termux/boot/50-rockshowbot`, respeitando outros scripts de boot. Quando o serviço estiver habilitado e o Termux:Boot executar, esse arquivo chama o gerenciador para iniciar a aplicação. Se você usou `rockshowbot stop`, o script não a inicia no próximo boot.

Com `WAKE_LOCK=true`, iniciar o serviço solicita `termux-wake-lock`, mecanismo previsto no [guia Termux:Boot](https://github.com/termux/termux-boot#how-to-use). Você pode desativar essa solicitação na configuração. Parar o RockShowBot não libera o wake lock global, porque outros serviços do celular podem precisar dele. Quando todos os serviços estiverem parados e quiser liberar o lock, use `termux-wake-unlock`.

Revise as restrições de bateria/segundo plano do Termux nas configurações do Android. Os nomes das opções variam conforme a versão e o fabricante. O projeto Termux documenta [restrições e encerramentos de processos no Android](https://github.com/termux/termux-app#installation); supervisão e wake lock não garantem operação contínua se o sistema encerrar o próprio Termux. A validação real precisa incluir reboot e um período com tela apagada no seu aparelho.

## 5. Onde ficam os arquivos

| Local no Termux | Conteúdo |
| --- | --- |
| `~/apps/rockshowbot/` | Código; pode ser atualizado por Git |
| `~/.config/rockshowbot/server.env` | Senha, chaves, SMTP e preferências de execução |
| `~/.local/share/rockshowbot/rockshowbot.db` | Artistas, países, e-mail e histórico SQLite |
| `~/.local/share/rockshowbot/backups/` | Backups do banco |
| `~/.local/state/rockshowbot/logs/` | Logs com rotação |
| `~/.local/state/rockshowbot/boot.log` | Diagnóstico de inicialização após reboot |
| `$PREFIX/var/service/rockshowbot/` | Serviço runit desta aplicação |
| `$PREFIX/bin/rockshowbot` | Comando de operação |
| `~/.termux/boot/50-rockshowbot` | Inicialização do RockShowBot após reboot |

Use o armazenamento privado do Termux, fora de `/sdcard` e `~/storage/shared`, para manter permissões e semântica de arquivos Linux. Código e dados separados permitem acrescentar outros projetos ao celular sem misturar bancos, credenciais e serviços.

## 6. Backup, restauração e atualização

```sh
rockshowbot backup
```

O comando informa o caminho do `.tar.gz` criado. Ele usa a API de backup SQLite, inclusive com o serviço ativo. O arquivo contém o banco e um manifesto com hash de integridade; **não inclui o arquivo de configuração nem credenciais SMTP/API**. O banco contém dados pessoais como e-mail e artistas: guarde o backup de forma privada e copie-o para outro dispositivo. Preserve `server.env` separadamente quando quiser recuperar também as credenciais de uma instalação.

Para restaurar um backup deste backend:

```sh
rockshowbot restore /caminho/rockshowbot-backup.tar.gz
```

A restauração valida o arquivo, para somente o RockShowBot, preserva um backup do banco anterior e restaura o SQLite. O serviço permanece parado até `rockshowbot start`. Arquivos de outros backends, inclusive D1/Sites, são rejeitados; não renomeie um dump D1 para tentar importá-lo.

Para atualizar o código:

```sh
rockshowbot backup
rockshowbot stop
cd ~/apps/rockshowbot
git pull --ff-only
python deploy/termux/manage.py install
rockshowbot start
```

O instalador atualiza os lançadores, preservando o arquivo privado e o banco. Se mudar o caminho do checkout, execute novamente o instalador na nova localização para atualizar os caminhos dos lançadores.

## 7. Acesso por outros dispositivos

O preset escuta apenas no próprio aparelho. Para administrar a partir do computador, vamos configurar um acesso privado ou um encaminhamento de porta na etapa de rede do celular. Mudar `HOST` para `0.0.0.0` torna a aplicação acessível pelas interfaces de rede; antes disso, defina como o acesso será protegido e como HTTPS será oferecido. O login atual é HTTP Basic.

O envio SMTP é uma conexão de saída e não exige abrir uma porta do roteador. O preset não cria túneis públicos, contas SSH, encaminhamentos de porta ou serviços de rede adicionais.

## 8. Antes da migração definitiva do Sites

A preparação do Android está implementada, mas **o painel atual ainda não é executável completo no Termux**. Os seguintes pontos precisam ser portados e verificados antes de trocar a instância principal:

- Importação pela extensão Apple Music/Spotify, catálogo e Deezer público, com autenticação própria do destino.
- Coleta ampliada das 22 fontes oficiais e Flesch; o backend Python atual tem apenas Ticketmaster/PredictHQ e dicas manuais.
- Regras de consolidação de shows/rumores, recibos de envio e confirmação de preferências do painel atual.
- Exportação consistente do D1 e conversão de artistas, países, preferências, eventos, arquivamentos e histórico de notificações. O backup deste preset cobre apenas SQLite do Python.
- Agendamento local equivalente às rotinas atuais e envio de e-mail com confirmação real, sem duplicar as tarefas Gmail da nuvem.
- Acesso privado, recuperação após reboot, conectividade e estabilidade com tela apagada no Motorola.

Na troca, preserve um backup da instância atual, valide o destino, depois desative as tarefas antigas e habilite o novo emissor de alertas. A preparação não executa nenhuma dessas mudanças na nuvem.

## QA disponível

`python3 -m unittest discover -s tests/selfhosted -v` inclui testes do instalador em diretórios temporários, preservação de outras aplicações, configuração sem execução de shell, backup/restauração, rejeição de arquivos inválidos e servidor Python real com login e encerramento por SIGTERM. Esses testes rodam em Linux e não equivalem à validação do Termux no aparelho físico.

Em um computador Linux com Docker, `python3 tests/integration/termux-runit.py` verifica instalação, serviço runit real, login e gravação via HTTP, recuperação após falha forçada, boot habilitado/desabilitado, backup/restauração e preservação de outro serviço. A execução usa um contêiner descartável, sem montar dados privados do computador. O wake lock é simulado; esse teste também não comprova o comportamento do Android físico. A CI executa essa verificação junto do job Python 3.12.
