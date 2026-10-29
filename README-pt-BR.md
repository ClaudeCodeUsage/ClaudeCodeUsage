# Claude Code Usage

🌐 **Idioma**: [Página principal](README.md) · [English](README-en.md) · [Deutsch](README-de-DE.md) · [繁體中文](README-zh-TW.md) · [简体中文](README-zh-CN.md) · [日本語](README-ja.md) · [한국어](README-ko.md) · **Português (Brasil)** · [Bahasa Indonesia](README-id.md)

**Uso local do Claude Code e do Codex na barra de status do VS Code.** A
extensão lê registros locais e mostra cada provedor conforme o significado
dos seus dados. **Não é uma ferramenta de cobrança.**

## Atualizações de visualização e cota

- As páginas de conquistas Claude e Codex compartilham um layout mais claro. As ilustrações mantêm o tamanho integral com adornos de nível nas bordas; os cartões de compartilhamento destacam as imagens em fileiras de emblemas centralizadas, preservando os critérios de conquista.
- Os gráficos de projetos reúnem o período selecionado de 30/90 dias, o subtotal de Tokens indexados e a cobertura acima de legendas e gráficos alinhados. As datas recentes aparecem primeiro e a posição de rolagem é preservada. Continuam disponíveis as escalas diária, semanal e mensal, os filtros de projetos e a distinção entre valores desconhecidos, zero e subtotais parciais.
- O compartilhamento de valores oferece layout compacto opcional; o padrão continua sendo o normal. Claude e Codex ficam separados. Alterações exigem uma nova prévia aceita; os bytes do SVG salvo são relidos e comparados com essa prévia.
- Conquistas de volume e valores por provedor em sete dias usam janelas móveis encerradas de sete dias civis. Prêmios existentes preservam os registros e são identificados como regras anteriores; evidência ausente não gera datas. Os ciclos reais de redefinição de cota não mudam.
- A análise de Claude e Codex começa pelos números principais do mesmo período, seguidos de observações, evidências e sugestões. Saída por hora decorrida e mudanças observadas no uso permanecem desativadas por padrão; a cobertura parcial continua visível. Saída por hora não é TPS de geração, e mudanças não provam causas.
- O Codex pode mostrar entrada, saída e cache juntos com `codex.statusBarUsageFormat` opcional; vazio mantém a métrica atual. Veja [detalhes do formato](CHANGELOG.md).
- A consulta de cota do Claude usa o endpoint OAuth atual e salva as credenciais renovadas. Veja [dados locais](LOCAL-DATA.md).

As atualizações preservam o processamento local de uso. A cota do Claude usa o fluxo OAuth existente. Consulte [dados locais e limpeza](LOCAL-DATA.md).

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

## Novidades da v2.5

- **Conquistas locais** — veja medalhas, progresso e próximos objetivos. Ativas por padrão;
  desative em Local achievements nas configurações (`enableAchievements`). As datas vêm dos
  logs retidos, não do histórico completo da conta; a calibração manual atualiza as datas compatíveis.
- **Cartões de conquistas** — escolha medalhas conquistadas, confira a prévia e exporte
  explicitamente como SVG local. Sem login no GitHub ou upload automático.
- **Compartilhamento de mapa de calor** — escolha Claude, Codex ou ambos, com Tokens ou
  valores equivalentes de API opcionais. São estimativas, não faturas; os valores ficam separados por provedor.
- **Ritmo da cota semanal** — previsão opcional, desativada por padrão, baseada nas observações
  semanais existentes. Exige dados recentes e confiáveis; os logs atuais do Codex não permitem essa previsão.
- **Histórico Codex comprimido** — leia `.jsonl.zst` junto com `.jsonl` localmente, sem alterar
  os logs de origem, salvar cópias descomprimidas ou contar o mesmo histórico duas vezes.

Consulte o [histórico de alterações](CHANGELOG.md) e [dados locais e privacidade](LOCAL-DATA.md)
para os limites de datas, exportação, armazenamento e cotas.

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
