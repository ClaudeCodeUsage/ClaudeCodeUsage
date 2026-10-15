import type { AchievementId } from './achievements';
import type { SupportedLanguage } from './types';

interface ConditionTemplates {
  team: (members: number, output: string) => string;
  participation: string;
  models: (models: number, output: string) => string;
  effort: (processed: string, output: string, tasks: number) => string;
  rainbow: string;
  evidence: string;
  roots: string;
}

// Qualification only: repetition, tier-count and family-count targets are
// already shown by the caller. K/M/B denote token counts in every locale.
const templates: Record<SupportedLanguage, ConditionTemplates> = {
  en: {
    team: (n, output) => `Per task: ≥${n} distinct subagents, each with ≥${output} output tokens; main session has output.`,
    participation: 'Each distinct subagent: ≥5K output tokens.',
    models: (n, output) => `Per task: ≥${n} distinct recognized models, each with ≥${output} output tokens. Model aliases count once.`,
    effort: (processed, output, tasks) => `Per effort tier: ≥${processed} processed tokens and ≥${output} output tokens across ≥${tasks} distinct root tasks. Pool each task and tier first; count only tasks with output in that tier.`,
    rainbow: 'Per recognized family (including supported Fable 5/5.1): ≥10M processed tokens and ≥20K output tokens. Family aliases count once.',
    evidence: 'Verified, deduplicated usage only; approval reviewers excluded.',
    roots: 'Main tasks with verifiable log ownership and recognized model usage. A task and its subagents count once together; this does not mean task completion.',
  },
  'zh-CN': {
    team: (n, output) => `每任务≥${n}个不同子智能体，各输出≥${output} Token；主会话有输出。`,
    participation: '每个不同子智能体输出≥5K Token。',
    models: (n, output) => `每任务≥${n}个不同明确模型，各输出≥${output} Token；模型别名不重复计数。`,
    effort: (processed, output, tasks) => `每档已处理≥${processed} Token且输出≥${output} Token，分布于≥${tasks}个不同根任务；先按根任务与同档位汇总，仅计入该档有输出的任务。`,
    rainbow: '每个可识别家族（含支持的 Fable 5/5.1）已处理≥10M Token且输出≥20K Token；家族别名不重复计数。',
    evidence: '仅计可确认、去重用量；排除审批审查器。',
    roots: '可从日志核验归属、且含已识别模型用量的主任务；同一主任务及其子会话只计一次，不表示任务完成。',
  },
  'zh-TW': {
    team: (n, output) => `每任務≥${n}個不同子代理，各輸出≥${output} Token；主工作階段有輸出。`,
    participation: '每個不同子代理輸出≥5K Token。',
    models: (n, output) => `每任務≥${n}個不同明確模型，各輸出≥${output} Token；模型別名不重複計數。`,
    effort: (processed, output, tasks) => `每檔已處理≥${processed} Token且輸出≥${output} Token，分布於≥${tasks}個不同根任務；先按根任務與同檔位彙總，僅計入該檔有輸出的任務。`,
    rainbow: '每個可識別家族（含支援的 Fable 5/5.1）已處理≥10M Token且輸出≥20K Token；家族別名不重複計數。',
    evidence: '僅計已確認、去重用量；排除審批審查器。',
    roots: '可由日誌核驗歸屬，且含已識別模型用量的主任務；同一主任務與其子工作階段只計一次，不表示任務完成。',
  },
  'de-DE': {
    team: (n, output) => `Je Aufgabe: ≥${n} verschiedene Unteragenten, je ≥${output} Ausgabe-Token; die Hauptsitzung hat Ausgabe.`,
    participation: 'Je verschiedener Unteragent: ≥5K Ausgabe-Token.',
    models: (n, output) => `Je Aufgabe: ≥${n} verschiedene erkannte Modelle, je ≥${output} Ausgabe-Token. Modell-Aliasse zählen einmal.`,
    effort: (processed, output, tasks) => `Je Denkstufe: ≥${processed} verarbeitete Token und ≥${output} Ausgabe-Token aus ≥${tasks} verschiedenen Hauptaufgaben. Erst je Aufgabe und Stufe summieren; nur Aufgaben mit Ausgabe in dieser Stufe zählen.`,
    rainbow: 'Je erkannter Familie (einschließlich unterstützter Fable 5/5.1): ≥10M verarbeitete Token und ≥20K Ausgabe-Token. Familien-Aliasse zählen einmal.',
    evidence: 'Nur bestätigte, deduplizierte Nutzung; Freigabeprüfer ausgeschlossen.',
    roots: 'Hauptaufgaben mit prüfbarer Protokollzuordnung und Nutzung erkannter Modelle. Aufgabe und Unteragenten zählen gemeinsam einmal; kein Nachweis eines Aufgabenabschlusses.',
  },
  ja: {
    team: (n, output) => `各タスクに異なる子エージェント≥${n}件、各出力≥${output}トークン；メインセッションも出力あり。`,
    participation: '各異なる子エージェントの出力≥5Kトークン。',
    models: (n, output) => `各タスクに異なる認識済みモデル≥${n}種類、各出力≥${output}トークン。モデルの別名は重複計上しません。`,
    effort: (processed, output, tasks) => `各推論レベルで処理≥${processed}トークンかつ出力≥${output}トークン、異なるルートタスク≥${tasks}件。タスクとレベルごとに先に合計し、そのレベルに出力のあるタスクのみ計上。`,
    rainbow: '各認識済み系統（対応する Fable 5/5.1 を含む）で処理≥10Mトークンかつ出力≥20Kトークン。系統の別名は重複計上しません。',
    evidence: '確認済み・重複除去済みの使用量のみ；承認レビュアーは除外。',
    roots: 'ログで所属を検証でき、認識済みモデルの使用量があるメインタスク。同じタスクと子セッションはまとめて一件と数え、完了を意味しません。',
  },
  ko: {
    team: (n, output) => `각 작업에 서로 다른 하위 에이전트 ≥${n}개, 각 출력 ≥${output} 토큰; 주 세션에도 출력이 있어야 합니다.`,
    participation: '서로 다른 각 하위 에이전트의 출력 ≥5K 토큰.',
    models: (n, output) => `각 작업에 서로 다른 인식된 모델 ≥${n}개, 각 출력 ≥${output} 토큰. 모델 별칭은 중복 집계하지 않습니다.`,
    effort: (processed, output, tasks) => `각 추론 단계에서 처리 ≥${processed} 토큰 및 출력 ≥${output} 토큰, 서로 다른 루트 작업 ≥${tasks}개. 작업과 단계별로 먼저 합산하고 해당 단계에 출력이 있는 작업만 집계.`,
    rainbow: '인식된 각 계열(지원되는 Fable 5/5.1 포함)에서 처리 ≥10M 토큰 및 출력 ≥20K 토큰. 계열 별칭은 중복 집계하지 않습니다.',
    evidence: '확인된 중복 제거 사용량만 집계; 승인 검토자는 제외.',
    roots: '로그에서 소속을 검증할 수 있고 인식된 모델 사용량이 있는 주 작업입니다. 같은 작업과 하위 세션은 함께 한 번만 집계하며 완료를 뜻하지 않습니다.',
  },
  'pt-BR': {
    team: (n, output) => `Por tarefa: ≥${n} subagentes distintos, cada um com ≥${output} tokens de saída; a sessão principal tem saída.`,
    participation: 'Cada subagente distinto: ≥5K tokens de saída.',
    models: (n, output) => `Por tarefa: ≥${n} modelos reconhecidos distintos, cada um com ≥${output} tokens de saída. Aliases de modelo contam uma vez.`,
    effort: (processed, output, tasks) => `Por nível de esforço: ≥${processed} tokens processados e ≥${output} tokens de saída, em ≥${tasks} tarefas raiz distintas. Some por tarefa e nível primeiro; conte apenas tarefas com saída nesse nível.`,
    rainbow: 'Por família reconhecida (incluindo Fable 5/5.1 compatíveis): ≥10M tokens processados e ≥20K tokens de saída. Aliases de família contam uma vez.',
    evidence: 'Apenas uso verificado e deduplicado; revisores de aprovação excluídos.',
    roots: 'Tarefas principais com vínculo verificável nos logs e uso de modelos reconhecidos. A tarefa e seus subagentes contam uma vez em conjunto; não significa conclusão.',
  },
  id: {
    team: (n, output) => `Setiap tugas: ≥${n} subagen berbeda, tiap subagen dengan ≥${output} token output; sesi utama memiliki output.`,
    participation: 'Setiap subagen berbeda: ≥5K token output.',
    models: (n, output) => `Setiap tugas: ≥${n} model dikenali yang berbeda, tiap model dengan ≥${output} token output. Alias model dihitung sekali.`,
    effort: (processed, output, tasks) => `Setiap tingkat upaya: ≥${processed} token diproses dan ≥${output} token output, dalam ≥${tasks} tugas akar berbeda. Jumlahkan per tugas dan tingkat dahulu; hanya tugas dengan output pada tingkat itu dihitung.`,
    rainbow: 'Setiap keluarga dikenali (termasuk Fable 5/5.1 yang didukung): ≥10M token diproses dan ≥20K token output. Alias keluarga dihitung sekali.',
    evidence: 'Hanya penggunaan terverifikasi dan dideduplikasi; peninjau persetujuan dikecualikan.',
    roots: 'Tugas utama dengan asal log yang dapat diverifikasi dan penggunaan model yang dikenali. Tugas beserta subagennya dihitung sekali bersama; bukan berarti tugas selesai.',
  },
};

function conditionsFor(copy: ConditionTemplates): Partial<Record<AchievementId, string>> {
  const detail = (text: string): string => `${text} ${copy.evidence}`;
  const ordinaryTeam = detail(copy.team(3, '5K'));
  const participation = detail(copy.participation);
  const ordinaryModels = detail(copy.models(2, '10K'));
  const rainbow = detail(copy.rainbow);
  return {
    'root-portfolio-bronze': copy.roots,
    'root-portfolio-silver': copy.roots,
    'root-portfolio-gold': copy.roots,
    'agent-standup': ordinaryTeam,
    'tiny-ai-company': detail(copy.team(5, '10K')),
    'agent-team-gold': detail(copy.team(8, '20K')),
    'agent-conductor': ordinaryTeam,
    'agent-conductor-silver': ordinaryTeam,
    'agent-conductor-gold': ordinaryTeam,
    'agent-participation-bronze': participation,
    'agent-participation-silver': participation,
    'agent-participation-gold': participation,
    'multi-core-human': ordinaryModels,
    'same-root-models-silver': detail(copy.models(3, '20K')),
    'same-root-models-gold': detail(copy.models(4, '50K')),
    'model-relay-roots-bronze': ordinaryModels,
    'model-relay-roots-silver': ordinaryModels,
    'model-relay-roots-gold': ordinaryModels,
    'effort-explorer': detail(copy.effort('100M', '100K', 5)),
    'effort-breadth-silver': detail(copy.effort('500M', '500K', 10)),
    'effort-spectrum': detail(copy.effort('2B', '2M', 30)),
    'model-rainbow-bronze': rainbow,
    'model-rainbow': rainbow,
    'model-rainbow-gold': rainbow,
  };
}

const conditions: Record<SupportedLanguage, Partial<Record<AchievementId, string>>> = {
  en: conditionsFor(templates.en),
  'zh-CN': conditionsFor(templates['zh-CN']),
  'zh-TW': conditionsFor(templates['zh-TW']),
  'de-DE': conditionsFor(templates['de-DE']),
  ja: conditionsFor(templates.ja),
  ko: conditionsFor(templates.ko),
  'pt-BR': conditionsFor(templates['pt-BR']),
  id: conditionsFor(templates.id),
};

/** Pure detail/SVG copy lookup; unknown locales use English, other IDs have no condition. */
export function achievementConditionFor(locale: string, id: AchievementId): string | undefined {
  const copy = Object.prototype.hasOwnProperty.call(conditions, locale)
    ? conditions[locale as SupportedLanguage] : conditions.en;
  return Object.prototype.hasOwnProperty.call(copy, id) ? copy[id] : undefined;
}
