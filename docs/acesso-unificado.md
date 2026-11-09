# Acesso unificado opcional

Esta integração é para instalações em que RockShowBot, CasaHub e Finanças são administrados pela mesma pessoa, no mesmo servidor e no mesmo domínio base. Cada projeto continua independente e, por padrão, usa seu login local.

Quando habilitada, a página de login dos hubs redireciona para o RockShowBot. A senha continua apenas na conta do RockShowBot; nenhum hash ou senha é copiado para os hubs. O acesso pessoal exige a conta `local-owner` com papel `admin`. Outras contas, inclusive outros administradores, não ganham acesso aos hubs.

Cada navegador possui uma sessão própria, persistida no banco central. A sessão expira após **180 dias sem atividade**, com renovação de validade no máximo uma vez por dia. Reiniciar navegador, computador ou serviço preserva sessões válidas. Navegação privativa ou apagar cookies encerra a persistência local. Não há limite de quatro aparelhos.

A opção **Aparelhos conectados**, disponível em `/access`, informa navegador/sistema, criação, último uso e validade. É possível desconectar um navegador ou todos os outros. Sair de um hub revoga a sessão central e encerra o acesso do mesmo navegador aos três aplicativos. Alterar a senha no RockShowBot revoga todas as sessões daquela conta. O nome de um navegador não prova a identidade física de um aparelho.

## Configuração

No ambiente privado do RockShowBot:

```dotenv
PERSONAL_ACCESS_DOMAIN=servicos.example.test
PERSONAL_ACCESS_TARGETS={"casahub":"https://casahub.servicos.example.test/","financas":"https://financas.servicos.example.test/"}
```

Em cada hub, acrescente `personal_access` à configuração privada, ajustando `service` para `casahub` ou `financas`:

```json
{
  "personal_access": {
    "enabled": true,
    "database": "~/.local/share/rockshowbot/web.db",
    "cookie_domain": "servicos.example.test",
    "origin": "https://app.servicos.example.test",
    "service": "casahub"
  }
}
```

O banco deve ser o mesmo arquivo configurado por `DATABASE_PATH` no RockShowBot. Inicie primeiro a versão atualizada do RSB, que migra somente o cadastro de sessões. Os hubs consultam exclusivamente a autorização e as sessões e atualizam validade/último uso; não leem dados de shows. Quando o login central está habilitado, credenciais e sessões locais antigas dos hubs não são aceitas.

O cookie compartilhado usa HTTPS, HttpOnly e SameSite=Lax e contém apenas um token aleatório; o banco guarda seu hash. O navegador o envia aos subdomínios desse domínio base. Por isso **todos os aplicativos nesse domínio fazem parte da mesma fronteira de confiança**: não hospede conteúdo de terceiros não confiável ou dê subdomínios a terceiros nele. Os formulários continuam exigindo origem e CSRF; os tokens não ficam em localStorage nem aparecem na listagem de aparelhos. Mantenha o arquivo SQLite privado ao usuário dos serviços e inclua-o nos backups.

O login central aplica espera progressiva por origem após falhas, persistida entre reinícios, com teto de 15 minutos. Não há bloqueio global da conta que permitiria a um atacante expulsar o proprietário. Os limites do gateway continuam ativos e as sessões válidas não são encerradas por falhas de senha.
