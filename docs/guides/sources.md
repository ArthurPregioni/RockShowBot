# Fontes de shows e antecipações


O catálogo aberto em [`src/features/radar/catalog.json`](../../src/features/radar/catalog.json), publicado pelo endpoint `/radar-sources.json`, reúne **22 fontes oficiais**, além de **José Norberto Flesch** como fonte jornalística separada:

| País | Fontes oficiais |
| --- | --- |
| Brasil | Live Nation Brasil, 30e, Move Concerts, Eventim, Ticketmaster, Livepass, Lollapalooza Brasil, Rock in Rio Brasil |
| Argentina | DF Entertainment, AllAccess, Movistar Arena, Move Concerts |
| Chile | DG Medios, Bizarro Live Entertainment, PuntoTicket |
| Colômbia | Páramo Presenta, TuBoleta, Move Concerts |
| Peru | Teleticket, Move Concerts |
| Uruguai | RedTickets |
| Paraguai | Ticketea |
| Equador | TicketShow |
| Bolívia | SuperTicket |
| Venezuela | Ticketmundo |

O painel mostra os links do catálogo e quantas fontes atendem aos países salvos. Os 12 países da América do Sul continuam selecionáveis: Guiana e Suriname ainda não têm provedores fixos no catálogo e dependem da pesquisa das agendas dos artistas e locais. Outros países escolhidos explicitamente também entram nessa pesquisa. Não presumimos cobertura completa por cadastrar uma fonte.

A leitura direta roda em lotes de duas fontes, sem chaves de API, procura eventos JSON-LD nas agendas e segue até duas páginas relevantes por fonte. Só aceita eventos futuros com artista, país e data apoiados pelos dados da página; não converte a data de publicação em data do show nem atribui o intervalo inteiro de um festival a um artista. Eventos esgotados continuam relevantes; cancelados e adiados sem nova data são descartados. Os limites evitam excesso de requisições: a tarefa das 09h/21h recebe o catálogo, os links candidatos e os avisos e complementa a leitura pesquisando cada domínio oficial e a agenda de cada artista, sem janela de publicação.

O feed público do canal de [José Norberto Flesch](https://www.youtube.com/channel/UCOUkIsF8PZaadksaqp_ocHA) é consultado para antecipações com artista e Brasil no título. Se o feed falhar, o coletor tenta os vídeos carregados na página pública do canal, sem login ou endpoints privados. A pesquisa complementar também considera os perfis `@jnflesch`. O feed só contém vídeos públicos recentes; ele não representa todo o histórico, o conteúdo falado ou o acesso contínuo ao X/Instagram. Uma antecipação permanece **não verificada** até existir uma fonte oficial do evento. Google News também permanece complementar e não conta como uma das 22 fontes oficiais.

Algumas páginas exigem JavaScript, limitam requisições ou bloqueiam robôs. Um aviso informa falhas de leitura; uma resposta vazia não significa que não haverá shows. O bot respeita essas restrições, sem cookies de conta ou contorno de bloqueios. O catálogo não indica afiliação com os provedores.

Para customizar sua cópia, edite o catálogo com ID único, URL HTTPS da agenda pública, tipo e países ISO. Os coletores, o painel e o contexto da tarefa usam o mesmo arquivo. Uma fonte com formato diferente pode ganhar um adaptador em `src/features/radar/discovery.ts`, com testes de resposta em `tests/web/official-discovery.test.mjs`. O servidor Python independente ainda usa seus próprios adaptadores Ticketmaster/PredictHQ; o catálogo e a pesquisa em nuvem descritos aqui são da versão Sites.

Diagnóstico real das fontes, sem gravar eventos nem enviar e-mails:

```sh
npm run sources:check -- "Sepultura" "Iron Maiden"
```

