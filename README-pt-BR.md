# Claude Code Usage

🌐 **Idioma**: [Página principal](README.md) · [English](README-en.md) · [Deutsch](README-de-DE.md) · [繁體中文](README-zh-TW.md) · [简体中文](README-zh-CN.md) · [日本語](README-ja.md) · [한국어](README-ko.md) · **Português (Brasil)** · [Bahasa Indonesia](README-id.md)

**Uso local do Claude Code e do Codex na barra de status do VS Code.** A
extensão lê registros locais e mostra cada provedor conforme o significado
dos seus dados. **Não é uma ferramenta de cobrança.**

## O essencial

- **Atualização e recuperação mais claras:** a pausa vale para as duas páginas,
  não para a coleta em segundo plano nem a barra de status. Falhas mantêm dados
  verificados; preenchimento de histórico e espera de nova tentativa são separados.
  Painéis ocultos sem mudanças reutilizam caches limitados.
  Históricos Codex concluídos não exibem avisos a cada novo registro; identidades
  ambíguas continuam como aviso de qualidade, sem repetir o preenchimento.
- **Prévias exatas e configurações seguras:** destino, formato e modelo de IA ficam
  visíveis, sem trocar de provedor silenciosamente. Share Cards exportam o SVG aprovado;
  controles alterados exigem nova prévia. Restaurar padrões preserva a chave de API,
  e o diretório Codex pode ser corrigido nas duas páginas de configurações.
- **Diagnósticos de preço limitados:** avisos de modelos desconhecidos são
  deduplicados e limitados por execução do Extension Host ([#122](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues/122)).
  Contribuições de
  análise já expiradas permanecem vazias sem atrapalhar a atualização incremental.
- **Novos modelos e atualização segura:** preços padrão/cache próprios para Opus 5.5,
  Sonnet 5.5, GPT-6.1 Sol, GPT-6 Sol e GPT-6 Luna. Campos de modelo inválidos não
  interrompem todo o índice; agregados são copiados uma vez por atualização. Resultados
  em segundo plano e consultas de preços têm limites. IDs Codex desconhecidos ficam sem preço.
- **Históricos grandes:** a atribuição de conteúdo sem mudanças usa cache, mantendo os
  controles de IA atualizados. Opções de exibição reaproveitam a indexação concluída;
  resultados atrasados não sobrescrevem preços atualizados.
  A atribuição de hoje usa cache por dia: consultas sem mudanças, espaçadas por minuto,
  atualizam a contagem regressiva sem percorrer todo o histórico dentro da mesma hora.
  A atualização horária dos painéis ocultos ainda recalcula a atribuição de conteúdo uma vez.
- **Atualização segura:** consultas sem mudanças mantêm prévias aceitas; mudar o diretório
  Claude limpa dados antigos mesmo com atualização pausada. Chaves existentes sem formato
  explícito mantêm Anthropic. Em caso de incompatibilidade, escolha formato e URL nas
  configurações e revise a prévia. Novas instalações usam o padrão OpenAI-compatible,
  sem redirecionar silenciosamente chaves antigas para outro host.
- **Claude Code:** custos estimados a partir de tokens e, quando a conta está
  autenticada, limites oficiais de 5 horas e semanais do perfil ativo.
- **Codex:** tokens processados hoje e saldo semanal restante da última
  observação local. Esse saldo não é uma consulta em tempo real à conta.
- **Painel:** hoje, últimos 30 dias, histórico, sessões, projetos e sugestões
  locais. Os gráficos podem detalhar mês, dia e hora sem reler os registros
  a cada clique.
- **Compartilhamento:** uma área única com prévia antes da exportação. SVG e
  Markdown locais não enviam dados; publicar no GitHub exige confirmação
  separada. A opção vem ativada e pode ser desativada nas configurações.

![Visão geral do Codex com dados sintéticos](images/v2.3.1/codex-overview-zh-CN-dark.png)

A imagem usa dados sintéticos, não informações de uma conta real. Veja mais
imagens e detalhes na [página principal completa em inglês](README.md).

## Conquistas locais (candidato)

Os detalhes abrem estatísticas atuais existentes de modelos/tokens do mesmo provedor, com retorno e foco preservado.
Não releem logs nem substituem evidências compartilhadas ou de períodos anteriores pelos totais atuais.

Ao desafixar um emblema antigo, o foco do teclado permanece no tema, sem atualizar os dados.
Os detalhes da exploração mostram coleção, prévia e exportação local bem-sucedida registradas.
Emblemas antigos não inventam etapas ausentes; feedback e configurações continuam separados.
O ícone não inclui números fixos. Novos avisos animam só o emblema uma vez por 440 ms;
texto, movimento reduzido e alto contraste ficam estáticos, sem som ou mudança de foco.

Modelos por tarefa e o total de tarefas multimodelo são experiências distintas.
Fable na mesma sessão exige saída de Fable e outra família Claude reconhecida
na mesma sessão, sem pressupor ordem de execução.

Desative **Mostrar avisos de conquistas** (`showAchievementNotices`) para manter
os prêmios e registros não lidos sem avisos flutuantes; reativar não repete avisos antigos.

Novos níveis de Token comprovados de Claude/Codex guardam estado não lido e dia
do primeiro registro mesmo com o painel pausado. São cobertos volume por família,
saída, leituras de cache, criação de cache do Claude e volume acumulado. Importações
e reconstruções manuais ficam silenciosas; outros prêmios ao vivo ainda precisam de prova da origem.

O registro local é limitado a 64 KiB. Datas antigas continuam desconhecidas;
novas ações salvas mantêm o estado não lido e o dia do primeiro registro mesmo
sem aviso. `achievements-v2.json` é o registro canônico; v1 é entrada de migração somente para leitura.
Registros já salvos sob as 21 condições alteradas de modelo/equipe/effort/arco-íris ficam num arquivo limitado, com datas desconhecidas preservadas; ouro antigo não comprova as novas regras.
A trava compartilhada v1, o marcador de limpeza v2 e a barreira v1 vazia para versões anteriores impedem que gravações antigas restaurem prêmios apagados; os logs originais dos provedores não são alterados.
Avisos aparecem apenas no painel visível em primeiro plano, no máximo a cada cinco
minutos entre janelas e reinícios. Só o lote com exibição confirmada é marcado como lido;
avisos perdidos continuam não lidos. Mouse ou foco do teclado pausam o fechamento.
Avisos perdidos ficam num resumo inicialmente recolhido, com até seis níveis exatos
por grupo. Apenas a confirmação explícita, após salvar localmente com sucesso,
marca esse grupo como lido; consultar, fixar e compartilhar não. Prêmios posteriores
de outras janelas continuam não lidos.
Conquistas recentes mostra até três séries novas; os registros recolhíveis mostram
até trinta níveis com links para as regras. Datas indicam o primeiro registro, não a
conquista original; datas históricas continuam desconhecidas. Consultar não marca como lido nem seleciona para compartilhar.
Ícones em cartões fechados e um seletor com busca permitem fixar até seis temas e definir sua ordem.
O modo manual mostra só os escolhidos; o automático recomenda até três.
Escolha e ordem persistem após reiniciar, sem selecionar medalhas para compartilhar.
Medalhas fixadas ocultas podem ser desafixadas na lista recolhível sem reativar o provedor.

Registros importados de uso do plugin não geram avisos. Novas ações salvas com sucesso
podem desbloquear emblemas com o painel fechado, sem abrir nem atualizar painéis ocultos.

O catálogo do código do candidato 2.4.2, ainda não lançado, tem 50 temas, 144 condições de desbloqueio e 52 grupos de arte: tokens por modelo, saída/cache,
atividade, recordes semanais e algumas ações deliberadas no plugin.
São 20 condições monetárias em seis temas separados de Claude/Codex: subtotal acumulado com preço conhecido, semanas encerradas que começam na segunda-feira e uso individual.
As semanas usam o fuso atual dos dados; uso individual é uma sessão Claude ou uma árvore de tarefa Codex verificada.
Preços de referência fixos em USD, com versão, exigem modelos exatos conhecidos e todas as tarifas dos componentes, incluindo TTL do cache Claude.
Modelos desconhecidos ficam sem preço; parcelas verificadas comprovam um limite inferior, não uma fatura, qualidade ou renda. O histórico monetário é silencioso; avisos de nova origem monetária ainda não estão conectados.
Modelo/equipe/effort/arco-íris combinam saída, repetição e volume. O gerador do mapa monetário e as bases de cálculo/barra de status do ritmo da cota semanal estão prontos; a interface principal e a integração de produção estão pendentes.
Cada série tem arte própria, compartilhada entre seus níveis coloridos. Os números são inteiros; limites dos dados ficam na seção expansível.
Evidências pendentes ou desatualizadas substituem o progresso zero e ficam fora do próximo alvo; emblemas conquistados são preservados.
Cartões fechados mostram o progresso até o próximo nível; etapas intermediárias nas longas escalas de tokens não geram prêmios, avisos ou opções de compartilhamento extras.
Pequeno / Médio / Grande alteram medalhas e molduras, preservando fonte e áreas de clique. Próximas metas destaca até três temas e exclui metas sem comprovação e modelos não utilizados.
Metas exigem progresso positivo atual; a ordem fica estável durante a visita. Clicar abre as regras sem ler logs nem selecionar para compartilhar.
Após indexação atual completa, linhagens Codex sem conflito podem comprovar marcos de tokens/agentes; conquistas de calendário ainda exigem identidade e datas verificadas por completo.
Séries e níveis têm contagens separadas. Filtros locais persistem após recarregar;
o próximo alvo aparece no cartão e as regras de todos os níveis ficam na seção expansível.
Ativas por padrão; desative **Local achievements** em ⚙ Settings
(`enableAchievements`) para interromper novos prêmios e o preenchimento adicional
de horas. A atualização mostra um aviso não modal uma única vez, com opção de
desativar; escolhas anteriores de desativação são preservadas. Conquistas históricas
ficam silenciosas; novos avisos são breves no painel, sem som ou mudança de foco.
Escolha até nove emblemas e exporte exatamente a prévia SVG; respostas antigas não
liberam a exportação. Há atalhos para voltar ao catálogo e localizar a opção de desativar, sem login
GitHub. Históricos com múltiplos logins não comprovam produtividade individual.
[Armazenamento e limpeza](LOCAL-DATA.md#local-achievements-242-candidate).

## Como interpretar os números

No Codex, **processado = entrada + saída** e **uso sem cache = entrada sem
cache + saída**. A entrada em cache já faz parte da entrada; os tokens de
raciocínio já fazem parte da saída. Não some essas parcelas outra vez. O
**custo equivalente de API** é apenas uma estimativa com preços conhecidos,
não uma fatura nem cobrança da assinatura. Custos e limites de Claude e Codex
não são somados entre si. Registros ausentes ou ainda não indexados podem
reduzir os totais mostrados; o limite do Codex é a última observação local.

## Instalação e privacidade

Procure `Claude Code Usage` em **Extensões** no VS Code ou execute
`ext install GrowthJack.claude-code-usage`. Abra o painel pela barra de status
ou pelo comando **Show Usage Details**. Idioma, diretório de dados e opções
de exibição ficam nas configurações. Os registros do Claude são lidos
localmente; o índice do Codex guarda agregados pseudônimos, não o conteúdo
das conversas. Os índices são separados por diretório de registros, salt do perfil
e fuso horário. Reconstruir afeta só o índice ativo; Apagar Tudo inclui todas as
famílias exatas de arquivos de índice nesse armazenamento da extensão.
Ao mudar de fuso horário, um checkpoint completo e comprovado da mesma origem
pode ser reutilizado em modo somente leitura; apenas os períodos de data/hora
são migrados, sem reconstruir o histórico principal do zero.
A orientação por IA é opcional: só envia uma solicitação após
prévia e envio explícito, com sua própria chave de API. Detalhes e formas de
apagar dados derivados: [Dados locais e privacidade](LOCAL-DATA.md).

Para a referência completa, consulte [inglês](README.md) ou
[chinês simplificado](README-zh-CN.md). Relate problemas e sugestões em
[Issues](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage/issues).

## Créditos e licença

A lista completa de autores de PRs e pessoas que relataram issues está nos
[créditos do README principal](README.md#credits), separando PRs integrados
de propostas que não foram integradas.

Licença MIT. A manutenção usa [Claude Code](https://claude.com/claude-code)
e [OpenAI Codex](https://developers.openai.com/codex/) como ferramentas;
contribuições humanas constam no [changelog](CHANGELOG.md).

[Licença MIT](LICENSE)
