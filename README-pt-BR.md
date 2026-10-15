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

A versão 2.5.0 reúne conquistas locais e suporte a `.jsonl.zst` do Codex em `sessions` e `archived_sessions`. Zstd é compressão sem perdas, não um resumo por LLM: arquivos menores preservam a contagem de tokens registrada. A leitura é local, sem alterar os logs nem salvar cópias descompactadas em texto; o `.jsonl` de mesmo nome na mesma pasta tem prioridade. Zstd nativo (Node 22.15+ / 23.8+) não adiciona dependências; hosts incompatíveis informam a limitação e mantêm os últimos totais verificados.

## Conquistas locais (2.5.0)

As datas das sessões usam a mesma admissão completa do índice canônico; logs alterados exigem nova calibração. O uso novo verificado mantém seu primeiro registro mesmo após cancelamento. Salvamentos parciais são informados separadamente.

Expandir tudo / Recolher tudo salva apenas a abertura dos cartões no estado local
de interface existente, sem alterar fontes ou concessões. Os níveis são Bronze /
Prata / Ouro; IDs, itens fixados e tabelas de referência permanecem iguais.
Condições e unidades exatamente iguais aparecem uma vez. Uma seção comum de referência
monetária mostra a tabela atual e sua data por provedor ativo, além do aviso de que não
se trata de uma fatura. Tabelas históricas diferentes mantêm a associação exata com cada
conquista; os cartões preservam escopo e cobertura de preços sem repetir notas de preço/base.
Cartões completos mostram o
valor atual sem corte; evidências antigas ou ausentes não são substituídas pela meta.

Nas linhas expandidas, o nome usa cores do tema por nível (cor de primeiro plano em
alto contraste), com o limite em negrito e alinhado à direita no mesmo cabeçalho.
Só o nível seguinte ao maior conquistado mostra “Em andamento” quando a comprovação
está pronta; níveis posteriores, cartões completos e comprovação pendente não mostram
esse rótulo. Datas verificadas nos logs preservados aparecem apenas em ISO; o significado
é explicado uma vez em “Base dos dados” e a origem permanece em title/ARIA. Quando ambas
as datas existem, só a verificada fica visível; o primeiro registro permanece em title/ARIA.
Se houver apenas o primeiro registro, seu rótulo explícito permanece; datas desconhecidas
continuam desconhecidas. A mudança visual não altera concessões, regras, cálculos de datas
nem registros salvos.

**Tarefas raiz independentes** conta raízes Codex com vínculo verificável e uso positivo
de um modelo reconhecido (entrada ou saída). A raiz e suas subtarefas contam uma única
vez; não é uma contagem de tarefas concluídas. IDs e limites das regras existentes permanecem iguais.

A navegação e o título da página passam a ser **Compartilhar e comparar**. As opções de
emblemas têm largura igual e o nível em linha separada. A correção dos ícones
de seleção usa a mesma origem local permitida pela CSP do Webview principal. O SVG
exportado inclui o [link público fixo do repositório](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage)
e quebra rótulos longos para evitar sobreposição. Prévia/exportação não adiciona pedidos
automáticos de rede nem metadados pessoais e preserva a seleção explícita e o SVG aceito
imutável. A unificação visual/embelezamento amplo da página e um arquivo durável de uso
ficam para a próxima versão; nenhum dos dois está implementado na versão 2.5.0.

As datas por nível são derivadas apenas na memória e indicam a data mais antiga
verificável nos logs preservados, não o histórico completo da conta. Não substituem
o primeiro registro salvo nem o estado não lido. Agregados diários fornecem datas
suportadas de uso, saída, cache, modelo/família, atividade e semanas. Só a recalibração
manual também agrega registros Claude já mantidos na memória para sessões com saída,
sessões Fable e Fable/outra família na mesma sessão; atualizações normais com dados
já carregados não reagrupam esses registros. Condições sem suporte mantêm a data
desconhecida ou o primeiro registro salvo.

A recalibração é local, incremental e executa uma operação por vez, sem forçar uma
varredura completa, apagar emblemas ou fazer chamadas OAuth, de preços, BYOK ou de
outra rede. Não força concessões; ocupado, inventário atual do índice não aceito ou
falha não significa sucesso. Histórico parcial verificado mantém limites inferiores
ou valores desconhecidos; concluir não implica cobertura completa de todos os escopos.
Cancelar antes do commit histórico não adiciona concessões históricas; após o commit, não desfaz os
registros salvos nem altera o resultado bem-sucedido. A reconciliação histórica é
silenciosa.
[Limites de datas e armazenamento](LOCAL-DATA.md#local-achievements-250).

O reconhecimento de modelos para colaboração/arco-íris é separado dos preços, mantendo sem preço os modelos reconhecidos sem tarifa; registros monetários preservam os rótulos das tabelas publicadas, e picos apenas do Claude resistem a mudanças independentes de versão do Codex.
Registros carregando, indisponíveis, alterados e desativados têm estados explícitos em vez de contagens vazias; o uso cumulativo verificado do Claude mostra `≥` enquanto as evidências do Codex ativado não forem verificadas.
Os próximos objetivos mostram nome e nível de destino, os cartões conquistados mantêm o nível obtido e as exportações SVG mostram cada nível uma única vez.

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
e reconstruções manuais ficam silenciosas; valores cumulativos de referência API têm prova própria, e outros escopos ainda aguardam sua origem.

O registro local é limitado a 64 KiB. Datas antigas continuam desconhecidas;
novas ações salvas mantêm o estado não lido e o dia do primeiro registro mesmo
sem aviso. Os prêmios salvos persistem após reiniciar e são compartilhados entre janelas.
Prêmios de regras antigas mantêm seu histórico, mas não comprovam condições novas. A limpeza não altera os logs dos provedores.
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

Ao compartilhar explicitamente, é possível escolher emblemas conquistados e preservados de um provedor desativado.
A galeria e as novas fixações seguem os provedores ativados; emblemas preservados não comprovam
progresso atual nem autorizam novas conquistas.

Registros importados de uso do plugin não geram avisos. Novas ações salvas com sucesso
podem desbloquear emblemas com o painel fechado, sem abrir nem atualizar painéis ocultos.

Logs de agentes no mesmo diretório, sem sessão-pai comprovada pelo caminho, não
contam como evidência para conquistas de sessão. Tokens, preços, totais diários e
linhas de sessão visíveis não mudam; a atribuição aninhada e os emblemas salvos são preservados.

A galeria da versão 2.5.0 tem 50 temas, 178 condições de desbloqueio e 52 grupos de arte: tokens por modelo, saída/cache,
atividade, recordes semanais e algumas ações deliberadas no plugin.

Quinze séries de Claude/atividade recebem Platina e Lendário, preservando as três metas iniciais, evidências e arte. Dias ativos, saída e sessões permitem progresso com três dias concentrados por semana, sem Codex ou maior gasto. As séries de dias consecutivos não são ampliadas.

São 24 condições monetárias em seis temas separados de Claude/Codex: subtotal acumulado com preço conhecido, semanas encerradas que começam na segunda-feira e uso individual.
As duas séries semanais têm cinco níveis: Bronze US$ 100, Prata US$ 500, Ouro US$ 2.500,
Platina US$ 10.000 e Lendário US$ 25.000. Só os dois últimos por provedor são novos;
IDs/limites antigos, exigência de semana encerrada e base de preços de referência fixos permanecem iguais.
As semanas usam o fuso atual dos dados; uso individual é uma sessão Claude ou uma árvore de tarefa Codex verificada.
Preços de referência fixos em USD, com versão, exigem modelos exatos conhecidos e todas as tarifas dos componentes, incluindo TTL do cache Claude.
Modelos desconhecidos ficam sem preço; parcelas verificadas comprovam um limite inferior, não uma fatura, qualidade ou renda. Só marcos monetários cumulativos de novos acréscimos verificados, com a mesma referência, salvam estado não lido e primeiro dia registrado. Histórico, semanas e sessões/tarefas individuais continuam silenciosos com datas desconhecidas; provas de Token/dinheiro são independentes e compartilham um lote de aviso, sem datas otimistas se a gravação falhar.
O cartão Codex effort existente mostra, quando expandido, seis níveis com Tokens, saída, tarefas raiz, progresso conjunto e subtotal informativo USD fixo/cobertura. Cada raiz × effort precisa de saída própria positiva, sem approval-reviewer; atribuição ambígua de modelo não é dividida por proporção. Prova ausente fica desconhecida; sem novas regras/preferências ou atribuição Claude effort.
Modelo/equipe/effort/arco-íris combinam saída, repetição e volume.
O mapa oferece Claude / Codex / Ambos e Tokens por padrão; valores equivalentes à API exigem escolha explícita e usam estimativas diárias atuais, não preços das conquistas.
Claude é estimado; Codex usa apenas preços de modelos exatos conhecidos. Preços ausentes e limites inferiores têm indicação de cobertura; valores dos provedores nunca são somados.
A cobertura Claude consulta apenas taxas de modelos/componentes selecionados em memória; fallback Sonnet genérico de modelo desconhecido não conta. Taxa ausente fica sem preço, zero explícito vale; custos salvos não são recalculados. Token/valores ocultos não consultam taxas ou dinheiro.
Ocultar valores restaura cores, textos e Markdown de Tokens e invalida a prévia antiga. A exportação salva os mesmos bytes SVG, com verificações antes e depois do diálogo, sem nova leitura de logs ou rede.
**Ritmo da cota semanal** (`showWeeklyQuotaPace`) vem desligado e reutiliza observações: 29% usado com 25% do ciclo decorrido projeta 116%.
Não há previsão nas primeiras seis horas, após trinta minutos sem nova observação ou após o reset. Credenciais invalidadas retiram a previsão mesmo com o painel pausado; mudanças de conta/origem e quedas do contador exigem uma virada normal de sete dias verificada.
Logs Codex não verificam a conta, portanto a previsão está indisponível. Painel e tooltip compartilham traduções; texto da barra e formatos próprios ficam iguais. Sem novas requisições, timers ou histórico.
Quando a atribuição de conta é incerta, os valores total e não utilizado equivalentes
à API do ciclo atual continuam sendo estimativas locais de baixa confiança, não saldos
de conta. A separação precisa por conta fica para um futuro suporte a múltiplas contas;
essa aproximação é distinta da previsão de ritmo da cota semanal.

O resumo usa cartões horizontais com largura limitada: imagem, nome, nível e progresso ficam juntos. Os botões de fixação ficam no cartão e os próximos objetivos têm uma barra fina. Poucos emblemas não se espalham por toda a tela; em telas estreitas, os cartões quebram linha sem reduzir o texto. Rótulos do nível ouro permanecem legíveis em temas claros, mantendo um detalhe dourado.

Ícones SVG leves e embutidos acompanham os rótulos traduzidos existentes de compartilhamento, configurações, filtro, tamanho, editor da vitrine e informações; as contagens aparecem em chips compactos.
Acima de 960 px, a coluna de emblemas se ajusta ao conteúdo, limitada à largura de dois cartões do resumo mais o espaço interno. A coluna de próximos objetivos ocupa o espaço restante, com 16 px entre colunas. Até 960 px, ambas ficam diretamente empilhadas com 12 px de espaço. As seções auxiliares de histórico vêm depois de ambas.
O seletor de tamanho precede o resumo: ícones da coleção 56 / 80 / 112 px, vitrine 56 / 72 / 96 px, erros de fixação junto aos controles e foco estável.
O subtotal USD de effort não qualifica a conquista. Valores vazios e sem preço são distintos; valores parciais mostram limite inferior, e valores inválidos ou com overflow ficam indisponíveis.
[Detalhes em inglês](README-en.md#heatmap-sharing-and-weekly-quota-pace-250).
Cada série tem arte própria, compartilhada entre seus níveis coloridos. Os números são inteiros; limites dos dados ficam na seção expansível.
Evidências pendentes ou desatualizadas substituem o progresso zero e ficam fora do próximo alvo; emblemas conquistados são preservados.
Cartões fechados mostram o progresso até o próximo nível; etapas intermediárias nas longas escalas de tokens não geram prêmios, avisos ou opções de compartilhamento extras.
Pequeno / Médio / Grande alteram medalhas e molduras, preservando fonte e áreas de clique. Próximas metas destaca até três temas e exclui metas sem comprovação e modelos não utilizados.
Metas exigem progresso positivo atual; a ordem fica estável durante a visita. Clicar abre as regras sem ler logs nem selecionar para compartilhar.
Após indexação atual completa, linhagens Codex sem conflito podem comprovar marcos de tokens/agentes; ramos conflitantes e seus descendentes são excluídos.

Com o histórico local atual verificado e totalmente indexado, datas parciais confiáveis podem mostrar
`≥` no progresso de atividade, famílias de modelos e Tokens semanais. Limites inferiores de valores
semanais usam apenas arquivos selecionados verificados com todo o uso datado; cobertura de preços e
de datas são independentes. Datas parciais não comprovam histórico completo nem uso zero, e médias de
quatro semanas/picos retidos ficam pendentes até a cobertura completa. Escopos acumulados/de tarefa
não mudam, sem leituras adicionais das fontes, armazenamento ou chamadas de rede.

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
[Armazenamento e limpeza](LOCAL-DATA.md#local-achievements-250).

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
