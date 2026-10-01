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
das conversas. A orientação por IA é opcional: só envia uma solicitação após
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
