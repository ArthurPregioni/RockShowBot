# Segurança

Para comunicar uma vulnerabilidade, use **Security → Advisories → Report a vulnerability** no repositório GitHub, quando o relato privado estiver habilitado. Se essa opção não estiver disponível, abra uma issue apenas pedindo um canal privado; não publique credenciais ou instruções exploráveis com dados de uma instalação real.

Informe a versão/commit, a aplicação afetada, o impacto e passos de reprodução usando dados fictícios. Se uma credencial tiver sido publicada, o operador deve revogá-la no provedor e substituí-la. Apagar um arquivo do último commit não remove versões anteriores do histórico.

## Limites de cada aplicação

- O painel web depende do **Sites privado ao proprietário**, incluindo a autorização de serviço nas rotas de automação. Ele compartilha um único radar por instalação e não tem autorização para múltiplos usuários independentes. Não exponha esse Worker diretamente como serviço anônimo.
- O servidor Python tem login administrativo por HTTP Basic. Na internet, use HTTPS no proxy ou na hospedagem, senha forte e armazenamento persistente protegido. Ele também tem um único radar por instalação.
- A extensão só deve enviar a lista de artistas para a instalação escolhida pelo usuário. A autenticação no streaming ocorre no próprio provedor. Credenciais de contas, cookies de streaming e endpoints privados não fazem parte do importador.

## Instalação Termux

O preset Android mantém configuração e banco no armazenamento privado do Termux e escuta em loopback por padrão. Backups contêm dados pessoais do banco, mas não incluem o arquivo de credenciais. Os comandos operam apenas no serviço RockShowBot e não liberam o wake lock global ao parar, para respeitar outros serviços do aparelho. A preparação não replica a autenticação ou os recursos do painel Sites.

## Arquivos privados

Guarde valores reais em `.env`, `.dev.vars` ou nos segredos da hospedagem. O `.gitignore` exclui esses arquivos, bancos, chaves privadas e a identidade local do Site. Os exemplos versionados têm somente nomes de variáveis e valores fictícios. Não inclua exports do banco ou logs de sessões em issues e pull requests.

Execute `npm audit` para consultar os avisos atuais das dependências Node e `npm run check:repo` para a checagem local do repositório. Atualizações passam pelos testes e pelo build; não use `npm audit fix --force` sem avaliar mudanças incompatíveis. A CI verifica o código em pull requests sem acesso a credenciais de produção.
