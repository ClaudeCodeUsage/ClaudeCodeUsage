// Static sample shown when the user opens "Get AI Advice" without an
// adviceApiKey configured. The point is to show *what kind of output* the
// feature returns, so users can decide whether to set up an API key.
//
// Each language has a self-contained body. Languages without a translation
// fall back to English. The header / "this is a demo" notice is built
// separately from i18n strings (see I18n.t.popup.adviceDemoNotice).

import { SupportedLanguage } from './types';

const EN = `## Summary

Across the last 30 days, **assistant output and tool results dominate your
spend** (≈68% combined), while your own prompts account for only ≈11%.
The pattern: short, exploratory prompts like *"take a look at..."* trigger
multiple Read/Grep calls that inflate output tokens.

The main lever is **prompt precision**, not "use a smaller model".

## Concrete rewrites

### 1. "Explore first" framing

**Before:** *"Take a look at the auth module and tell me what's going on."*

**After:** *"In \`src/auth/session.ts\`, \`refreshToken()\` returns 401
intermittently in prod. Read this file plus its direct callers, then
propose a fix. Don't summarize the whole module."*

Why: states the *symptom*, names the *scope*, suppresses unwanted summary
output.

### 2. Mid-task scope drift

**Before:** *"Also can you make sure the tests still pass? Add a test for
the edge case we discussed?"*

**After:** *"Add **one** test for the empty-array case in \`parseConfig\`.
Run only \`npm test -- parseConfig.test.ts\`. Don't add unrelated tests."*

Why: bounds the change, the test command, and the surface area.

### 3. "Use your judgement"

**Before:** *"Refactor this however you think is cleanest."*

**After:** *"Extract the retry logic from \`processBatch\` into a
\`retryWithBackoff\` helper. Keep everything else unchanged. Don't rename
variables."*

Why: gives Claude one decision boundary, not a dozen.

## Smaller savings

- **Cache-read share is 41%** — good. Don't break it by editing CLAUDE.md
  mid-session; edit between sessions instead.
- **Average context at session end: 89k tokens.** Sessions past ~140k get
  exponentially more expensive per turn — start fresh ones earlier.
- **Haiku 4.5 appears in 0% of your sessions.** For trivial reformat /
  comment / "explain this line" tasks, it costs ~1/15 of Sonnet 4.6 and
  the quality is fine.
`;

const ZH_CN = `## 总览

过去 30 天里,**助手输出和工具结果占了你成本的大头**(合计约 68%),
而你自己的 prompt 只占约 11%。这是一个典型信号:你的 prompt 偏短、
偏探索性,常出现"看一下..."这种表述,让 Claude 触发多次 Read/Grep,
推高输出 token。

主要杠杆是**提示词精度**,而不是"换小模型"。

## 具体改写建议

### 1. "先探索" 框架

**改前**:*"看一下 auth 模块,告诉我有什么问题。"*

**改后**:*"在 \`src/auth/session.ts\` 里,\`refreshToken()\` 在
生产环境间歇性返回 401。读这个文件加直接调用者,然后给出修复方案。
不需要总结整个 auth 模块。"*

为什么:点明*症状*、限定*范围*、抑制不必要的概述输出。

### 2. 任务中途扩张

**改前**:*"另外能不能确认一下测试还能过?顺便加一个我们之前讨论的
边界 case 的测试?"*

**改后**:*"在 \`parseConfig\` 里**只**加一条空数组的测试。只跑
\`npm test -- parseConfig.test.ts\`。不要加其他测试。"*

为什么:限定改动数量、测试命令范围和影响面。

### 3. "你自己判断"

**改前**:*"按你觉得最干净的方式重构这段。"*

**改后**:*"把 \`processBatch\` 里的重试逻辑抽成一个
\`retryWithBackoff\` helper。其它都不动,变量名也不要改。"*

为什么:只让 Claude 做一个决策,而不是十几个。

## 次要优化

- **Cache 读取占比 41%** —— 不错。不要在 session 中途改 CLAUDE.md,
  会破坏缓存;改放到 session 之间。
- **session 结束时平均上下文 89k tokens**。超过 ~140k 后每轮成本急剧
  上升,尽早开新 session。
- **Haiku 4.5 在你的 session 里出现率 0%**。对于格式化、加注释、
  "解释这一行"这种小活,Haiku 4.5 成本约为 Sonnet 4.6 的 1/15,
  质量完全够用。
`;

const ZH_TW = `## 總覽

過去 30 天裡,**助理輸出和工具結果佔了你成本的大頭**(合計約 68%),
而你自己的 prompt 只佔約 11%。這是一個典型訊號:你的 prompt 偏短、
偏探索性,常出現"看一下..."這種表述,讓 Claude 觸發多次 Read/Grep,
推高輸出 token。

主要槓桿是**提示詞精度**,而不是"換小模型"。

## 具體改寫建議

### 1. "先探索" 框架

**改前**:*"看一下 auth 模組,告訴我有什麼問題。"*

**改後**:*"在 \`src/auth/session.ts\` 裡,\`refreshToken()\` 在
生產環境間歇性回傳 401。讀這個檔案加直接呼叫者,然後給出修復方案。
不需要總結整個 auth 模組。"*

為什麼:點明*症狀*、限定*範圍*、抑制不必要的概述輸出。

### 2. 任務中途擴張

**改前**:*"另外能不能確認一下測試還能過?順便加一個我們之前討論的
邊界 case 的測試?"*

**改後**:*"在 \`parseConfig\` 裡**只**加一條空陣列的測試。只跑
\`npm test -- parseConfig.test.ts\`。不要加其他測試。"*

為什麼:限定改動數量、測試指令範圍和影響面。

### 3. "你自己判斷"

**改前**:*"按你覺得最乾淨的方式重構這段。"*

**改後**:*"把 \`processBatch\` 裡的重試邏輯抽成一個
\`retryWithBackoff\` helper。其它都不動,變數名也不要改。"*

為什麼:只讓 Claude 做一個決策,而不是十幾個。

## 次要優化

- **Cache 讀取佔比 41%** —— 不錯。不要在 session 中途改 CLAUDE.md,
  會破壞快取;改放到 session 之間。
- **session 結束時平均 context 89k tokens**。超過 ~140k 後每輪成本
  急劇上升,儘早開新 session。
- **Haiku 4.5 在你的 session 裡出現率 0%**。對於格式化、加註解、
  "解釋這一行"這種小活,Haiku 4.5 成本約為 Sonnet 4.6 的 1/15,
  品質完全夠用。
`;

const JA = `## 概要

過去 30 日間で、**アシスタント出力とツール結果が支出の大半**
(合計約 68%)を占めており、あなた自身のプロンプトは約 11% に
すぎません。パターン:"見てみて..."のような短い探索的プロンプトが
複数の Read/Grep 呼び出しを誘発し、出力トークンを膨らませています。

主要なレバーは「小さいモデルを使う」ではなく、**プロンプトの精度**です。

## 具体的な書き換え

### 1. 「まず探索」フレーミング

**改善前**:*"auth モジュールを見て、何が起きているか教えて。"*

**改善後**:*"\`src/auth/session.ts\` の \`refreshToken()\` が本番で
断続的に 401 を返す。このファイルと直接の呼び出し元を読んで、
修正案を提案してください。auth モジュール全体の要約は不要。"*

理由:*症状*を明示し、*スコープ*を限定し、不要な要約出力を抑制。

### 2. タスク途中のスコープドリフト

**改善前**:*"テストもまだ通るか確認できる?以前話したエッジケースの
テストも追加して?"*

**改善後**:*"\`parseConfig\` の空配列ケースのテストを**1 つだけ**
追加。\`npm test -- parseConfig.test.ts\` のみ実行。
無関係なテストは追加しないで。"*

理由:変更量、テストコマンド、影響範囲を限定。

### 3. 「あなたの判断で」

**改善前**:*"きれいだと思う形でリファクタしてください。"*

**改善後**:*"\`processBatch\` のリトライロジックを
\`retryWithBackoff\` ヘルパーに抽出。他は何も変更しないで、
変数名も変えないで。"*

理由:Claude に決定境界を 1 つだけ与える。

## 副次的な節約

- **キャッシュヒット率 41%** —— 良好。セッション途中で CLAUDE.md を
  編集するとキャッシュが壊れます。編集はセッション間で。
- **セッション終了時の平均コンテキスト 89k tokens**。~140k を超えると
  各ターンのコストが指数的に増えます。早めに新セッションを。
- **Haiku 4.5 はあなたのセッションで 0% 出現**。整形、コメント追加、
  "この行を説明"のような軽作業では Sonnet 4.6 の約 1/15 のコストで
  品質も十分です。
`;

const KO = `## 요약

지난 30일 동안 **어시스턴트 출력과 도구 결과가 비용의 대부분**
(합산 약 68%)을 차지하며, 본인 프롬프트는 약 11%에 불과합니다.
패턴: "한번 봐봐..." 같은 짧고 탐색적인 프롬프트가 여러 Read/Grep
호출을 유발해 출력 토큰을 부풀립니다.

핵심 레버는 "작은 모델 사용"이 아니라 **프롬프트 정밀도**입니다.

## 구체적인 다시 쓰기

### 1. "먼저 탐색" 프레이밍

**개선 전**: *"auth 모듈을 보고 무슨 일이 일어나는지 알려줘."*

**개선 후**: *"\`src/auth/session.ts\` 의 \`refreshToken()\` 이 운영
환경에서 간헐적으로 401을 반환합니다. 이 파일과 직접 호출자를 읽고
수정안을 제안하세요. 전체 모듈 요약은 필요 없습니다."*

이유: *증상* 명시, *범위* 한정, 불필요한 요약 출력 억제.

### 2. 작업 중 범위 확장

**개선 전**: *"테스트도 통과하는지 확인해줄래? 전에 얘기한 엣지
케이스 테스트도 추가하고?"*

**개선 후**: *"\`parseConfig\` 의 빈 배열 케이스 테스트를 **1개만**
추가. \`npm test -- parseConfig.test.ts\` 만 실행. 관련 없는 테스트는
추가하지 마세요."*

이유: 변경 범위, 테스트 명령, 영향 범위를 한정.

### 3. "네 판단대로"

**개선 전**: *"가장 깔끔하다고 생각하는 방식으로 리팩토링하세요."*

**개선 후**: *"\`processBatch\` 의 재시도 로직을 \`retryWithBackoff\`
헬퍼로 추출. 다른 것은 모두 그대로, 변수명도 바꾸지 마세요."*

이유: Claude에게 하나의 결정 경계만 제공.

## 부차적 절감

- **캐시 적중률 41%** — 좋음. 세션 중간에 CLAUDE.md를 편집하면
  캐시가 깨집니다. 편집은 세션 사이에.
- **세션 종료 시 평균 컨텍스트 89k 토큰**. ~140k 초과 시 턴당 비용이
  급증합니다. 더 일찍 새 세션을 시작하세요.
- **Haiku 4.5는 세션에서 0% 등장**. 포맷팅, 주석 추가, "이 줄 설명"
  같은 작업은 Sonnet 4.6 비용의 약 1/15이며 품질도 충분합니다.
`;

const DE = `## Zusammenfassung

In den letzten 30 Tagen **dominieren Assistenten-Output und Tool-Ergebnisse
Ihre Kosten** (zusammen ≈68%), während Ihre eigenen Prompts nur ≈11%
ausmachen. Muster: Kurze, explorative Prompts wie *"schau dir mal..."*
lösen mehrere Read/Grep-Aufrufe aus, die Output-Tokens aufblähen.

Der Haupthebel ist **Prompt-Präzision**, nicht "kleineres Modell nutzen".

## Konkrete Umschreibungen

### 1. "Erst explorieren"-Framing

**Vorher:** *"Schau dir das Auth-Modul an und sag mir, was los ist."*

**Nachher:** *"In \`src/auth/session.ts\` gibt \`refreshToken()\` in
Produktion sporadisch 401 zurück. Lies diese Datei plus direkte Aufrufer,
dann schlage einen Fix vor. Keine Zusammenfassung des gesamten Moduls."*

Warum: Nennt das *Symptom*, begrenzt den *Scope*, unterdrückt unerwünschte
Zusammenfassungen.

### 2. Scope-Drift mitten in der Aufgabe

**Vorher:** *"Kannst du auch sicherstellen, dass die Tests noch laufen?
Und einen Test für den Edge Case hinzufügen?"*

**Nachher:** *"Füge **einen** Test für den Leer-Array-Fall in
\`parseConfig\` hinzu. Führe nur \`npm test -- parseConfig.test.ts\` aus.
Keine unrelated Tests."*

Warum: Begrenzt Änderung, Testbefehl und Oberfläche.

### 3. "Nach deinem Ermessen"

**Vorher:** *"Refactore das, wie du es am saubersten findest."*

**Nachher:** *"Extrahiere die Retry-Logik aus \`processBatch\` in einen
\`retryWithBackoff\`-Helper. Alles andere unverändert, keine
Variablen-Umbenennungen."*

Warum: Gibt Claude eine Entscheidungsgrenze, nicht ein Dutzend.

## Kleinere Einsparungen

- **Cache-Read-Anteil 41%** — gut. Bearbeiten Sie CLAUDE.md nicht mitten
  in einer Session; das zerstört den Cache. Lieber zwischen Sessions.
- **Durchschnittlicher Context am Session-Ende: 89k Tokens.** Sessions
  über ~140k werden pro Turn exponentiell teurer — früher neue starten.
- **Haiku 4.5 erscheint in 0% Ihrer Sessions.** Für triviales Formatieren,
  Kommentieren oder "erklär diese Zeile" kostet Haiku 4.5 ~1/15 von
  Sonnet 4.6 bei ausreichender Qualität.
`;

const PT_BR = `## Resumo

Nos últimos 30 dias, **as respostas do assistente e os resultados de ferramentas dominam
seus gastos** (≈68% combinados), enquanto seus próprios prompts representam apenas ≈11%.
O padrão: prompts curtos e exploratórios como *"dá uma olhada em..."* disparam várias
chamadas Read/Grep que inflam os tokens de saída.

A principal alavanca é a **precisão dos prompts**, não "usar um modelo menor".

## Reescritas concretas

### 1. Enquadramento "explore primeiro"

**Antes:** *"Dá uma olhada no módulo de autenticação e me diz o que está acontecendo."*

**Depois:** *"Em \`src/auth/session.ts\`, \`refreshToken()\` está retornando 401
intermitentemente em produção. Leia este arquivo e seus chamadores diretos, depois
proponha uma correção. Não resuma o módulo inteiro."*

Por quê: indica o *sintoma*, nomeia o *escopo* e suprime o resumo desnecessário.

### 2. Desvio de escopo durante a tarefa

**Antes:** *"Ah, pode também confirmar que os testes ainda passam? E adicionar um teste
para o caso extremo que discutimos?"*

**Depois:** *"Adicione **um** teste para o caso de array vazio em \`parseConfig\`.
Execute apenas \`npm test -- parseConfig.test.ts\`. Não adicione outros testes."*

Por quê: limita a mudança, o comando de teste e a área de impacto.

### 3. "Use seu julgamento"

**Antes:** *"Refatore isso da forma que achar mais limpa."*

**Depois:** *"Extraia a lógica de retry de \`processBatch\` para um helper
\`retryWithBackoff\`. Mantenha todo o resto igual. Não renomeie variáveis."*

Por quê: dá ao Claude uma única decisão a tomar, não uma dúzia.

## Economias menores

- **Taxa de acerto do cache: 41%** — bom. Não quebre o cache editando CLAUDE.md
  no meio da session; edite entre sessions.
- **Context window médio ao final da session: 89k tokens.** Sessions acima de ~140k ficam
  exponencialmente mais caras por turno — inicie novas sessions mais cedo.
- **Haiku 4.5 aparece em 0% das suas sessions.** Para reformatar, comentar ou "explica
  essa linha", ele custa ~1/15 de Sonnet 4.6 com qualidade suficiente.
`;

const BODIES: Record<SupportedLanguage, string> = {
  'en': EN,
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  'ja': JA,
  'ko': KO,
  'de-DE': DE,
  'pt-BR': PT_BR
};

/** Demo body for the user's UI language; falls back to English. */
export function getDemoBody(lang: SupportedLanguage): string {
  return BODIES[lang] || EN;
}
