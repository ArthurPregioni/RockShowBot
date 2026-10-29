# RockShowBot

Bot self-hosted que acompanha artistas e envia alertas por e-mail quando encontra eventos anunciados no Brasil ou em outros países. Projeto aberto, pequeno e fácil de estender.

## Requisitos

- Python 3.10+
- Chave da [Ticketmaster Discovery API](https://developer.ticketmaster.com/) para buscas de eventos
- SMTP para envio de e-mail (opcional; sem SMTP, eventos são salvos no banco)

O app usa apenas a biblioteca padrão do Python. A chave da API é opcional para abrir a interface, mas necessária para buscar eventos.

## Rodar localmente

```sh
cp .env.example .env
# Edite .env e configure TICKETMASTER_API_KEY e as variáveis SMTP
set -a
. ./.env
set +a
python3 rockshowbot.py
```

Abra http://localhost:8000, cadastre os artistas, informe seu e-mail e clique em **Buscar shows agora**. Brasil já vem configurado. Para adicionar regiões, use códigos ISO de duas letras, por exemplo AR (Argentina), CL (Chile) ou MX (México).

O banco SQLite local fica em `rockshowbot.db`. Guarde esse arquivo para preservar as preferências; ele está no `.gitignore`.

## Como funciona

- A interface permite cadastrar/remover artistas e países monitorados.
- Uma busca manual consulta eventos anunciados na Ticketmaster.
- IDs de evento são deduplicados no SQLite; só eventos novos disparam e-mail.
- As credenciais ficam em variáveis de ambiente e o endereço de e-mail nas configurações locais do SQLite.
- “Possível show” significa evento listado por uma fonte de eventos. O MVP não tenta confirmar rumores de redes sociais.

## Adicionar outra fonte

Implemente um adaptador com `name` e método `find(artist, countries)`, retornando eventos com `id`, `artist`, `title`, `venue`, `city`, `region`, `starts_at`, `url` e `source`. Em seguida, conecte-o à função `scan`. A lista de fontes deve respeitar os termos de uso e limites de cada provedor; evite scraping sem autorização.

## Limitações do MVP

- Uma fonte de eventos e busca manual; ainda não há agendamento automático.
- A busca por palavra-chave pode trazer homônimos; confira o link do evento.
- Não há OAuth/importação Spotify/Apple/Deezer. A lista manual evita depender de permissões e políticas de terceiros; integrações podem ser adicionadas como módulos opt-in.
- O servidor web deve ficar em rede confiável; antes de expor à internet, configure HTTPS e autenticação.

## Licença

MIT. Veja [LICENSE](LICENSE).
