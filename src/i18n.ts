import { SupportedLanguage } from './types';
import {
  formatUsdBaseline as formatUsdBaselineValue,
  formatUsdForDisplay,
  resolveCurrencyDisplay,
} from './currencyDisplay';
import { CODEX_COPY_EN, CodexViewCopy } from './codexView';

export interface ProviderTranslations {
  claude: string;
  codexBeta: string;
  compare: string;
  codex: CodexViewCopy;
}

export interface WeeklyValueCopy {
  title: string;
  description: string;
  period: string;
  periodDetails: string;
  currentPeriod: string;
  currentPeriodShort: string;
  resetsAt: string;
  usedValue: string;
  fullValue: string;
  unusedValue: string;
  reset: string;
  utilization: string;
  confidence: string;
  pricingCoverage: string;
  current: string;
  high: string;
  medium: string;
  low: string;
  usageOnly: string;
  noData: string;
  historyFromLogs: string;
  calendarFallback: string;
  multiAccount: string;
  boundaryApproximation: string;
  boundaryApproximate: string;
  indexedSubtotal: string;
}

export interface AdviceEffectivenessTranslations {
  title: string;
  description: string;
  candidateNotice: string;
  spineLabel: string;
  observation: string;
  evidence: string;
  recommendation: string;
  action: string;
  result: string;
  source: string;
  limitations: string;
  proxyMetric: string;
  longSessionSignal: string;
  largeContextSignal: string;
  frameworkOverheadSignal: string;
  clearBoundaryRecommendation: string;
  clearBoundaryAction: string;
  codexLocalRecommendation: string;
  noEvidenceAdvice: string;
  codexPreviewUnavailable: string;
  elapsedTimeProxy: string;
  qualityGuardrailPending: string;
  payloadTitle: string;
  payloadDescription: string;
  aggregatesOnly: string;
  aggregatesWithPersonalization: string;
  aggregatesWithPromptSamples: string;
  payloadBytes: string;
  promptSamplesIncluded: string;
  previewPayload: string;
  noNetworkTransport: string;
  sendPreparedRequest: string;
  sendingPreparedRequest: string;
  sentPreparedRequest: string;
  aggregateConsentLabel: string;
  aggregateConsentHelp: string;
  promptConsentLabel: string;
  promptConsentHelp: string;
  promptWindowHelp: string;
  feedbackTitle: string;
  helpful: string;
  notHelpful: string;
  applied: string;
  snooze: string;
  resume: string;
  snoozedUntil: string;
  feedbackLocalOnly: string;
  feedbackSaveFailed: string;
  comparisonTitle: string;
  comparablePairs: string;
  minimumComparablePairs: string;
  insufficientEvidence: string;
  qualityGuardrailFailed: string;
  improved: string;
  noDemonstratedImprovement: string;
  clearLocalData: string;
  clearLocalDataConfirm: string;
  strictOutputRejected: string;
}

export interface Translations {
  statusBar: {
    loading: string;
    noData: string;
    notRunning: string;
    error: string;
    refreshFailed: string;
    currentSession: string;
  };
  releaseAnnouncement: {
    v230: string;
    v231: string;
    v232: string;
  };
  providers: ProviderTranslations;
  weeklyValue: WeeklyValueCopy;
  popup: {
    title: string;
    currentSession: string;
    today: string;
    thisMonth: string;
    allTime: string;
    workspaceToday: string;
    refresh: string;
    autoRefresh: string;
    settings: string;
    settingsTab: string;
    settingsIntro: string;
    secretMigrationFailed: string;
    secretMigrationWorkspace: string;
    settingsResetAll: string;
    settingsGroupGeneral: string;
    settingsGroupProviders: string;
    settingsGroupFeatures: string;
    settingsGroupStatusBar: string;
    quotaFormatBuiltIn: string;
    quotaFormatFiveHour: string;
    quotaFormatWeekly: string;
    quotaFormatCustom: string;
    quotaFormatShortHelp: string;
    settingsGroupData: string;
    settingsGroupAdvice: string;
    adviceEffectiveness: AdviceEffectivenessTranslations;
    totalTokens: string;
    inputTokens: string;
    outputTokens: string;
    cacheCreation: string;
    cacheRead: string;
    cost: string;
    messages: string;
    modelBreakdown: string;
    dailyBreakdown: string;
    monthlyBreakdown: string;
    hourlyBreakdown: string;
    sessions: string;
    sessionBreakdown: string;
    project: string;
    startTime: string;
    duration: string;
    activeDuration: string;
    activeDurationHelp: string;
    hour: string;
    projects: string;
    projectBreakdown: string;
    fullPath: string;
    peakContext: string;
    tokenComposition: string;
    lastActive: string;
    pricing: string;
    refreshPricing: string;
    pricingUpdated: string;
    pricingUpdateFailed: string;
    sortHint: string;
    quota: string;
    quotaWindow: string;
    quotaLimit: string;
    quota5h: string;
    quotaWeekly: string;
    quotaAllModels: string;
    quotaScoped: string;
    quotaCredits: string;
    quotaHint: string;
    contextWindow: string;
    contextHint: string;
    contextHintCompact: string;
    contextLeft: string;
    contentAnalysis: string;
    estimatedNote: string;
    calibratedNote: string;
    calibratedTokens: string;
    thinkingTokensCalibrated: string;
    byTool: string;
    catUserPrompts: string;
    catAssistantText: string;
    catAssistantThinking: string;
    catToolCalls: string;
    catToolResults: string;
    estTokens: string;
    share: string;
    resets: string;
    cacheHitRate: string;
    last30days: string;
    branches: string;
    branchBreakdown: string;
    branch: string;
    workflows: string;
    workflowBreakdown: string;
    workflowName: string;
    model: string;
    agents: string;
    agent: string;
    workflowsLast30Days: string;
    workflowLast30DaysCostShare: string;
    workflowCacheHint: string;
    adhocBadge: string;
    workflowModeBadge: string;
    workflowModeHint: string;
    workflowNativeHint: string;
    orchestration: string;
    commonTaskPrefix: string;
    thinkingShare: string;
    effortHint: string;
    thinkingHidden: string;
    thinkingHiddenShort: string;
    quotaWarnBanner: string;
    dismiss: string;
    attribution: string;
    attrDisclaimer: string;
    attrLargeContext: string;
    attrLargeContextShort: string;
    attrLargeContextHint: string;
    attrLongSessions: string;
    attrLongSessionsShort: string;
    attrLongSessionsHint: string;
    attrSubagentHeavy: string;
    attrSubagentHeavyShort: string;
    attrSubagentHeavyHint: string;
    attrWorkflows: string;
    attrWorkflowsShort: string;
    attrWorkflowsHint: string;
    attrSkillChar: string;
    attrSkillCharHint: string;
    attrPluginChar: string;
    attrPluginCharHint: string;
    attrSkills: string;
    attrSubagents: string;
    attrPlugins: string;
    attrModels: string;
    attrShare: string;
    count: string;
    scopeDay: string;
    scopeWeek: string;
    scopeMonth: string;
    attrTodayPointer: string;
    sessionTitle: string;
    // Session row actions.
    sessionActions: string;
    copySessionId: string;
    copyPath: string;
    resumeSession: string;
    viewConversation: string;
    resumeInvalid: string;
    sessionFilterCurrent: string;
    sessionFilterAll: string;
    sessionRangeToday: string;
    sessionRange7d: string;
    sessionRange30d: string;
    sessionModelAll: string;
    deleteSession: string;
    deleteSessionConfirm: string;
    deleteSessionDetail: string;
    deleteSessionYes: string;
    deleteSessionNotFound: string;
    deleteSessionDone: string;
    getAdvice: string;
    adviceCardTitle: string;
    adviceCardDesc: string;
    optimizerTitle: string;
    optimizerDesc: string;
    optimizerConsent: string;
    optimizerEnableBtn: string;
    optimizerPlaceholder: string;
    optimizerRun: string;
    optimizerRunning: string;
    optimizerCopy: string;
    optimizerCopied: string;
    optimizerResolve: string;
    optimizerResolveHint: string;
    optimizerDistil: string;
    optimizerDistilHint: string;
    optimizerAesthetic: string;
    optimizerAestheticHint: string;
    optimizerPromptHeading: string;
    optimizerSettingsHeading: string;
    optimizerHowto: string;
    experimentalBadge: string;
    adviceNeedsKey: string;
    adviceGenerating: string;
    adviceFailed: string;
    adviceScopeOverall: string;
    adviceScopePrompt: string;
    adviceDemoButton: string;
    adviceDemoNotice: string;
    costComposition: string;
    date: string;
    yesterday: string;
    dataDirectory: string;
    noDataMessage: string;
    errorMessage: string;
  };
  settings: {
    title: string;
    refreshInterval: string;
    dataDirectory: string;
    language: string;
    decimalPlaces: string;
  };
}

type CodexCopyMapKey =
  | 'insightTitles'
  | 'insightObservations'
  | 'insightTips'
  | 'insightEvidenceLabels'
  | 'indexingReasons';

type CodexCopyOverrides = Partial<Omit<CodexViewCopy, CodexCopyMapKey>> & {
  insightTitles?: Partial<CodexViewCopy['insightTitles']>;
  insightObservations?: Partial<CodexViewCopy['insightObservations']>;
  insightTips?: Partial<CodexViewCopy['insightTips']>;
  insightEvidenceLabels?: Partial<CodexViewCopy['insightEvidenceLabels']>;
  indexingReasons?: Partial<CodexViewCopy['indexingReasons']>;
};

const TASK5_CODEX_COPY: Record<Exclude<SupportedLanguage, 'en'>, CodexCopyOverrides> = {
  'de-DE': {
    recommendations: 'Empfehlungen',
    constraintNoAgents: 'Entscheide bei vergleichbaren Aufgaben vorab, ob Subagenten sinnvoll sind.',
    constraintLowerEffort: 'Vergleiche bei einer repräsentativen Aufgabe die beobachtete hohe Aufwandsstufe per A/B-Test mit einer niedrigeren Stufe.',
    constraintPostPatch: 'Nutze nach dem nächsten Patch den strukturellen Proxy, um eine kürzere Werkzeugfolge zu erwägen.',
    constraintCacheContext: 'Beziehe den Cache- und Kontext-Proxy bei der Wahl der nächsten Aufgabengrenze ein.',
    constraintApprovalReviewer: 'Prüfe vor dem Hinzufügen von Freigabe-Prüfern, ob diese Rolle für die Aufgabe benötigt wird.',
    recommendationComposition: 'Beobachtete Rollen-, Modell- und Aufwandsverteilung',
    recommendationProxyKpi: 'Struktureller Proxy-KPI',
    recommendationEmpty: 'Für diesen Bereich liegen keine evidenzbasierten Empfehlungen vor.',
    recommendationPartial: 'Einige Datumsbereiche sind nicht verfügbar, während der tägliche Index vervollständigt wird.',
    insightObservation: 'Beobachtung',
    insightEvidence: 'Evidenz',
    insightConditionalAction: 'Bedingte Maßnahme',
    insightObservations: {
      'multi-agent-share': 'Ein erheblicher Anteil der beobachteten Nutzung ohne Cache ist Subagenten-Rollen zugeordnet.',
      'effort-comparison': 'In diesem strukturellen Proxy-Bereich wurde eine hohe Aufwandsstufe beobachtet.',
      'post-patch-tool-intensity': 'Die beobachtete Werkzeugaktivität nach Patches ist in diesem strukturellen Proxy-Bereich erhöht.',
      'cache-context': 'Die verarbeitete Aktivität ist im Verhältnis zur Nutzung ohne Cache hoch; Cache und Kontext können diesen Proxy beeinflussen.',
      'approval-reviewer-share': 'Ein relevanter Anteil der beobachteten Nutzung ohne Cache ist Freigabe-Prüfer-Rollen zugeordnet.',
    },
    insightTips: {
      'multi-agent-share': 'Entscheide bei vergleichbaren Aufgaben vorab, ob Subagenten sinnvoll sind.',
      'effort-comparison': 'Vergleiche bei einer repräsentativen Aufgabe die hohe Aufwandsstufe per A/B-Test mit einer niedrigeren Stufe.',
      'post-patch-tool-intensity': 'Nutze diesen Proxy nach dem nächsten Patch, um eine kürzere Werkzeugfolge zu erwägen.',
      'cache-context': 'Beziehe Cache- und Kontextbeobachtungen bei der Wahl der nächsten Aufgabengrenze ein.',
      'approval-reviewer-share': 'Prüfe vor dem Hinzufügen von Freigabe-Prüfern, ob diese Rolle benötigt wird.',
    },
    insightEvidenceLabels: {
      taskCount: 'Hauptaufgaben', rootSessionFresh: 'Nutzung ohne Cache durch Haupt- oder unbekannte Rollen', subagentFresh: 'Nutzung ohne Cache der Subagenten', approvalReviewerFresh: 'Nutzung ohne Cache der Freigabe-Prüfer', observedEffort: 'Beobachtete Aufwandsstufe', highEffortFresh: 'Nutzung ohne Cache bei hoher Aufwandsstufe', lowMediumEffortFresh: 'Nutzung ohne Cache bei niedrigerer Aufwandsstufe', patchCalls: 'Patch-Aufrufe (Proxy)', toolCalls: 'Werkzeugaufrufe (Proxy)', postPatchToolCalls: 'Werkzeugaufrufe nach Patch (Proxy)', compactCount: 'Kontextkomprimierungen (Proxy)', taskCompleteCount: 'Aufgabenabschluss-Ereignisse (Proxy)', processedToFreshRatio: 'Proxy verarbeitet / ohne Cache', cachedInputShare: 'Anteil gecachter Eingabe', reasoningOutputShare: 'Reasoning-Anteil der Ausgabe',
    },
  },
  'zh-TW': {
    recommendations: '最佳化建議',
    constraintNoAgents: '對可比較的任務，先判斷是否需要 subagent，再決定是否啟動。',
    constraintLowerEffort: '選一個代表性任務，將觀測到的高推理強度與低一級設定做 A/B 比較。',
    constraintPostPatch: '下次修補後，參考結構性代理指標，評估是否可縮短工具使用流程。',
    constraintCacheContext: '決定下一個任務邊界時，將快取與上下文代理指標納入考量。',
    constraintApprovalReviewer: '加入權限審批角色前，先確認該任務是否需要此角色。',
    recommendationComposition: '已觀測的角色、模型與推理強度構成',
    recommendationProxyKpi: '結構性代理 KPI',
    recommendationEmpty: '此範圍沒有具備證據的建議。',
    recommendationPartial: '每日索引補齊期間，部分日期範圍暫不可用。',
    insightObservation: '觀測',
    insightEvidence: '證據',
    insightConditionalAction: '條件式行動',
    insightObservations: {
      'multi-agent-share': '觀測到的未快取用量中，有相當比例與 subagent 角色相關。',
      'effort-comparison': '此結構性代理範圍觀測到高推理強度。',
      'post-patch-tool-intensity': '此結構性代理範圍在修補後觀測到較高的工具活動。',
      'cache-context': '已處理活動相對未快取用量偏高；快取與上下文可能影響此代理指標。',
      'approval-reviewer-share': '觀測到的未快取用量中，有明顯比例與權限審批角色相關。',
    },
    insightTips: {
      'multi-agent-share': '對可比較的任務，先判斷是否需要 subagent，再決定是否啟動。',
      'effort-comparison': '選一個代表性任務，將高推理強度與低一級設定做 A/B 比較。',
      'post-patch-tool-intensity': '下次修補後，參考此代理指標評估是否可縮短工具使用流程。',
      'cache-context': '決定下一個任務邊界時，將快取與上下文觀測納入考量。',
      'approval-reviewer-share': '加入權限審批角色前，先確認任務是否需要此角色。',
    },
    insightEvidenceLabels: {
      taskCount: '根任務數', rootSessionFresh: '根角色或未知角色的未快取用量', subagentFresh: 'Subagent 未快取用量', approvalReviewerFresh: '權限審批未快取用量', observedEffort: '觀測到的推理強度', highEffortFresh: '高推理強度未快取用量', lowMediumEffortFresh: '較低推理強度未快取用量', patchCalls: '修補呼叫（代理）', toolCalls: '工具呼叫（代理）', postPatchToolCalls: '修補後工具呼叫（代理）', compactCount: '上下文壓縮（代理）', taskCompleteCount: '任務完成事件（代理）', processedToFreshRatio: '已處理／未快取用量代理比值', cachedInputShare: '快取輸入占比', reasoningOutputShare: '推理輸出占比',
    },
  },
  'zh-CN': {
    recommendations: '优化建议',
    constraintNoAgents: '对可比较的任务，先判断是否需要 subagent，再决定是否启动。',
    constraintLowerEffort: '选择一个代表性任务，将观测到的高推理强度与低一级设置做 A/B 对比。',
    constraintPostPatch: '下次应用补丁后，参考结构性代理指标，评估是否可以缩短工具使用流程。',
    constraintCacheContext: '决定下一个任务边界时，将缓存与上下文代理指标纳入考虑。',
    constraintApprovalReviewer: '加入权限审批角色前，先确认该任务是否需要此角色。',
    recommendationComposition: '已观测的角色、模型与推理强度构成',
    recommendationProxyKpi: '结构性代理 KPI',
    recommendationEmpty: '此范围没有具备证据的建议。',
    recommendationPartial: '每日索引补齐期间，部分日期范围暂不可用。',
    insightObservation: '观测',
    insightEvidence: '证据',
    insightConditionalAction: '条件式行动',
    insightObservations: {
      'multi-agent-share': '观测到的未缓存用量中，有相当比例与 subagent 角色相关。',
      'effort-comparison': '此结构性代理范围观测到高推理强度。',
      'post-patch-tool-intensity': '此结构性代理范围在应用补丁后观测到较高的工具活动。',
      'cache-context': '已处理活动相对未缓存用量偏高；缓存与上下文可能影响此代理指标。',
      'approval-reviewer-share': '观测到的未缓存用量中，有明显比例与权限审批角色相关。',
    },
    insightTips: {
      'multi-agent-share': '对可比较的任务，先判断是否需要 subagent，再决定是否启动。',
      'effort-comparison': '选择一个代表性任务，将高推理强度与低一级设置做 A/B 对比。',
      'post-patch-tool-intensity': '下次应用补丁后，参考此代理指标评估是否可以缩短工具使用流程。',
      'cache-context': '决定下一个任务边界时，将缓存与上下文观测纳入考虑。',
      'approval-reviewer-share': '加入权限审批角色前，先确认任务是否需要此角色。',
    },
    insightEvidenceLabels: {
      taskCount: '根任务数', rootSessionFresh: '根角色或未知角色的未缓存用量', subagentFresh: 'Subagent 未缓存用量', approvalReviewerFresh: '权限审批未缓存用量', observedEffort: '观测到的推理强度', highEffortFresh: '高推理强度未缓存用量', lowMediumEffortFresh: '较低推理强度未缓存用量', patchCalls: '补丁调用（代理）', toolCalls: '工具调用（代理）', postPatchToolCalls: '补丁后工具调用（代理）', compactCount: '上下文压缩（代理）', taskCompleteCount: '任务完成事件（代理）', processedToFreshRatio: '已处理／未缓存用量代理比值', cachedInputShare: '缓存输入占比', reasoningOutputShare: '推理输出占比',
    },
  },
  ja: {
    recommendations: '最適化の提案',
    constraintNoAgents: '比較可能なタスクでは、サブエージェントが必要かを起動前に判断してください。',
    constraintLowerEffort: '代表的なタスクで、観測された高い推論強度と一段低い設定を A/B 比較してください。',
    constraintPostPatch: '次のパッチ後に構造プロキシを参照し、ツール利用の流れを短くできるか検討してください。',
    constraintCacheContext: '次のタスク境界を選ぶ際に、キャッシュとコンテキストのプロキシを考慮してください。',
    constraintApprovalReviewer: '承認レビュアーを追加する前に、そのタスクで役割が必要か確認してください。',
    recommendationComposition: '観測された役割・モデル・推論強度の構成',
    recommendationProxyKpi: '構造プロキシ KPI',
    recommendationEmpty: 'この範囲には根拠のある提案がありません。',
    recommendationPartial: '日別インデックスの更新中は、一部の日付範囲を利用できません。',
    insightObservation: '観測',
    insightEvidence: '根拠',
    insightConditionalAction: '条件付きアクション',
    insightObservations: {
      'multi-agent-share': '観測された非キャッシュ使用量の大きな割合がサブエージェント役割に関連しています。',
      'effort-comparison': 'この構造プロキシ範囲で高い推論強度が観測されました。',
      'post-patch-tool-intensity': 'この構造プロキシ範囲では、パッチ後のツール活動が高めです。',
      'cache-context': '非キャッシュ使用量に対して処理済み活動が多く、キャッシュやコンテキストがこのプロキシに影響し得ます。',
      'approval-reviewer-share': '観測された非キャッシュ使用量の一定割合が承認レビュアー役割に関連しています。',
    },
    insightTips: {
      'multi-agent-share': '比較可能なタスクでは、サブエージェントが必要かを起動前に判断してください。',
      'effort-comparison': '代表的なタスクで、高い推論強度と一段低い設定を A/B 比較してください。',
      'post-patch-tool-intensity': '次のパッチ後にこのプロキシを参照し、ツール利用の流れを短くできるか検討してください。',
      'cache-context': '次のタスク境界を選ぶ際に、キャッシュとコンテキストの観測を考慮してください。',
      'approval-reviewer-share': '承認レビュアーを追加する前に、その役割が必要か確認してください。',
    },
    insightEvidenceLabels: {
      taskCount: 'ルートタスク数', rootSessionFresh: 'ルート／役割不明の非キャッシュ使用量', subagentFresh: 'サブエージェントの非キャッシュ使用量', approvalReviewerFresh: '承認レビュアーの非キャッシュ使用量', observedEffort: '観測された推論強度', highEffortFresh: '高い推論強度の非キャッシュ使用量', lowMediumEffortFresh: '低い推論強度の非キャッシュ使用量', patchCalls: 'パッチ呼び出し（プロキシ）', toolCalls: 'ツール呼び出し（プロキシ）', postPatchToolCalls: 'パッチ後ツール呼び出し（プロキシ）', compactCount: 'コンテキスト圧縮（プロキシ）', taskCompleteCount: 'タスク完了イベント（プロキシ）', processedToFreshRatio: '処理済み／非キャッシュ使用量のプロキシ比率', cachedInputShare: 'キャッシュ入力の割合', reasoningOutputShare: '出力に占める推論の割合',
    },
  },
  ko: {
    recommendations: '최적화 제안',
    constraintNoAgents: '비교 가능한 작업에서는 하위 에이전트가 필요한지 시작 전에 판단하세요.',
    constraintLowerEffort: '대표 작업에서 관측된 높은 추론 강도와 한 단계 낮은 설정을 A/B 비교하세요.',
    constraintPostPatch: '다음 패치 후 구조적 프록시를 참고해 도구 사용 흐름을 줄일 수 있는지 검토하세요.',
    constraintCacheContext: '다음 작업 경계를 정할 때 캐시 및 컨텍스트 프록시를 고려하세요.',
    constraintApprovalReviewer: '승인 검토자를 추가하기 전에 해당 작업에 그 역할이 필요한지 확인하세요.',
    recommendationComposition: '관측된 역할·모델·추론 강도 구성',
    recommendationProxyKpi: '구조적 프록시 KPI',
    recommendationEmpty: '이 범위에는 근거가 있는 제안이 없습니다.',
    recommendationPartial: '일별 인덱스를 보완하는 동안 일부 날짜 범위를 사용할 수 없습니다.',
    insightObservation: '관측',
    insightEvidence: '근거',
    insightConditionalAction: '조건부 조치',
    insightObservations: {
      'multi-agent-share': '관측된 캐시되지 않은 사용량의 상당 부분이 하위 에이전트 역할과 연관되어 있습니다.',
      'effort-comparison': '이 구조적 프록시 범위에서 높은 추론 강도가 관측되었습니다.',
      'post-patch-tool-intensity': '이 구조적 프록시 범위에서 패치 후 도구 활동이 높게 관측되었습니다.',
      'cache-context': '캐시되지 않은 사용량에 비해 처리된 활동이 많으며 캐시와 컨텍스트가 이 프록시에 영향을 줄 수 있습니다.',
      'approval-reviewer-share': '관측된 캐시되지 않은 사용량의 일정 부분이 승인 검토자 역할과 연관되어 있습니다.',
    },
    insightTips: {
      'multi-agent-share': '비교 가능한 작업에서는 하위 에이전트가 필요한지 시작 전에 판단하세요.',
      'effort-comparison': '대표 작업에서 높은 추론 강도와 한 단계 낮은 설정을 A/B 비교하세요.',
      'post-patch-tool-intensity': '다음 패치 후 이 프록시를 참고해 도구 사용 흐름을 줄일 수 있는지 검토하세요.',
      'cache-context': '다음 작업 경계를 정할 때 캐시 및 컨텍스트 관측을 고려하세요.',
      'approval-reviewer-share': '승인 검토자를 추가하기 전에 그 역할이 필요한지 확인하세요.',
    },
    insightEvidenceLabels: {
      taskCount: '루트 작업 수', rootSessionFresh: '루트 역할 또는 알 수 없는 역할의 캐시되지 않은 사용량', subagentFresh: '하위 에이전트 캐시되지 않은 사용량', approvalReviewerFresh: '승인 검토자 캐시되지 않은 사용량', observedEffort: '관측된 추론 강도', highEffortFresh: '높은 추론 강도 캐시되지 않은 사용량', lowMediumEffortFresh: '낮은 추론 강도 캐시되지 않은 사용량', patchCalls: '패치 호출(프록시)', toolCalls: '도구 호출(프록시)', postPatchToolCalls: '패치 후 도구 호출(프록시)', compactCount: '컨텍스트 압축(프록시)', taskCompleteCount: '작업 완료 이벤트(프록시)', processedToFreshRatio: '처리됨／캐시되지 않은 사용량 프록시 비율', cachedInputShare: '캐시 입력 비율', reasoningOutputShare: '출력 중 추론 비율',
    },
  },
  'pt-BR': {
    recommendations: 'Recomendações de otimização',
    constraintNoAgents: 'Em tarefas comparáveis, decida antes se subagentes são necessários.',
    constraintLowerEffort: 'Em uma tarefa representativa, compare por A/B o esforço alto observado com um nível inferior.',
    constraintPostPatch: 'Após o próximo patch, use o proxy estrutural para avaliar um fluxo de ferramentas mais curto.',
    constraintCacheContext: 'Considere o proxy de cache e contexto ao escolher o próximo limite da tarefa.',
    constraintApprovalReviewer: 'Antes de adicionar revisores de aprovação, confirme se a tarefa precisa dessa função.',
    recommendationComposition: 'Composição observada de funções, modelos e esforço',
    recommendationProxyKpi: 'KPI de proxy estrutural',
    recommendationEmpty: 'Não há recomendações baseadas em evidências para este escopo.',
    recommendationPartial: 'Alguns intervalos de datas ficam indisponíveis enquanto o índice diário é atualizado.',
    insightObservation: 'Observação',
    insightEvidence: 'Evidência',
    insightConditionalAction: 'Ação condicional',
    insightObservations: {
      'multi-agent-share': 'Uma parcela relevante do uso sem cache observado está associada a funções de subagente.',
      'effort-comparison': 'Foi observado esforço alto neste escopo de proxy estrutural.',
      'post-patch-tool-intensity': 'A atividade de ferramentas após patches está elevada neste escopo de proxy estrutural.',
      'cache-context': 'A atividade processada está alta em relação ao uso sem cache; cache e contexto podem influenciar este proxy.',
      'approval-reviewer-share': 'Uma parcela relevante do uso sem cache observado está associada a funções de revisor de aprovação.',
    },
    insightTips: {
      'multi-agent-share': 'Em tarefas comparáveis, decida antes se subagentes são necessários.',
      'effort-comparison': 'Em uma tarefa representativa, compare por A/B o esforço alto com um nível inferior.',
      'post-patch-tool-intensity': 'Após o próximo patch, use este proxy para avaliar um fluxo de ferramentas mais curto.',
      'cache-context': 'Considere as observações de cache e contexto ao escolher o próximo limite da tarefa.',
      'approval-reviewer-share': 'Antes de adicionar revisores de aprovação, confirme se essa função é necessária.',
    },
    insightEvidenceLabels: {
      taskCount: 'Tarefas raiz', rootSessionFresh: 'Uso sem cache da função raiz ou de função desconhecida', subagentFresh: 'Uso sem cache de subagentes', approvalReviewerFresh: 'Uso sem cache de revisores de aprovação', observedEffort: 'Esforço observado', highEffortFresh: 'Uso sem cache com esforço alto', lowMediumEffortFresh: 'Uso sem cache com esforço inferior', patchCalls: 'Chamadas de patch (proxy)', toolCalls: 'Chamadas de ferramenta (proxy)', postPatchToolCalls: 'Chamadas de ferramenta pós-patch (proxy)', compactCount: 'Compactações de contexto (proxy)', taskCompleteCount: 'Eventos de conclusão de tarefa (proxy)', processedToFreshRatio: 'Proxy processado / sem cache', cachedInputShare: 'Proporção de entrada em cache', reasoningOutputShare: 'Proporção de raciocínio na saída',
    },
  },
  id: {
    recommendations: 'Rekomendasi optimasi',
    constraintNoAgents: 'Untuk tugas yang sebanding, tentukan lebih dulu apakah subagen diperlukan.',
    constraintLowerEffort: 'Pada tugas perwakilan, bandingkan secara A/B effort tinggi yang teramati dengan satu tingkat lebih rendah.',
    constraintPostPatch: 'Setelah patch berikutnya, gunakan proksi struktural untuk menilai alur alat yang lebih singkat.',
    constraintCacheContext: 'Pertimbangkan proksi cache dan konteks saat memilih batas tugas berikutnya.',
    constraintApprovalReviewer: 'Sebelum menambah peninjau persetujuan, pastikan tugas tersebut memerlukan peran itu.',
    recommendationComposition: 'Komposisi peran, model, dan effort yang teramati',
    recommendationProxyKpi: 'KPI proksi struktural',
    recommendationEmpty: 'Tidak ada rekomendasi berbasis bukti untuk cakupan ini.',
    recommendationPartial: 'Beberapa rentang tanggal tidak tersedia selama indeks harian dilengkapi.',
    insightObservation: 'Pengamatan',
    insightEvidence: 'Bukti',
    insightConditionalAction: 'Tindakan bersyarat',
    insightObservations: {
      'multi-agent-share': 'Porsi yang berarti dari penggunaan tanpa cache teramati berkaitan dengan peran subagen.',
      'effort-comparison': 'Effort tinggi teramati dalam cakupan proksi struktural ini.',
      'post-patch-tool-intensity': 'Aktivitas alat setelah patch teramati lebih tinggi dalam cakupan proksi struktural ini.',
      'cache-context': 'Aktivitas terproses tinggi dibanding penggunaan tanpa cache; cache dan konteks dapat memengaruhi proksi ini.',
      'approval-reviewer-share': 'Porsi yang berarti dari penggunaan tanpa cache teramati berkaitan dengan peran peninjau persetujuan.',
    },
    insightTips: {
      'multi-agent-share': 'Untuk tugas yang sebanding, tentukan lebih dulu apakah subagen diperlukan.',
      'effort-comparison': 'Pada tugas perwakilan, bandingkan secara A/B effort tinggi dengan satu tingkat lebih rendah.',
      'post-patch-tool-intensity': 'Setelah patch berikutnya, gunakan proksi ini untuk menilai alur alat yang lebih singkat.',
      'cache-context': 'Pertimbangkan pengamatan cache dan konteks saat memilih batas tugas berikutnya.',
      'approval-reviewer-share': 'Sebelum menambah peninjau persetujuan, pastikan peran itu diperlukan.',
    },
    insightEvidenceLabels: {
      taskCount: 'Jumlah tugas utama', rootSessionFresh: 'Penggunaan tanpa cache oleh peran utama atau peran yang tidak diketahui', subagentFresh: 'Penggunaan tanpa cache subagen', approvalReviewerFresh: 'Penggunaan tanpa cache peninjau persetujuan', observedEffort: 'Effort teramati', highEffortFresh: 'Penggunaan tanpa cache effort tinggi', lowMediumEffortFresh: 'Penggunaan tanpa cache effort lebih rendah', patchCalls: 'Panggilan patch (proksi)', toolCalls: 'Panggilan alat (proksi)', postPatchToolCalls: 'Panggilan alat pasca-patch (proksi)', compactCount: 'Pemadatan konteks (proksi)', taskCompleteCount: 'Peristiwa penyelesaian tugas (proksi)', processedToFreshRatio: 'Proksi diproses / tanpa cache', cachedInputShare: 'Porsi input cache', reasoningOutputShare: 'Porsi penalaran dalam output',
    },
  },
};

type CodexTask8CopyKey =
  | 'refresh'
  | 'explore'
  | 'noMonthlyData'
  | 'indexedLogEntries'
  | 'indexedStorage'
  | 'indexedAllTime'
  | 'indexedSubtotal'
  | 'indexingInProgress'
  | 'indexingReasons'
  | 'updatedAt'
  | 'claudeTokenAccounting'
  | 'codexTokenAccounting'
  | 'qualityFlagLabels'
  | 'qualityFlagUnknown';

const TASK8_CODEX_COPY: Record<
  Exclude<SupportedLanguage, 'en'>,
  Pick<CodexViewCopy, CodexTask8CopyKey>
> = {
  'de-DE': {
    refresh: 'Aktualisieren',
    explore: 'Erkunden',
    noMonthlyData: 'Noch keine monatliche Codex-Nutzung indexiert.',
    indexedLogEntries: 'Indexierte Protokolleinträge',
    indexedStorage: 'Indexierter Speicher',
    indexedAllTime: 'Indexierter Gesamtzeitraum',
    indexedSubtotal: 'Indizierte Zwischensumme',
    indexingInProgress: 'Die Indexierung läuft noch; nicht verifizierte Altsummen werden ausgeschlossen.',
    indexingReasons: {
      'first-index': 'Erste lokale Verlaufseinrichtung',
      'parser-migration': 'Lokalen Parser-Index aktualisieren',
      'period-migration': 'Datumsverlauf aktualisieren',
      'hourly-history': 'Stündlichen Verlauf der letzten Zeit erstellen',
      'history-backfill': 'Lokalen Verlauf vervollständigen',
      'rule-migration': 'Messregeln aktualisieren',
      resume: 'Lokalen Verlauf fortsetzen',
    },
    updatedAt: 'Aktualisiert um',
    claudeTokenAccounting: 'Claude-Token-Zählung',
    codexTokenAccounting: 'Codex-Token-Zählung',
    qualityFlagLabels: {
      'invalid-turn-context': 'Ungültiger Turn-Kontext',
      'invalid-session-meta': 'Ungültige Sitzungsmetadaten',
      'missing-pseudonymizer': 'Identitätsschutz nicht verfügbar',
      'missing-token-info': 'Fehlende Token-Informationen',
      'invalid-token-count': 'Ungültige Token-Anzahl',
      'counter-regression': 'Rückläufiger Nutzungszähler',
      'component-delta-clamped': 'Delta für Cache- oder Reasoning-Tokens überschritt die übergeordnete Summe und wurde begrenzt',
      'missing-parent': 'Protokoll der übergeordneten Sitzung fehlt; konservative Nutzung beibehalten',
      'index-backfill-incomplete': 'Nutzungsindex wird noch aufgebaut; aktuelle Werte sind unvollständig und die Indexierung wird automatisch fortgesetzt',
      'ambiguous-session-identity': 'Doppelte Sitzungsidentität ist mehrdeutig; beide lokalen Kopien werden beibehalten',
      'invalid-json': 'Unlesbarer JSON-Protokolleintrag',
      'invalid-event-payload': 'Ungültige Ereignisdaten',
      'unknown-event': 'Nicht erkanntes Protokollereignis',
      'invalid-event-timestamp': 'Ungültiger Ereigniszeitstempel',
      'oversized-jsonl-line': 'Zu großer Protokolleintrag',
      'truncated-jsonl': 'Protokolldatei wurde gekürzt',
      'replaced-jsonl': 'Protokolldatei wurde ersetzt',
      'stale-file': 'Letzte geprüfte Dateidaten werden verwendet',
      'stale-reset-required': 'Vollständiger Datei-Neuscan erforderlich',
    },
    qualityFlagUnknown: 'Anderes Datenqualitätsproblem',
  },
  'zh-TW': {
    refresh: '重新整理',
    explore: '探索',
    noMonthlyData: '尚未索引到 Codex 每月用量。',
    indexedLogEntries: '已索引記錄',
    indexedStorage: '已索引儲存空間',
    indexedAllTime: '已索引的全部時間',
    indexedSubtotal: '已索引小計',
    indexingInProgress: '索引仍在進行；未驗證的舊版總量不會計入。',
    indexingReasons: {
      'first-index': '首次設定本機歷史',
      'parser-migration': '更新本機解析器索引',
      'period-migration': '更新日期歷史',
      'hourly-history': '建立近期每小時歷史',
      'history-backfill': '補齊本機歷史',
      'rule-migration': '更新量測規則',
      resume: '繼續整理本機歷史',
    },
    updatedAt: '更新於',
    claudeTokenAccounting: 'Claude Token 口徑',
    codexTokenAccounting: 'Codex Token 口徑',
    qualityFlagLabels: {
      'invalid-turn-context': '無效的輪次內容',
      'invalid-session-meta': '無效的工作階段中繼資料',
      'missing-pseudonymizer': '無法使用身分保護',
      'missing-token-info': '缺少 Token 資訊',
      'invalid-token-count': '無效的 Token 數量',
      'counter-regression': '用量計數器回退',
      'component-delta-clamped': '快取或推理 Token 增量超過其上層總量，已限制於總量內',
      'missing-parent': '缺少父工作階段記錄；已保留保守用量',
      'index-backfill-incomplete': '用量索引仍在建立；目前數字不完整，索引會自動繼續',
      'ambiguous-session-identity': '重複工作階段身分無法安全判定；兩份本機副本均已保留',
      'invalid-json': '無法讀取的 JSON 記錄',
      'invalid-event-payload': '無效的事件資料',
      'unknown-event': '無法識別的記錄事件',
      'invalid-event-timestamp': '無效的事件時間戳',
      'oversized-jsonl-line': '記錄項目過大',
      'truncated-jsonl': '記錄檔已截短',
      'replaced-jsonl': '記錄檔已被取代',
      'stale-file': '正在使用上次驗證的檔案資料',
      'stale-reset-required': '需要完整重新掃描檔案',
    },
    qualityFlagUnknown: '其他資料品質問題',
  },
  'zh-CN': {
    refresh: '刷新',
    explore: '探索',
    noMonthlyData: '尚未索引到 Codex 每月用量。',
    indexedLogEntries: '已索引日志记录',
    indexedStorage: '已索引存储',
    indexedAllTime: '已索引的全部时间',
    indexedSubtotal: '已索引小计',
    indexingInProgress: '索引仍在进行；未验证的旧版总量不会计入。',
    indexingReasons: {
      'first-index': '首次整理本地历史',
      'parser-migration': '更新本地解析器索引',
      'period-migration': '更新日期历史',
      'hourly-history': '整理近期小时历史',
      'history-backfill': '补齐本地历史',
      'rule-migration': '更新测量规则',
      resume: '继续整理本地历史',
    },
    updatedAt: '更新时间',
    claudeTokenAccounting: 'Claude Token 口径',
    codexTokenAccounting: 'Codex Token 口径',
    qualityFlagLabels: {
      'invalid-turn-context': '无效的轮次上下文',
      'invalid-session-meta': '无效的会话元数据',
      'missing-pseudonymizer': '身份保护不可用',
      'missing-token-info': '缺少 Token 信息',
      'invalid-token-count': '无效的 Token 数量',
      'counter-regression': '用量计数器回退',
      'component-delta-clamped': '缓存或推理 Token 增量超过其上层总量，已限制在总量内',
      'missing-parent': '缺少父会话日志；已保留保守用量',
      'index-backfill-incomplete': '用量索引仍在建立；当前数字不完整，索引会自动继续',
      'ambiguous-session-identity': '重复会话身份无法安全判定；两个本地副本均已保留',
      'invalid-json': '无法读取的 JSON 日志记录',
      'invalid-event-payload': '无效的事件载荷',
      'unknown-event': '无法识别的日志事件',
      'invalid-event-timestamp': '无效的事件时间戳',
      'oversized-jsonl-line': '日志记录过大',
      'truncated-jsonl': '日志文件已截断',
      'replaced-jsonl': '日志文件已替换',
      'stale-file': '正在使用上次验证的文件数据',
      'stale-reset-required': '需要完整重新扫描文件',
    },
    qualityFlagUnknown: '其他数据质量问题',
  },
  ja: {
    refresh: '更新',
    explore: '探索',
    noMonthlyData: '月別の Codex 使用量はまだ索引化されていません。',
    indexedLogEntries: '索引済みログ項目',
    indexedStorage: '索引済みストレージ',
    indexedAllTime: '索引済みの全期間',
    indexedSubtotal: 'インデックス済み小計',
    indexingInProgress: 'インデックス作成中です。未検証の旧集計値は除外されています。',
    indexingReasons: {
      'first-index': '初回のローカル履歴設定',
      'parser-migration': 'ローカル解析インデックスを更新中',
      'period-migration': '日付履歴を更新中',
      'hourly-history': '最近の時間別履歴を作成中',
      'history-backfill': 'ローカル履歴を補完中',
      'rule-migration': '測定ルールを更新中',
      resume: 'ローカル履歴を再開中',
    },
    updatedAt: '更新日時',
    claudeTokenAccounting: 'Claude トークン集計',
    codexTokenAccounting: 'Codex トークン集計',
    qualityFlagLabels: {
      'invalid-turn-context': '無効なターンコンテキスト',
      'invalid-session-meta': '無効なセッションメタデータ',
      'missing-pseudonymizer': 'ID 保護を利用できません',
      'missing-token-info': 'トークン情報がありません',
      'invalid-token-count': '無効なトークン数',
      'counter-regression': '使用量カウンターの後退',
      'component-delta-clamped': 'キャッシュまたは推論トークンの差分が親の合計を超えたため上限を適用',
      'missing-parent': '親セッションのログがないため、保守的な使用量を保持',
      'index-backfill-incomplete': '使用量インデックスを作成中です。現在の数値は不完全で、インデックス作成は自動的に続行されます',
      'ambiguous-session-identity': '重複セッションの同一性を確定できないため、両方のローカルコピーを保持しています',
      'invalid-json': '読み取れない JSON ログ項目',
      'invalid-event-payload': '無効なイベントペイロード',
      'unknown-event': '認識されないログイベント',
      'invalid-event-timestamp': '無効なイベントタイムスタンプ',
      'oversized-jsonl-line': 'ログ項目が大きすぎます',
      'truncated-jsonl': 'ログファイルが切り詰められました',
      'replaced-jsonl': 'ログファイルが置き換えられました',
      'stale-file': '最後に検証したファイルデータを使用中',
      'stale-reset-required': 'ファイル全体の再スキャンが必要',
    },
    qualityFlagUnknown: 'その他のデータ品質問題',
  },
  ko: {
    refresh: '새로 고침',
    explore: '탐색',
    noMonthlyData: '아직 월별 Codex 사용량이 인덱싱되지 않았습니다.',
    indexedLogEntries: '인덱싱된 로그 항목',
    indexedStorage: '인덱싱된 저장 공간',
    indexedAllTime: '인덱싱된 전체 기간',
    indexedSubtotal: '인덱싱된 소계',
    indexingInProgress: '인덱싱이 진행 중이며 검증되지 않은 이전 합계는 제외됩니다.',
    indexingReasons: {
      'first-index': '첫 로컬 기록 설정',
      'parser-migration': '로컬 파서 인덱스 업데이트',
      'period-migration': '날짜 기록 업데이트',
      'hourly-history': '최근 시간별 기록 생성',
      'history-backfill': '로컬 기록 완성',
      'rule-migration': '측정 규칙 업데이트',
      resume: '로컬 기록 재개',
    },
    updatedAt: '업데이트 시각',
    claudeTokenAccounting: 'Claude 토큰 집계',
    codexTokenAccounting: 'Codex 토큰 집계',
    qualityFlagLabels: {
      'invalid-turn-context': '잘못된 턴 컨텍스트',
      'invalid-session-meta': '잘못된 세션 메타데이터',
      'missing-pseudonymizer': 'ID 보호를 사용할 수 없음',
      'missing-token-info': '토큰 정보 누락',
      'invalid-token-count': '잘못된 토큰 수',
      'counter-regression': '사용량 카운터 역행',
      'component-delta-clamped': '캐시 또는 추론 토큰 증가분이 상위 합계를 초과하여 상한을 적용함',
      'missing-parent': '부모 세션 로그 누락; 보수적 사용량 유지',
      'index-backfill-incomplete': '사용량 인덱스를 만드는 중입니다. 현재 수치는 불완전하며 인덱싱은 자동으로 계속됩니다',
      'ambiguous-session-identity': '중복 세션의 동일성을 확정할 수 없어 두 로컬 사본을 모두 유지합니다',
      'invalid-json': '읽을 수 없는 JSON 로그 항목',
      'invalid-event-payload': '잘못된 이벤트 페이로드',
      'unknown-event': '인식되지 않은 로그 이벤트',
      'invalid-event-timestamp': '잘못된 이벤트 타임스탬프',
      'oversized-jsonl-line': '로그 항목이 너무 큼',
      'truncated-jsonl': '로그 파일이 잘림',
      'replaced-jsonl': '로그 파일이 교체됨',
      'stale-file': '마지막으로 검증된 파일 데이터 사용 중',
      'stale-reset-required': '전체 파일 재스캔 필요',
    },
    qualityFlagUnknown: '기타 데이터 품질 문제',
  },
  'pt-BR': {
    refresh: 'Atualizar',
    explore: 'Explorar',
    noMonthlyData: 'Nenhum uso mensal do Codex foi indexado ainda.',
    indexedLogEntries: 'Registros de log indexados',
    indexedStorage: 'Armazenamento indexado',
    indexedAllTime: 'Todo o período indexado',
    indexedSubtotal: 'Subtotal indexado',
    indexingInProgress: 'A indexação ainda está em andamento; totais legados não verificados são excluídos.',
    indexingReasons: {
      'first-index': 'Primeira configuração do histórico local',
      'parser-migration': 'Atualizando o índice do analisador local',
      'period-migration': 'Atualizando o histórico por data',
      'hourly-history': 'Criando o histórico horário recente',
      'history-backfill': 'Concluindo o histórico local',
      'rule-migration': 'Atualizando as regras de medição',
      resume: 'Retomando o histórico local',
    },
    updatedAt: 'Atualizado em',
    claudeTokenAccounting: 'Contagem de tokens do Claude',
    codexTokenAccounting: 'Contagem de tokens do Codex',
    qualityFlagLabels: {
      'invalid-turn-context': 'Contexto de turno inválido',
      'invalid-session-meta': 'Metadados de sessão inválidos',
      'missing-pseudonymizer': 'Proteção de identidade indisponível',
      'missing-token-info': 'Informações de token ausentes',
      'invalid-token-count': 'Contagem de tokens inválida',
      'counter-regression': 'Regressão do contador de uso',
      'component-delta-clamped': 'O delta de tokens em cache ou de raciocínio excedeu o total pai e foi limitado',
      'missing-parent': 'Log da sessão pai ausente; uso conservador mantido',
      'index-backfill-incomplete': 'O índice de uso ainda está sendo criado; os números atuais estão incompletos e a indexação continuará automaticamente',
      'ambiguous-session-identity': 'A identidade da sessão duplicada é ambígua; ambas as cópias locais foram mantidas',
      'invalid-json': 'Entrada de log JSON ilegível',
      'invalid-event-payload': 'Payload de evento inválido',
      'unknown-event': 'Evento de log não reconhecido',
      'invalid-event-timestamp': 'Timestamp de evento inválido',
      'oversized-jsonl-line': 'Entrada de log grande demais',
      'truncated-jsonl': 'Arquivo de log truncado',
      'replaced-jsonl': 'Arquivo de log substituído',
      'stale-file': 'Usando os últimos dados de arquivo verificados',
      'stale-reset-required': 'Nova varredura completa do arquivo necessária',
    },
    qualityFlagUnknown: 'Outro problema de qualidade dos dados',
  },
  id: {
    refresh: 'Segarkan',
    explore: 'Jelajahi',
    noMonthlyData: 'Belum ada penggunaan bulanan Codex yang diindeks.',
    indexedLogEntries: 'Entri log terindeks',
    indexedStorage: 'Penyimpanan terindeks',
    indexedAllTime: 'Seluruh waktu terindeks',
    indexedSubtotal: 'Subtotal terindeks',
    indexingInProgress: 'Pengindeksan masih berlangsung; total lama yang belum diverifikasi tidak disertakan.',
    indexingReasons: {
      'first-index': 'Penyiapan awal riwayat lokal',
      'parser-migration': 'Memperbarui indeks parser lokal',
      'period-migration': 'Memperbarui riwayat tanggal',
      'hourly-history': 'Membuat riwayat per jam terbaru',
      'history-backfill': 'Melengkapi riwayat lokal',
      'rule-migration': 'Memperbarui aturan pengukuran',
      resume: 'Melanjutkan riwayat lokal',
    },
    updatedAt: 'Diperbarui pada',
    claudeTokenAccounting: 'Penghitungan token Claude',
    codexTokenAccounting: 'Penghitungan token Codex',
    qualityFlagLabels: {
      'invalid-turn-context': 'Konteks giliran tidak valid',
      'invalid-session-meta': 'Metadata sesi tidak valid',
      'missing-pseudonymizer': 'Perlindungan identitas tidak tersedia',
      'missing-token-info': 'Informasi token tidak ada',
      'invalid-token-count': 'Jumlah token tidak valid',
      'counter-regression': 'Penghitung penggunaan mundur',
      'component-delta-clamped': 'Delta token cache atau penalaran melebihi total induknya dan telah dibatasi',
      'missing-parent': 'Log sesi induk tidak ada; penggunaan konservatif dipertahankan',
      'index-backfill-incomplete': 'Indeks penggunaan masih dibuat; angka saat ini belum lengkap dan pengindeksan akan berlanjut otomatis',
      'ambiguous-session-identity': 'Identitas sesi duplikat ambigu; kedua salinan lokal dipertahankan',
      'invalid-json': 'Entri log JSON tidak terbaca',
      'invalid-event-payload': 'Payload peristiwa tidak valid',
      'unknown-event': 'Peristiwa log tidak dikenali',
      'invalid-event-timestamp': 'Timestamp peristiwa tidak valid',
      'oversized-jsonl-line': 'Entri log terlalu besar',
      'truncated-jsonl': 'File log terpotong',
      'replaced-jsonl': 'File log diganti',
      'stale-file': 'Menggunakan data file terakhir yang terverifikasi',
      'stale-reset-required': 'Pemindaian ulang file secara penuh diperlukan',
    },
    qualityFlagUnknown: 'Masalah kualitas data lainnya',
  },
};

function providerTranslations(
  labels: { claude: string; codexBeta: string; compare: string },
  overrides: CodexCopyOverrides,
  task5Overrides: CodexCopyOverrides = {},
): ProviderTranslations {
  const {
    constraintTests: _legacyConstraintTests,
    constraintStop: _legacyConstraintStop,
    ...safeOverrides
  } = overrides;
  const merged = { ...safeOverrides, ...task5Overrides };
  return {
    ...labels,
    codex: {
      ...CODEX_COPY_EN,
      ...merged,
      insightTitles: {
        ...CODEX_COPY_EN.insightTitles,
        ...overrides.insightTitles,
        ...task5Overrides.insightTitles,
      },
      insightObservations: {
        ...CODEX_COPY_EN.insightObservations,
        ...overrides.insightObservations,
        ...task5Overrides.insightObservations,
      },
      insightTips: {
        ...CODEX_COPY_EN.insightTips,
        ...overrides.insightTips,
        ...task5Overrides.insightTips,
      },
      insightEvidenceLabels: {
        ...CODEX_COPY_EN.insightEvidenceLabels,
        ...overrides.insightEvidenceLabels,
        ...task5Overrides.insightEvidenceLabels,
      },
      indexingReasons: {
        ...CODEX_COPY_EN.indexingReasons,
        ...overrides.indexingReasons,
        ...task5Overrides.indexingReasons,
      },
    },
  };
}

const PROVIDERS: Record<SupportedLanguage, ProviderTranslations> = {
  en: providerTranslations(
    { claude: 'Claude', codexBeta: 'Codex Beta', compare: 'Compare' },
    {},
  ),
  'de-DE': providerTranslations(
    { claude: 'Claude', codexBeta: 'Codex Beta', compare: 'Vergleichen' },
    {
      ...TASK8_CODEX_COPY['de-DE'],
      accountSnapshotLastObserved:
        'Nutzung fasst Anmeldungen in diesem Codex home zusammen · Limits werden zuletzt beobachtet, nicht kombiniert',
      title: 'Codex-Nutzung', beta: 'Beta', overview: 'Übersicht', usageTrend: 'Nutzungstrend', daily: 'Täglich', date: 'Datum', role: 'Rolle', scope: 'Bereich', threadLabel: 'Thread', rootRole: 'Hauptaufgabe', childRole: 'Subagent', approvalReviewerRole: 'Freigabe-Prüfer', unknownRole: 'Unbekannt', noDailyData: 'Noch keine tägliche Codex-Nutzung indexiert.', noThreadData: 'Noch keine Codex-Threads indexiert.', lastTask: 'Letzte Aufgabe', last7Days: 'Letzte 7 Tage', last30Days: 'Letzte 30 Tage', projects: 'Projekte', projectLabel: 'Projekt',
      unnamedSession: 'Unbenannte Sitzung', unidentifiedProject: 'Nicht identifiziertes Projekt', parentThread: 'Übergeordnet', parentTask: 'Übergeordnete Aufgabe', searchThreads: 'Sitzungen suchen', sessions: 'Sitzungen', modelsEffort: 'Modelle & Aufwand', clearFilters: 'Filter löschen', activeFilters: 'Aktive Filter', all: 'Alle', localDirectory: 'Lokaler Ordner', lastActive: 'Zuletzt aktiv', expand: 'Erweitern', viewAllSessions: 'Alle Sitzungen anzeigen', sortBy: 'Sortieren nach', usageLimits: 'Nutzungslimits', resets: 'Zurücksetzung', credits: 'Guthaben', unlimited: 'Unbegrenzt',
      allTime: 'Gesamter Zeitraum', behavior: 'Verhalten', settings: 'Einstellungen', monthly: 'Monatlich', tokenComposition: 'Token-Zusammensetzung', freshInput: 'Eingabe ohne Cache', reasoningSubset: 'In Ausgabe enthalten', threadRoleComposition: 'Thread-Rollenverteilung', childThreadsPerRootTask: 'Unter-Threads / Hauptaufgabe', childFreshShare: 'Anteil der Nutzung ohne Cache durch Unter-Threads', approvalFreshShare: 'Anteil der Nutzung ohne Cache durch Freigabeprüfung', highEffortFreshShare: 'Anteil der Nutzung ohne Cache bei hohem Aufwand', processedToFreshRatio: 'Verarbeitet / Nutzung ohne Cache', reasoningOutputShare: 'Reasoning-Anteil der Ausgabe', postPatchToolCallsPerPatchCall: 'Tool-Call-Proxy nach Patch / Patch-Aufruf', patchCalls: 'Patch-Aufrufe', compactions: 'Kontextkomprimierungen',
      processed: 'Verarbeitet', apiEquivalentCost: 'API-äquivalente Kosten', apiEquivalentCostHelp: 'Aus derzeit indexierten Token mit aktuellen offiziellen API-Preisen geschätzt; keine Rechnung oder Abonnementbelastung. Preisabdeckung: {coverage}.', fresh: 'Nutzung ohne Cache', input: 'Eingabe', cachedInput: 'Gecachte Eingabe', output: 'Ausgabe', reasoning: 'Reasoning',
      model: 'Modell', models: 'Modelle', efforts: 'Aufwand', threads: 'Threads', rootTasks: 'Hauptaufgaben', childThreads: 'Unter-Threads', approvalReviewers: 'Freigabe-Prüfer', duration: 'Sitzungsspanne', cacheShare: 'Eingabe-Cache-Anteil',
      coverage: 'Abdeckung', quality: 'Qualität', complete: 'Vollständig', partial: 'Teilweise', lastObserved: 'Zuletzt beobachtet', unavailable: 'Nicht verfügbar', optimization: 'Lokale Optimierungssignale', structuralProxy: 'Struktureller Proxy; Tool-Call-Details werden nicht gelesen.', pasteConstraint: 'Kopierbare Einschränkung', constraintNoAgents: 'Keine unnötigen Unteragenten oder unabhängigen Prüfungen starten.', constraintLowerEffort: 'Für diese kleine Änderung eine niedrigere Aufwandsstufe an einer repräsentativen Aufgabe vergleichen.', constraintTests: 'Einen fokussierten Test und danach einen vollständigen Testlauf ausführen.', constraintStop: 'Bei erfüllten Kriterien stoppen; nicht zu produktionsreifer Härtung ausweiten.', compareTitle: 'Anbietervergleich', noRecentTask: 'Noch keine aktuelle Codex-Aufgabe indexiert.', fiveHourWindow: '5-Stunden-Fenster', weeklyWindow: 'Wöchentliches Fenster', used: 'verwendet', remaining: 'verbleibend', localLogNotLive: 'Lokales Protokoll · nicht live', limitExpired: 'Abgelaufen / zuletzt beobachtet', limitMissing: 'Kein lokal beobachtetes Nutzungslimit', observedSessionDuration: 'Zeitspanne zwischen dem ersten und letzten beobachteten Ereignis; ein Proxy, keine tatsächliche aktive Zeit.',
      insightTitles: { 'multi-agent-share': 'Anteil der Nutzung ohne Cache durch Unter-Threads', 'effort-comparison': 'Eine niedrigere Aufwandsstufe vergleichen', 'post-patch-tool-intensity': 'Post-Patch-Tool-Proxy', 'cache-context': 'Cache- und Langkontext', 'approval-reviewer-share': 'Anteil der Nutzung ohne Cache durch Freigabe-Prüfer' },
    },
    TASK5_CODEX_COPY['de-DE'],
  ),
  'zh-TW': providerTranslations(
    { claude: 'Claude', codexBeta: 'Codex Beta', compare: '比較' },
    {
      ...TASK8_CODEX_COPY['zh-TW'],
      accountSnapshotLastObserved:
        '用量會合併此 Codex home 中的多個登入 · 額度只顯示最後觀測，不合併',
      title: 'Codex 用量', beta: 'Beta', overview: '總覽', usageTrend: '用量趨勢', daily: '按日', date: '日期', role: '角色', scope: '範圍', threadLabel: '執行緒', rootRole: '根任務', childRole: 'Subagent', approvalReviewerRole: '權限審批', unknownRole: '未知', noDailyData: '尚未索引到 Codex 每日用量。', noThreadData: '尚未索引到 Codex 執行緒。', lastTask: '最近任務', last7Days: '最近 7 天', last30Days: '最近 30 天', projects: '專案', projectLabel: '專案',
      unnamedSession: '未命名工作階段', unidentifiedProject: '未識別專案', parentThread: '父執行緒', parentTask: '父任務', searchThreads: '搜尋工作階段', sessions: '工作階段', modelsEffort: '模型與推理強度', clearFilters: '清除篩選條件', activeFilters: '作用中的篩選條件', all: '全部', localDirectory: '本機資料夾', lastActive: '最後活動', expand: '展開', viewAllSessions: '檢視所有工作階段', sortBy: '排序依據', usageLimits: '用量限制', resets: '重設時間', credits: '點數', unlimited: '無上限',
      allTime: '全部時間', behavior: '行為', settings: '設定', monthly: '按月', tokenComposition: 'Token 構成', freshInput: '未快取輸入', reasoningSubset: '已包含在輸出中', threadRoleComposition: '執行緒角色構成', childThreadsPerRootTask: '每個根任務的子執行緒數', childFreshShare: '子執行緒未快取用量占比', approvalFreshShare: '審批未快取用量占比', highEffortFreshShare: '高推理強度未快取用量占比', processedToFreshRatio: '已處理 / 未快取用量', reasoningOutputShare: '推理占輸出比例', postPatchToolCallsPerPatchCall: '每次修補呼叫的修補後工具呼叫代理量', patchCalls: '修補呼叫次數', compactions: '上下文壓縮次數',
      processed: '已處理', apiEquivalentCost: 'API 等效成本', apiEquivalentCostHelp: '依目前已建立索引的 Token 與現行官方 API 單價估算；不是帳單或訂閱扣款。已定價模型涵蓋率：{coverage}。', fresh: '未快取用量', input: '輸入', cachedInput: '快取輸入', output: '輸出', reasoning: '推理',
      model: '模型', models: '模型', efforts: '推理強度', threads: '執行緒', rootTasks: '根任務', childThreads: '子執行緒', approvalReviewers: '權限審批執行緒', duration: '工作階段跨度', cacheShare: '輸入快取占比',
      coverage: '索引覆蓋率', quality: '資料品質', complete: '完整', partial: '部分', lastObserved: '最後觀測', unavailable: '無資料', optimization: '本機最佳化訊號', structuralProxy: '結構性代理指標；不讀取工具呼叫細節。', pasteConstraint: '可複製約束', constraintNoAgents: '不要啟動不必要的 subagent 或獨立審閱。', constraintLowerEffort: '對這個小改動，用代表性任務比較低一級推理強度。', constraintTests: '只執行一次聚焦測試，再執行一次完整測試。', constraintStop: '達到驗收條件後停止，不要擴展為生產級加固。', compareTitle: '供應商比較', noRecentTask: '尚未索引到最近的 Codex 任務。', fiveHourWindow: '5 小時視窗', weeklyWindow: '每週視窗', used: '已用', remaining: '剩餘', localLogNotLive: '本機記錄 · 非即時', limitExpired: '已過期／最後觀測', limitMissing: '沒有本機觀測到的用量限制', observedSessionDuration: '首個與末個觀測事件之間的時間跨度代理值，並非實際活躍時長。',
      insightTitles: { 'multi-agent-share': '子執行緒的未快取用量占比', 'effort-comparison': '比較低一級推理強度', 'post-patch-tool-intensity': '修補後工具呼叫代理量', 'cache-context': '快取與長上下文解讀', 'approval-reviewer-share': '權限審批的未快取用量占比' },
    },
    TASK5_CODEX_COPY['zh-TW'],
  ),
  'zh-CN': providerTranslations(
    { claude: 'Claude', codexBeta: 'Codex Beta', compare: '对比' },
    {
      ...TASK8_CODEX_COPY['zh-CN'],
      accountSnapshotLastObserved:
        '用量会合并此 Codex home 中的多个登录 · 额度只显示最后观测，不合并',
      title: 'Codex 用量', beta: 'Beta', overview: '概览', usageTrend: '用量趋势', daily: '按日', date: '日期', role: '角色', scope: '范围', threadLabel: '线程', rootRole: '根任务', childRole: 'Subagent', approvalReviewerRole: '权限审批', unknownRole: '未知', noDailyData: '尚未索引到 Codex 每日用量。', noThreadData: '尚未索引到 Codex 线程。', lastTask: '最近任务', last7Days: '最近 7 天', last30Days: '最近 30 天', projects: '项目', projectLabel: '项目',
      unnamedSession: '未命名会话', unidentifiedProject: '未识别项目', parentThread: '父线程', parentTask: '父任务', searchThreads: '搜索会话', sessions: '会话', modelsEffort: '模型与推理强度', clearFilters: '清除筛选条件', activeFilters: '生效的筛选条件', all: '全部', localDirectory: '本地文件夹', lastActive: '最后活动', expand: '展开', viewAllSessions: '查看所有会话', sortBy: '排序依据', usageLimits: '用量限制', resets: '重置时间', credits: '点数', unlimited: '无限制',
      allTime: '全部时间', behavior: '行为', settings: '设置', monthly: '按月', tokenComposition: 'Token 构成', freshInput: '未缓存输入', reasoningSubset: '已包含在输出中', threadRoleComposition: '线程角色构成', childThreadsPerRootTask: '每个根任务的子线程数', childFreshShare: '子线程未缓存用量占比', approvalFreshShare: '审批未缓存用量占比', highEffortFreshShare: '高推理强度未缓存用量占比', processedToFreshRatio: '已处理 / 未缓存用量', reasoningOutputShare: '推理占输出比例', postPatchToolCallsPerPatchCall: '每次补丁调用的补丁后工具调用代理量', patchCalls: '补丁调用次数', compactions: '上下文压缩次数',
      processed: '已处理', apiEquivalentCost: 'API 等效成本', apiEquivalentCostHelp: '按当前已索引 Token 和现行官方 API 单价估算；不是账单或订阅扣费。已定价模型覆盖率：{coverage}。', fresh: '未缓存用量', input: '输入', cachedInput: '缓存输入', output: '输出', reasoning: '推理',
      model: '模型', models: '模型', efforts: '推理强度', threads: '线程', rootTasks: '根任务', childThreads: '子线程', approvalReviewers: '权限审批线程', duration: '会话跨度', cacheShare: '输入缓存占比',
      coverage: '索引覆盖率', quality: '数据质量', complete: '完整', partial: '部分', lastObserved: '最后观测', unavailable: '无数据', optimization: '本地优化信号', structuralProxy: '结构性代理指标；不读取工具调用细节。', pasteConstraint: '可复制约束', constraintNoAgents: '不要启动不必要的 subagent 或独立审阅。', constraintLowerEffort: '对这个小改动，用代表性任务对比低一级推理强度。', constraintTests: '只运行一次聚焦测试，再运行一次完整测试。', constraintStop: '达到验收条件后停止，不要扩展为生产级加固。', compareTitle: '供应商对比', noRecentTask: '尚未索引到最近的 Codex 任务。', fiveHourWindow: '5 小时窗口', weeklyWindow: '每周窗口', used: '已用', remaining: '剩余', localLogNotLive: '本地日志 · 非实时', limitExpired: '已过期／最后观测', limitMissing: '没有本地观测到的用量限制', observedSessionDuration: '首个与末个观测事件之间的时间跨度代理值，并非实际活跃时长。',
      insightTitles: { 'multi-agent-share': '子线程的未缓存用量占比', 'effort-comparison': '对比低一级推理强度', 'post-patch-tool-intensity': '补丁后工具调用代理量', 'cache-context': '缓存与长上下文解读', 'approval-reviewer-share': '权限审批的未缓存用量占比' },
    },
    TASK5_CODEX_COPY['zh-CN'],
  ),
  ja: providerTranslations(
    { claude: 'Claude', codexBeta: 'Codex Beta', compare: '比較' },
    {
      ...TASK8_CODEX_COPY.ja,
      accountSnapshotLastObserved:
        'この Codex home の複数ログインの使用量を合算 · 上限は最終観測のみで、合算しません',
      title: 'Codex 使用量', beta: 'ベータ', overview: '概要', usageTrend: '使用量の推移', daily: '日別', date: '日付', role: '役割', scope: '範囲', threadLabel: 'スレッド', rootRole: 'ルート', childRole: 'サブエージェント', approvalReviewerRole: '承認レビュアー', unknownRole: '不明', noDailyData: '日別の Codex 使用量はまだ索引化されていません。', noThreadData: 'Codex スレッドはまだ索引化されていません。', lastTask: '最近のタスク', last7Days: '過去 7 日', last30Days: '過去 30 日', projects: 'プロジェクト', projectLabel: 'プロジェクト',
      unnamedSession: '名前のないセッション', unidentifiedProject: '未識別のプロジェクト', parentThread: '親スレッド', parentTask: '親タスク', searchThreads: 'セッションを検索', sessions: 'セッション', modelsEffort: 'モデルと推論強度', clearFilters: 'フィルターをクリア', activeFilters: '適用中のフィルター', all: 'すべて', localDirectory: 'ローカルフォルダー', lastActive: '最終アクティブ', expand: '展開', viewAllSessions: 'すべてのセッションを表示', sortBy: '並べ替え', usageLimits: '使用量上限', resets: 'リセット', credits: 'クレジット', unlimited: '無制限',
      allTime: '全期間', behavior: '行動', settings: '設定', monthly: '月別', tokenComposition: 'トークン構成', freshInput: '非キャッシュ入力', reasoningSubset: '出力に含まれます', threadRoleComposition: 'スレッド役割構成', childThreadsPerRootTask: 'ルートタスクあたりの子スレッド', childFreshShare: '子スレッドの非キャッシュ使用量比率', approvalFreshShare: '承認の非キャッシュ使用量比率', highEffortFreshShare: '高推論強度の非キャッシュ使用量比率', processedToFreshRatio: '処理済み / 非キャッシュ使用量', reasoningOutputShare: '出力に占める推論', postPatchToolCallsPerPatchCall: 'パッチ呼び出しあたりのパッチ後ツール呼び出しプロキシ', patchCalls: 'パッチ呼び出し', compactions: 'コンテキスト圧縮',
      processed: '処理済み', apiEquivalentCost: 'API 等価コスト', apiEquivalentCostHelp: '現在索引済みの Token を現行の公式 API 単価で見積もった値です。請求額やサブスクリプション料金ではありません。価格適用率: {coverage}。', fresh: '非キャッシュ使用量', input: '入力', cachedInput: 'キャッシュ入力', output: '出力', reasoning: '推論',
      model: 'モデル', models: 'モデル', efforts: '推論強度', threads: 'スレッド', rootTasks: 'ルートタスク', childThreads: '子スレッド', approvalReviewers: '承認レビュアー', duration: 'セッション期間', cacheShare: '入力キャッシュ比率',
      coverage: 'カバレッジ', quality: '品質', complete: '完了', partial: '一部', lastObserved: '最終観測', unavailable: '利用不可', optimization: 'ローカル最適化シグナル', structuralProxy: '構造的プロキシです。ツール呼び出しの詳細は読みません。', pasteConstraint: '貼り付け用制約', constraintNoAgents: '不要なサブエージェントや独立レビューを開始しないでください。', constraintLowerEffort: 'この小さな変更では代表タスクで 1 段低い推論強度を比較してください。', constraintTests: '変更に直結するテストを 1 回、その後に全テストを 1 回実行してください。', constraintStop: '受け入れ条件を満たしたら停止し、本番級の堅牢化へ拡張しないでください。', compareTitle: 'プロバイダー比較', noRecentTask: '最近の Codex タスクはまだ索引化されていません。', fiveHourWindow: '5 時間枠', weeklyWindow: '週間枠', used: '使用済み', remaining: '残り', localLogNotLive: 'ローカルログ · ライブではありません', limitExpired: '期限切れ／最終観測', limitMissing: 'ローカルで観測された使用量上限はありません', observedSessionDuration: '最初と最後に観測されたイベント間の経過時間を示すプロキシで、実際のアクティブ時間ではありません。',
      insightTitles: { 'multi-agent-share': '子スレッドの非キャッシュ使用量比率', 'effort-comparison': '1 段低い推論強度との比較', 'post-patch-tool-intensity': 'パッチ後ツール呼び出しプロキシ', 'cache-context': 'キャッシュと長いコンテキスト', 'approval-reviewer-share': '承認レビュアーの非キャッシュ使用量比率' },
    },
    TASK5_CODEX_COPY.ja,
  ),
  ko: providerTranslations(
    { claude: 'Claude', codexBeta: 'Codex Beta', compare: '비교' },
    {
      ...TASK8_CODEX_COPY.ko,
      accountSnapshotLastObserved:
        '이 Codex home의 여러 로그인 사용량을 합산 · 한도는 마지막 관측만 표시하며 합산하지 않음',
      title: 'Codex 사용량', beta: '베타', overview: '개요', usageTrend: '사용량 추이', daily: '일별', date: '날짜', role: '역할', scope: '범위', threadLabel: '스레드', rootRole: '루트', childRole: '하위 에이전트', approvalReviewerRole: '승인 검토자', unknownRole: '알 수 없음', noDailyData: '아직 일별 Codex 사용량이 인덱싱되지 않았습니다.', noThreadData: '아직 Codex 스레드가 인덱싱되지 않았습니다.', lastTask: '최근 작업', last7Days: '최근 7일', last30Days: '최근 30일', projects: '프로젝트', projectLabel: '프로젝트',
      unnamedSession: '이름 없는 세션', unidentifiedProject: '식별되지 않은 프로젝트', parentThread: '상위 스레드', parentTask: '상위 작업', searchThreads: '세션 검색', sessions: '세션', modelsEffort: '모델 및 추론 강도', clearFilters: '필터 지우기', activeFilters: '활성 필터', all: '전체', localDirectory: '로컬 폴더', lastActive: '마지막 활동', expand: '펼치기', viewAllSessions: '모든 세션 보기', sortBy: '정렬 기준', usageLimits: '사용량 한도', resets: '재설정', credits: '크레딧', unlimited: '무제한',
      allTime: '전체 기간', behavior: '행동', settings: '설정', monthly: '월별', tokenComposition: '토큰 구성', freshInput: '캐시되지 않은 입력', reasoningSubset: '출력에 포함됨', threadRoleComposition: '스레드 역할 구성', childThreadsPerRootTask: '루트 작업당 하위 스레드', childFreshShare: '하위 스레드 캐시되지 않은 사용량 비율', approvalFreshShare: '승인 캐시되지 않은 사용량 비율', highEffortFreshShare: '고강도 캐시되지 않은 사용량 비율', processedToFreshRatio: '처리됨 / 캐시되지 않은 사용량', reasoningOutputShare: '출력 중 추론 비율', postPatchToolCallsPerPatchCall: '패치 호출당 패치 후 도구 호출 프록시', patchCalls: '패치 호출', compactions: '컨텍스트 압축',
      processed: '처리됨', apiEquivalentCost: 'API 등가 비용', apiEquivalentCostHelp: '현재 인덱싱된 Token에 현행 공식 API 단가를 적용한 추정치입니다. 청구액이나 구독 결제액이 아닙니다. 가격 적용률: {coverage}.', fresh: '캐시되지 않은 사용량', input: '입력', cachedInput: '캐시 입력', output: '출력', reasoning: '추론',
      model: '모델', models: '모델', efforts: '추론 강도', threads: '스레드', rootTasks: '루트 작업', childThreads: '하위 스레드', approvalReviewers: '승인 검토자', duration: '세션 범위', cacheShare: '입력 캐시 비율',
      coverage: '커버리지', quality: '품질', complete: '완료', partial: '부분', lastObserved: '마지막 관측', unavailable: '사용 불가', optimization: '로컬 최적화 신호', structuralProxy: '구조적 프록시이며 도구 호출 세부 정보는 읽지 않습니다.', pasteConstraint: '붙여넣기용 제약', constraintNoAgents: '불필요한 하위 에이전트나 독립 검토를 시작하지 마세요.', constraintLowerEffort: '이 작은 변경은 대표 작업에서 한 단계 낮은 추론 강도를 비교하세요.', constraintTests: '변경에 맞춘 테스트 한 번과 전체 테스트 한 번만 실행하세요.', constraintStop: '수용 기준을 통과하면 중단하고 운영급 강화로 확장하지 마세요.', compareTitle: '공급자 비교', noRecentTask: '최근 Codex 작업이 아직 인덱싱되지 않았습니다.', fiveHourWindow: '5시간 창', weeklyWindow: '주간 창', used: '사용됨', remaining: '남음', localLogNotLive: '로컬 로그 · 실시간 아님', limitExpired: '만료됨 / 마지막 관측', limitMissing: '로컬에서 관측된 사용량 한도가 없습니다', observedSessionDuration: '처음과 마지막으로 관측된 이벤트 사이의 시간 범위를 나타내는 프록시이며 실제 활성 시간이 아닙니다.',
      insightTitles: { 'multi-agent-share': '하위 스레드 캐시되지 않은 사용량 비율', 'effort-comparison': '한 단계 낮은 추론 강도 비교', 'post-patch-tool-intensity': '패치 후 도구 호출 프록시', 'cache-context': '캐시 및 긴 컨텍스트', 'approval-reviewer-share': '승인 검토자 캐시되지 않은 사용량 비율' },
    },
    TASK5_CODEX_COPY.ko,
  ),
  'pt-BR': providerTranslations(
    { claude: 'Claude', codexBeta: 'Codex Beta', compare: 'Comparar' },
    {
      ...TASK8_CODEX_COPY['pt-BR'],
      accountSnapshotLastObserved:
        'O uso combina logins neste Codex home · limites são a última observação, não somados',
      title: 'Uso do Codex', beta: 'Beta', overview: 'Visão geral', usageTrend: 'Tendência de uso', daily: 'Diário', date: 'Data', role: 'Função', scope: 'Escopo', threadLabel: 'Thread', rootRole: 'Raiz', childRole: 'Subagente', approvalReviewerRole: 'Revisor de aprovação', unknownRole: 'Desconhecido', noDailyData: 'Nenhum uso diário do Codex foi indexado.', noThreadData: 'Nenhuma thread do Codex foi indexada.', lastTask: 'Tarefa recente', last7Days: 'Últimos 7 dias', last30Days: 'Últimos 30 dias', projects: 'Projetos', projectLabel: 'Projeto',
      unnamedSession: 'Sessão sem nome', unidentifiedProject: 'Projeto não identificado', parentThread: 'Thread pai', parentTask: 'Tarefa pai', searchThreads: 'Pesquisar sessões', sessions: 'Sessões', modelsEffort: 'Modelos e esforço', clearFilters: 'Limpar filtros', activeFilters: 'Filtros ativos', all: 'Tudo', localDirectory: 'Pasta local', lastActive: 'Última atividade', expand: 'Expandir', viewAllSessions: 'Ver todas as sessões', sortBy: 'Ordenar por', usageLimits: 'Limites de uso', resets: 'Redefinição', credits: 'Créditos', unlimited: 'Ilimitado',
      allTime: 'Todo o período', behavior: 'Comportamento', settings: 'Configurações', monthly: 'Mensal', tokenComposition: 'Composição de tokens', freshInput: 'Entrada sem cache', reasoningSubset: 'Incluído na saída', threadRoleComposition: 'Composição por função da thread', childThreadsPerRootTask: 'Threads filhas / tarefa raiz', childFreshShare: 'Participação do uso sem cache das threads filhas', approvalFreshShare: 'Participação do uso sem cache de aprovação', highEffortFreshShare: 'Participação do uso sem cache de alto esforço', processedToFreshRatio: 'Processado / uso sem cache', reasoningOutputShare: 'Participação do raciocínio na saída', postPatchToolCallsPerPatchCall: 'Proxy de chamadas de ferramenta pós-patch / chamada de patch', patchCalls: 'Chamadas de patch', compactions: 'Compactações',
      processed: 'Processado', apiEquivalentCost: 'Custo equivalente de API', apiEquivalentCostHelp: 'Estimado a partir dos Tokens indexados no momento com os preços oficiais atuais da API; não é uma fatura nem uma cobrança de assinatura. Cobertura de preços: {coverage}.', fresh: 'Uso sem cache', input: 'Entrada', cachedInput: 'Entrada em cache', output: 'Saída', reasoning: 'Raciocínio',
      model: 'Modelo', models: 'Modelos', efforts: 'Esforço', threads: 'Threads', rootTasks: 'Tarefas raiz', childThreads: 'Threads filhas', approvalReviewers: 'Revisores de aprovação', duration: 'Intervalo', cacheShare: 'Proporção de cache de entrada',
      coverage: 'Cobertura', quality: 'Qualidade', complete: 'Completa', partial: 'Parcial', lastObserved: 'Última observação', unavailable: 'Indisponível', optimization: 'Sinais locais de otimização', structuralProxy: 'Proxy estrutural; detalhes das chamadas de ferramenta não são lidos.', pasteConstraint: 'Restrição pronta para colar', constraintNoAgents: 'Não inicie subagentes ou revisões independentes desnecessárias.', constraintLowerEffort: 'Nesta mudança pequena, compare um nível de esforço menor em uma tarefa representativa.', constraintTests: 'Execute um teste focado e depois uma única execução completa.', constraintStop: 'Pare ao cumprir os critérios; não expanda para endurecimento de produção.', compareTitle: 'Comparação de provedores', noRecentTask: 'Nenhuma tarefa recente do Codex foi indexada.', fiveHourWindow: 'Janela de 5 horas', weeklyWindow: 'Janela semanal', used: 'usado', remaining: 'restante', localLogNotLive: 'Registro local · não é ao vivo', limitExpired: 'Expirado / última observação', limitMissing: 'Nenhum limite de uso observado localmente', observedSessionDuration: 'Intervalo entre o primeiro e o último evento observado; é um proxy, não o tempo de atividade real.',
      insightTitles: { 'multi-agent-share': 'Participação do uso sem cache das threads filhas', 'effort-comparison': 'Compare um nível de esforço menor', 'post-patch-tool-intensity': 'Proxy de chamadas de ferramenta pós-patch', 'cache-context': 'Cache e contexto longo', 'approval-reviewer-share': 'Participação do uso sem cache do revisor de aprovação' },
    },
    TASK5_CODEX_COPY['pt-BR'],
  ),
  id: providerTranslations(
    { claude: 'Claude', codexBeta: 'Codex Beta', compare: 'Bandingkan' },
    {
      ...TASK8_CODEX_COPY.id,
      accountSnapshotLastObserved:
        'Penggunaan menggabungkan login di Codex home ini · batas adalah pengamatan terakhir, tidak dijumlahkan',
      title: 'Penggunaan Codex', beta: 'Beta', overview: 'Ringkasan', usageTrend: 'Tren penggunaan', daily: 'Harian', date: 'Tanggal', role: 'Peran', scope: 'Cakupan', threadLabel: 'Thread', rootRole: 'Utama', childRole: 'Subagen', approvalReviewerRole: 'Peninjau persetujuan', unknownRole: 'Tidak diketahui', noDailyData: 'Belum ada penggunaan harian Codex yang diindeks.', noThreadData: 'Belum ada thread Codex yang diindeks.', lastTask: 'Tugas terbaru', last7Days: '7 hari terakhir', last30Days: '30 hari terakhir', projects: 'Proyek', projectLabel: 'Proyek',
      unnamedSession: 'Sesi tanpa nama', unidentifiedProject: 'Proyek tidak teridentifikasi', parentThread: 'Thread induk', parentTask: 'Tugas induk', searchThreads: 'Cari sesi', sessions: 'Sesi', modelsEffort: 'Model & upaya', clearFilters: 'Hapus filter', activeFilters: 'Filter aktif', all: 'Semua', localDirectory: 'Folder lokal', lastActive: 'Terakhir aktif', expand: 'Perluas', viewAllSessions: 'Lihat semua sesi', sortBy: 'Urutkan berdasarkan', usageLimits: 'Batas penggunaan', resets: 'Reset', credits: 'Kredit', unlimited: 'Tanpa batas',
      allTime: 'Sepanjang waktu', behavior: 'Perilaku', settings: 'Pengaturan', monthly: 'Bulanan', tokenComposition: 'Komposisi token', freshInput: 'Input tanpa cache', reasoningSubset: 'Termasuk dalam output', threadRoleComposition: 'Komposisi peran thread', childThreadsPerRootTask: 'Thread anak / tugas utama', childFreshShare: 'Porsi penggunaan tanpa cache thread anak', approvalFreshShare: 'Porsi penggunaan tanpa cache persetujuan', highEffortFreshShare: 'Porsi penggunaan tanpa cache effort tinggi', processedToFreshRatio: 'Diproses / penggunaan tanpa cache', reasoningOutputShare: 'Porsi penalaran dalam output', postPatchToolCallsPerPatchCall: 'Proksi panggilan alat pasca-patch / panggilan patch', patchCalls: 'Panggilan patch', compactions: 'Pemadatan konteks',
      processed: 'Diproses', apiEquivalentCost: 'Biaya ekuivalen API', apiEquivalentCostHelp: 'Perkiraan dari Token yang saat ini terindeks dengan harga API resmi terkini; bukan tagihan atau biaya langganan. Cakupan harga: {coverage}.', fresh: 'Penggunaan tanpa cache', input: 'Input', cachedInput: 'Input cache', output: 'Output', reasoning: 'Penalaran',
      model: 'Model', models: 'Model', efforts: 'Upaya', threads: 'Thread', rootTasks: 'Tugas utama', childThreads: 'Thread anak', approvalReviewers: 'Peninjau persetujuan', duration: 'Rentang sesi', cacheShare: 'Porsi cache input',
      coverage: 'Cakupan', quality: 'Kualitas', complete: 'Lengkap', partial: 'Sebagian', lastObserved: 'Terakhir diamati', unavailable: 'Tidak tersedia', optimization: 'Sinyal optimasi lokal', structuralProxy: 'Proksi struktural; detail panggilan alat tidak dibaca.', pasteConstraint: 'Batasan siap tempel', constraintNoAgents: 'Jangan mulai subagen atau tinjauan independen yang tidak perlu.', constraintLowerEffort: 'Untuk perubahan kecil ini, bandingkan satu tingkat upaya lebih rendah pada tugas perwakilan.', constraintTests: 'Jalankan satu tes terfokus lalu satu kali tes lengkap.', constraintStop: 'Berhenti saat kriteria terpenuhi; jangan perluas menjadi pengerasan tingkat produksi.', compareTitle: 'Perbandingan penyedia', noRecentTask: 'Belum ada tugas Codex terbaru yang diindeks.', fiveHourWindow: 'Jendela 5 jam', weeklyWindow: 'Jendela mingguan', used: 'terpakai', remaining: 'tersisa', localLogNotLive: 'Log lokal · bukan langsung', limitExpired: 'Kedaluwarsa / terakhir diamati', limitMissing: 'Tidak ada batas penggunaan yang diamati secara lokal', observedSessionDuration: 'Rentang antara peristiwa pertama dan terakhir yang diamati; ini proksi, bukan waktu aktif sebenarnya.',
      insightTitles: { 'multi-agent-share': 'Porsi penggunaan tanpa cache thread anak', 'effort-comparison': 'Bandingkan satu tingkat upaya lebih rendah', 'post-patch-tool-intensity': 'Proksi panggilan alat pasca-patch', 'cache-context': 'Cache dan konteks panjang', 'approval-reviewer-share': 'Porsi penggunaan tanpa cache peninjau persetujuan' },
    },
    TASK5_CODEX_COPY.id,
  ),
};

const WEEKLY_VALUE_COPY: Record<SupportedLanguage, WeeklyValueCopy> = {
  en: {
    title: 'Weekly subscription allowance · API-equivalent estimate',
    description: 'A durability estimate for the subscription: current official API prices applied to local tokens, with total and unused value inferred from observed quota utilization. Request-level surcharges absent from aggregate logs are excluded. It is not an official balance, bill, or cash value.',
    period: 'Period', periodDetails: 'Period details', currentPeriod: 'Current period', currentPeriodShort: 'Current', resetsAt: 'resets',
    usedValue: 'Used equivalent', fullValue: 'Full allowance est.', unusedValue: 'Unused est.',
    reset: 'Week / reset', utilization: 'End observed', confidence: 'Confidence', pricingCoverage: 'Priced coverage',
    current: 'In progress', high: 'High', medium: 'Medium', low: 'Low', usageOnly: 'Usage only',
    noData: 'No locally recorded weekly usage is available yet.',
    historyFromLogs: 'Historical used equivalents come directly from local token logs. Full and unused estimates appear only for windows with a real quota-utilization observation.',
    calendarFallback: 'No historical weekly reset was observed; usage-only history is grouped into Monday-to-Monday UTC calendar weeks.',
    multiAccount: 'Codex local history may span multiple sign-ins. The current window uses the latest real quota observation for a low-confidence blended durability estimate even when local series overlap; ambiguous completed windows remain usage-only. No account split or official balance is invented.',
    boundaryApproximation: 'Codex usage is aggregated by day. A reset inside a recorded day lowers confidence, but current and completed windows may still show total and unused approximations.',
    boundaryApproximate: 'Boundary approx.',
    indexedSubtotal: 'Indexing is incomplete; weekly values are conservative subtotals.',
  },
  'zh-CN': {
    title: '每周订阅额度 · API 等效估算',
    description: '用于粗略理解订阅套餐耐用度：按当前官方 API 单价折算本地 Token，并由真实额度观测反推总额和未用值。聚合日志无法确认的请求级附加价格不计入。它不是官方余额、账单或现金价值。',
    period: '周期', periodDetails: '周期详情', currentPeriod: '当前周期', currentPeriodShort: '当前', resetsAt: '重置于',
    usedValue: '已用等价值', fullValue: '总额度估算', unusedValue: '未用估算',
    reset: '周期 / 重置', utilization: '末次观测', confidence: '可信度', pricingCoverage: '已定价覆盖',
    current: '进行中', high: '高', medium: '中', low: '低', usageOnly: '仅已用值',
    noData: '尚无可用于按周计算的本地用量记录。',
    historyFromLogs: '历史“已用等价值”直接由本地 Token 日志计算；只有某个窗口存在真实额度用量观测时，才显示总额度和未用额度估算。',
    calendarFallback: '未观测到可用于对齐历史的每周重置时间；仅已用历史按 UTC 周一至周一的自然周分组。',
    multiAccount: 'Codex 本地历史可能跨多个登录。即使本地额度系列重叠，当前周期仍会采用最后一次真实额度观测给出低可信度的混合耐用度估算；归属不清的已结束周期仍只显示已用值。不虚构账号拆分或官方余额。',
    boundaryApproximation: 'Codex 用量按日汇总。若官方重置发生在某个记录日内，可信度会降低，但当前和已结束周期仍可显示总额与未用近似值。',
    boundaryApproximate: '边界近似',
    indexedSubtotal: '索引尚未完成；每周价值目前是保守小计。',
  },
  'zh-TW': {
    title: '每週訂閱額度 · API 等效估算',
    description: '用於粗略理解訂閱方案耐用度：依目前官方 API 單價折算本機 Token，並由真實額度觀測反推總額與未用值。彙總日誌無法確認的請求級附加價格不計入。它不是官方餘額、帳單或現金價值。',
    period: '週期', periodDetails: '週期詳情', currentPeriod: '目前週期', currentPeriodShort: '目前', resetsAt: '重設於',
    usedValue: '已用等價值', fullValue: '總額度估算', unusedValue: '未用估算',
    reset: '週期 / 重設', utilization: '末次觀測', confidence: '可信度', pricingCoverage: '已定價涵蓋',
    current: '進行中', high: '高', medium: '中', low: '低', usageOnly: '僅已用值',
    noData: '尚無可用於每週計算的本機用量記錄。',
    historyFromLogs: '歷史「已用等價值」直接由本機 Token 日誌計算；只有視窗存在真實額度用量觀測時，才顯示總額度與未用額度估算。',
    calendarFallback: '未觀測到可用於對齊歷史的每週重設時間；僅已用歷史依 UTC 週一至週一的自然週分組。',
    multiAccount: 'Codex 本機歷史可能跨多個登入。即使本機額度系列重疊，目前週期仍會採用最後一次真實額度觀測提供低可信度的混合耐用度估算；歸屬不清的已結束週期仍只顯示已用值。不虛構帳號拆分或官方餘額。',
    boundaryApproximation: 'Codex 用量按日彙總。若官方重設發生於某個記錄日內，可信度會降低，但目前與已結束週期仍可顯示總額與未用近似值。',
    boundaryApproximate: '邊界近似',
    indexedSubtotal: '索引尚未完成；每週價值目前是保守小計。',
  },
  ja: {
    title: '週間サブスクリプション枠 · API 等価推定',
    description: 'サブスクリプションの耐用度を把握するため、現在の公式 API 単価をローカル Token に適用し、観測された枠の利用率から総量と未使用量を推定します。集計ログで確認できないリクエスト単位の追加料金は含みません。公式残高、請求額、現金価値ではありません。',
    period: '期間', periodDetails: '期間の詳細', currentPeriod: '現在の期間', currentPeriodShort: '現在', resetsAt: 'リセット',
    usedValue: '使用済み等価値', fullValue: '総上限の推定', unusedValue: '未使用の推定',
    reset: '期間 / リセット', utilization: '最終観測', confidence: '信頼度', pricingCoverage: '価格適用率',
    current: '進行中', high: '高', medium: '中', low: '低', usageOnly: '使用分のみ',
    noData: '週単位で計算できるローカル使用記録がまだありません。',
    historyFromLogs: '過去の使用済み等価値はローカルの Token ログから直接計算します。総上限と未使用分は、実際の上限利用率が観測された枠だけで推定します。',
    calendarFallback: '履歴を揃える週間リセットが観測されていないため、使用分のみの履歴は UTC の月曜から月曜の暦週で集計します。',
    multiAccount: 'Codex のローカル履歴には複数のログインが含まれる場合があります。ローカルの系列が重複していても、現在の期間は最新の実測クォータを使った低信頼度の混合耐久性推定を表示します。帰属が曖昧な完了期間は使用分のみです。アカウント分割や公式残高は推測しません。',
    boundaryApproximation: 'Codex の使用量は日単位で集計されます。記録日の途中にリセットがあると信頼度は下がりますが、現在と完了済みの枠に総量と未使用量の近似を表示できます。',
    boundaryApproximate: '境界近似',
    indexedSubtotal: '索引作成中のため、週間価値は保守的な小計です。',
  },
  ko: {
    title: '주간 구독 한도 · API 등가 추정',
    description: '구독이 얼마나 오래 지속되는지 가늠하기 위해 현재 공식 API 단가를 로컬 Token에 적용하고, 관측된 한도 사용률에서 총량과 미사용량을 추정합니다. 집계 로그에서 확인할 수 없는 요청 단위 추가 요금은 제외합니다. 공식 잔액, 청구액 또는 현금 가치가 아닙니다.',
    period: '기간', periodDetails: '기간 세부 정보', currentPeriod: '현재 기간', currentPeriodShort: '현재', resetsAt: '재설정',
    usedValue: '사용 등가치', fullValue: '총한도 추정', unusedValue: '미사용 추정',
    reset: '주 / 재설정', utilization: '마지막 관측', confidence: '신뢰도', pricingCoverage: '가격 적용률',
    current: '진행 중', high: '높음', medium: '보통', low: '낮음', usageOnly: '사용분만',
    noData: '주간 계산에 사용할 로컬 사용 기록이 아직 없습니다.',
    historyFromLogs: '과거 사용 등가치는 로컬 Token 로그에서 직접 계산합니다. 실제 한도 사용률 관측이 있는 창에서만 총한도와 미사용분을 추정합니다.',
    calendarFallback: '과거를 정렬할 주간 재설정이 관측되지 않아 사용분 전용 기록은 UTC 월요일부터 월요일까지의 달력 주로 묶습니다.',
    multiAccount: 'Codex 로컬 기록에는 여러 로그인이 포함될 수 있습니다. 로컬 할당량 계열이 겹쳐도 현재 기간은 마지막 실제 할당량 관측으로 신뢰도 낮은 혼합 내구성 추정을 표시합니다. 귀속이 불명확한 완료 기간은 사용분만 표시합니다. 계정 분리나 공식 잔액은 추정하지 않습니다.',
    boundaryApproximation: 'Codex 사용량은 일별로 집계됩니다. 기록일 중간에 재설정이 있으면 신뢰도가 낮아지지만 현재 및 완료 창에도 총량과 미사용 근사를 표시할 수 있습니다.',
    boundaryApproximate: '경계 근사',
    indexedSubtotal: '인덱싱이 끝나지 않아 주간 가치는 보수적인 소계입니다.',
  },
  'pt-BR': {
    title: 'Cota semanal da assinatura · estimativa equivalente à API',
    description: 'Estima a durabilidade da assinatura aplicando os preços oficiais atuais da API aos Tokens locais e inferindo o total e o saldo não usado a partir da utilização de cota observada. Sobretaxas por solicitação ausentes dos logs agregados são excluídas. Não é saldo oficial, fatura nem valor em dinheiro.',
    period: 'Período', periodDetails: 'Detalhes do período', currentPeriod: 'Período atual', currentPeriodShort: 'Atual', resetsAt: 'reinicia em',
    usedValue: 'Equivalente usado', fullValue: 'Limite total est.', unusedValue: 'Não usado est.',
    reset: 'Semana / reset', utilization: 'Última observação', confidence: 'Confiança', pricingCoverage: 'Cobertura de preços',
    current: 'Em andamento', high: 'Alta', medium: 'Média', low: 'Baixa', usageOnly: 'Somente uso',
    noData: 'Ainda não há uso local registrado para o cálculo semanal.',
    historyFromLogs: 'Os equivalentes usados no histórico vêm diretamente dos logs locais de Token. O limite total e o não usado só são estimados quando há uma observação real da utilização da cota.',
    calendarFallback: 'Nenhuma redefinição semanal histórica foi observada; o histórico somente de uso é agrupado em semanas UTC de segunda a segunda.',
    multiAccount: 'O histórico local do Codex pode abranger vários logins. Mesmo com séries locais sobrepostas, o período atual usa a observação real mais recente para uma estimativa combinada de baixa confiança; períodos concluídos com atribuição ambígua mostram apenas o uso. Nenhuma divisão de conta ou saldo oficial é inventado.',
    boundaryApproximation: 'O uso do Codex é agregado por dia. Uma redefinição dentro de um dia registrado reduz a confiança, mas janelas atuais e concluídas ainda podem mostrar aproximações do total e do restante.',
    boundaryApproximate: 'Fronteira aprox.',
    indexedSubtotal: 'A indexação está incompleta; os valores semanais são subtotais conservadores.',
  },
  'de-DE': {
    title: 'Wöchentliches Abo-Kontingent · API-Äquivalenzschätzung',
    description: 'Schätzt die Reichweite des Abonnements, indem aktuelle offizielle API-Preise auf lokale Token angewandt und Gesamt- sowie Restwert aus beobachteter Kontingentnutzung abgeleitet werden. Anfragebezogene Aufpreise, die in aggregierten Logs fehlen, sind ausgeschlossen. Dies ist weder offizielles Guthaben noch Rechnung oder Barwert.',
    period: 'Zeitraum', periodDetails: 'Zeitraumdetails', currentPeriod: 'Aktueller Zeitraum', currentPeriodShort: 'Aktuell', resetsAt: 'Reset',
    usedValue: 'Genutzter Gegenwert', fullValue: 'Gesamtlimit geschätzt', unusedValue: 'Ungenutzt geschätzt',
    reset: 'Woche / Reset', utilization: 'Letzte Beobachtung', confidence: 'Vertrauen', pricingCoverage: 'Preisabdeckung',
    current: 'Laufend', high: 'Hoch', medium: 'Mittel', low: 'Niedrig', usageOnly: 'Nur Nutzung',
    noData: 'Noch keine lokal erfasste Nutzung für die Wochenberechnung verfügbar.',
    historyFromLogs: 'Historische genutzte Gegenwerte stammen direkt aus lokalen Token-Logs. Gesamtlimit und ungenutzter Anteil werden nur bei real beobachteter Quotenauslastung geschätzt.',
    calendarFallback: 'Kein historischer Wochen-Reset wurde beobachtet; reine Nutzungsverläufe werden in UTC-Kalenderwochen von Montag bis Montag gruppiert.',
    multiAccount: 'Der lokale Codex-Verlauf kann mehrere Anmeldungen umfassen. Auch bei überlappenden lokalen Serien nutzt der aktuelle Zeitraum die jüngste reale Kontingentbeobachtung für eine zusammengeführte Schätzung mit niedriger Zuverlässigkeit; mehrdeutige abgeschlossene Zeiträume zeigen nur die Nutzung. Weder Kontotrennung noch offizielles Guthaben werden erfunden.',
    boundaryApproximation: 'Die Codex-Nutzung wird tageweise aggregiert. Ein Reset innerhalb eines erfassten Tages senkt die Zuverlässigkeit, dennoch können aktuelle und abgeschlossene Fenster Näherungen für Gesamt- und Restwert zeigen.',
    boundaryApproximate: 'Grenznäherung',
    indexedSubtotal: 'Die Indizierung ist unvollständig; Wochenwerte sind konservative Zwischensummen.',
  },
  id: {
    title: 'Batas langganan mingguan · estimasi ekuivalen API',
    description: 'Memperkirakan daya tahan langganan dengan menerapkan harga API resmi terkini pada Token lokal, lalu menyimpulkan total dan sisa dari pemakaian kuota yang teramati. Biaya tambahan per permintaan yang tidak ada dalam log agregat dikecualikan. Ini bukan saldo resmi, tagihan, atau nilai tunai.',
    period: 'Periode', periodDetails: 'Detail periode', currentPeriod: 'Periode saat ini', currentPeriodShort: 'Saat ini', resetsAt: 'reset',
    usedValue: 'Ekuivalen terpakai', fullValue: 'Total batas estimasi', unusedValue: 'Tak terpakai estimasi',
    reset: 'Minggu / reset', utilization: 'Pengamatan akhir', confidence: 'Keyakinan', pricingCoverage: 'Cakupan harga',
    current: 'Berjalan', high: 'Tinggi', medium: 'Sedang', low: 'Rendah', usageOnly: 'Hanya pemakaian',
    noData: 'Belum ada penggunaan lokal yang tercatat untuk perhitungan mingguan.',
    historyFromLogs: 'Ekuivalen terpakai historis dihitung langsung dari log Token lokal. Total batas dan sisa hanya diestimasi jika ada pengamatan nyata atas persentase kuota.',
    calendarFallback: 'Tidak ada reset mingguan historis yang teramati; riwayat khusus pemakaian dikelompokkan dalam minggu UTC Senin-ke-Senin.',
    multiAccount: 'Riwayat lokal Codex dapat mencakup beberapa login. Meski seri lokal tumpang tindih, periode saat ini memakai pengamatan kuota nyata terbaru untuk perkiraan daya tahan gabungan berkeyakinan rendah; periode selesai yang ambigu tetap hanya menampilkan pemakaian. Pemisahan akun atau saldo resmi tidak direka.',
    boundaryApproximation: 'Penggunaan Codex diagregasi per hari. Reset di tengah hari tercatat menurunkan keyakinan, tetapi jendela saat ini dan selesai tetap dapat menampilkan perkiraan total dan sisa.',
    boundaryApproximate: 'Perkiraan batas',
    indexedSubtotal: 'Pengindeksan belum selesai; nilai mingguan masih berupa subtotal konservatif.',
  },
};

const translations: Record<SupportedLanguage, Translations> = {
  en: {
    statusBar: {
      loading: 'Loading...',
      noData: 'No Claude Code Data',
      notRunning: 'Claude Code Not Running',
      error: 'Error',
      refreshFailed: 'Usage refresh failed. Retry or check diagnostic logs.',
      currentSession: 'Session',
    },
    releaseAnnouncement: {
      v230: "What's new — Codex Beta usage and local optimization guidance, exact-version release notes, and removal of the obsolete model-specific weekly Opus option.",
      v231: 'Accurate 30-day Codex totals, reset-aware weekly allowance estimates, and a private combined activity heatmap with local SVG and Markdown sharing.',
      v232: 'New in 2.3.2: a 30/90-day project activity matrix for Claude and Codex, complete chart drill-downs, state-preserving refresh, and a compact fixed-rate currency selector.',
    },
    providers: PROVIDERS.en,
    weeklyValue: WEEKLY_VALUE_COPY.en,
    popup: {
      title: 'Claude Code Usage',
      currentSession: 'Current Session',
      today: 'Today',
      thisMonth: 'This Month',
      allTime: 'All Time',
      workspaceToday: 'This project',
      refresh: 'Refresh',
      autoRefresh: 'Auto refresh',
      settings: 'Settings',
      settingsTab: 'Settings',
      settingsIntro:
        'Settings live here now. Language and data directories remain in VS Code Settings; API keys use VS Code SecretStorage and never sync. Changes apply immediately.',
      secretMigrationFailed:
        'The saved advice API key could not be moved into SecretStorage. Usage remains available and the old key was not deleted, but AI advice is unconfigured. Fix the legacy setting and reload the window.',
      secretMigrationWorkspace:
        'A workspace-specific advice API key cannot be migrated safely into one global SecretStorage entry. Usage remains available, but AI advice is unconfigured. Copy the key, remove it from workspace settings, reload, then enter it under Dashboard Settings → Advice.',
      settingsResetAll: 'Reset all to defaults',
      settingsGroupGeneral: 'General',
      settingsGroupProviders: 'Providers',
      settingsGroupFeatures: 'Optional features',
      settingsGroupStatusBar: 'Status bar',
      quotaFormatBuiltIn: 'Built-in',
      quotaFormatFiveHour: '5-hour only',
      quotaFormatWeekly: 'Weekly only',
      quotaFormatCustom: 'Custom…',
      quotaFormatShortHelp: 'Choose a compact layout. Built-in keeps the quota options above.',
      settingsGroupData: 'Data & refresh',
      settingsGroupAdvice: 'AI advice & Optimizer',
      adviceEffectiveness: {
        title: 'AI advice effectiveness',
        description: 'Review how each suggestion moves from a local observation to evidence, an action, and a guarded result.',
        candidateNotice: 'v2.3.1 candidate · off by default · no default or background AI requests.',
        spineLabel: 'Advice evidence path',
        observation: 'Observation',
        evidence: 'Evidence',
        recommendation: 'Advice',
        action: 'Action',
        result: 'Result',
        source: 'Source',
        limitations: 'Limitations',
        proxyMetric: 'Proxy metric',
        longSessionSignal: '{share} of observed usage came from long sessions.',
        largeContextSignal: '{share} of observed usage occurred at large context sizes.',
        frameworkOverheadSignal: '{share} of observed usage is separately estimated framework injection; it does not evaluate the quality of the user\'s writing.',
        clearBoundaryRecommendation: 'Use clearer task boundaries for long or large-context work.',
        clearBoundaryAction: 'Start a fresh session when the task changes; compact only when continuing the same task.',
        codexLocalRecommendation: 'Review the local Codex structural signal before the next comparable task.',
        noEvidenceAdvice: 'No evidence-backed advice is available for this scope.',
        codexPreviewUnavailable: 'A privacy-safe Codex aggregate payload preview is not available yet.',
        elapsedTimeProxy: 'Elapsed session span is a proxy, not measured active work time.',
        qualityGuardrailPending: 'Quality evidence is pending, so no effectiveness conclusion is available.',
        payloadTitle: 'Sealed payload snapshot',
        payloadDescription: 'This sealed snapshot is the exact UTF-8 JSON body the configured BYOK endpoint receives only after the separate Send click.',
        aggregatesOnly: 'Aggregates only',
        aggregatesWithPersonalization: 'Aggregates + explicitly allowed personal context',
        aggregatesWithPromptSamples: 'Aggregates + explicitly allowed prompt samples',
        payloadBytes: '{bytes} UTF-8 bytes',
        promptSamplesIncluded: '{count} prompt samples included',
        previewPayload: 'Preview sealed snapshot',
        noNetworkTransport: 'Previewing sends nothing. Sending requires a separate click.',
        sendPreparedRequest: 'Send this exact request',
        sendingPreparedRequest: 'Sending…',
        sentPreparedRequest: 'Structured advice received.',
        aggregateConsentLabel: 'Allow aggregate usage data',
        aggregateConsentHelp: 'Includes only allowlisted numeric aggregates and structural signals — no prompts, paths, session IDs, or individual records.',
        promptConsentLabel: 'Also include prompt samples and configured personal context',
        promptConsentHelp: 'Optional and off by default. Bounded prompt text and configured personal context are added only after this separate explicit consent.',
        promptWindowHelp: 'Prompt samples older than the configured {days}-day evidence window are excluded.',
        feedbackTitle: 'Local feedback',
        helpful: 'Helpful',
        notHelpful: 'Not helpful',
        applied: 'Applied',
        snooze: 'Snooze 7 days',
        resume: 'Show again',
        snoozedUntil: 'Snoozed until {date}',
        feedbackLocalOnly: 'Stored only on this device and never added to a remote payload.',
        feedbackSaveFailed: 'Feedback could not be saved locally. Nothing was sent.',
        comparisonTitle: 'Comparable task results',
        comparablePairs: '{count} comparable task pairs',
        minimumComparablePairs: 'At least {minimum} comparable task pairs are required before drawing a conclusion.',
        insufficientEvidence: 'Not enough evidence to draw a conclusion.',
        qualityGuardrailFailed: 'The quality guardrail did not hold, so no effectiveness claim is made.',
        improved: 'Improvement met the pre-declared threshold while the quality guardrail held.',
        noDemonstratedImprovement: 'No improvement was demonstrated; this does not establish harm or causation.',
        clearLocalData: 'Clear local advice data',
        clearLocalDataConfirm: 'Clear advice consent, feedback, comparable pairs, and comparison results stored on this device?',
        strictOutputRejected: 'The structured model output was rejected. No advice was created.',
      },
      totalTokens: 'Total Tokens',
      inputTokens: 'Input Tokens',
      outputTokens: 'Output Tokens',
      cacheCreation: 'Input Cache (Miss)',
      cacheRead: 'Input Cache (Hit)',
      cost: 'Cost',
      messages: 'Messages',
      modelBreakdown: 'Model Usage',
      dailyBreakdown: 'Daily Usage',
      monthlyBreakdown: 'Monthly Usage',
      hourlyBreakdown: 'Hourly Usage',
      sessions: 'Sessions',
      sessionBreakdown: 'Session Usage',
      project: 'Project',
      startTime: 'Start Time',
      duration: 'Duration',
      activeDuration: 'Active',
      activeDurationHelp: 'Estimated hands-on time — the gaps between turns summed, with each idle gap capped at 1.5 h so long breaks don\'t inflate it, while reading / reviewing time still counts. (Duration is the full first-to-last span.)',
      hour: 'Hour',
      projects: 'Projects',
      projectBreakdown: 'Project Usage',
      fullPath: 'Full Path',
      peakContext: 'Peak Context',
      tokenComposition: 'Token Composition',
      lastActive: 'Last Active',
      pricing: 'Pricing',
      refreshPricing: 'Refresh Token Pricing',
      pricingUpdated: 'Pricing updated',
      pricingUpdateFailed: 'Failed to update pricing',
      sortHint: 'Click a column header to sort',
      quota: 'Quota',
      quotaWindow: 'Window',
      quotaLimit: 'Limit',
      quota5h: '5-hour',
      quotaWeekly: 'Weekly',
      quotaAllModels: 'All',
      quotaScoped: 'Per model',
      quotaCredits: 'Usage credits',
      quotaHint: 'Real data from Anthropic /usage.',
      contextWindow: 'Context window',
      contextHint: 'New task → /clear',
      contextHintCompact: 'Same task → /compact',
      contextLeft: 'Context left',
      contentAnalysis: 'Content',
      estimatedNote: 'Estimated from text length — relative shares are reliable, absolute figures are approximate.',
      calibratedNote: 'Calibrated: per-category shares from text length, scaled to the exact billed token totals (output side / input + cache-write side). Toggle with analysis.calibrate.',
      calibratedTokens: 'Calibrated tokens',
      thinkingTokensCalibrated: 'real thinking tokens (calibrated)',
      byTool: 'Tool Results by Tool',
      catUserPrompts: 'Your prompts',
      catAssistantText: 'Assistant responses',
      catAssistantThinking: 'Assistant thinking',
      catToolCalls: 'Tool calls',
      catToolResults: 'Tool results',
      estTokens: 'Est. tokens',
      share: 'Share',
      resets: 'Resets',
      cacheHitRate: 'Cache Hit Rate',
      last30days: 'Last 30 days',
      branches: 'Branches',
      branchBreakdown: 'Branch Usage',
      branch: 'Branch',
      workflows: 'Workflows',
      workflowBreakdown: 'Workflow Usage',
      workflowName: 'Workflow',
      model: 'Model',
      agents: 'Agents',
      agent: 'Agent',
      workflowsLast30Days: 'Workflows in the last 30 days',
      workflowLast30DaysCostShare: "share of the last 30 days' cost",
      workflowCacheHint:
        'Cache hit rate = cache reads ÷ all input-side tokens. Native Claude workflows reuse the prompt cache across agents (high rate); a provider without cross-agent caching shows ~0% — the same workflow costs disproportionately more there.',
      adhocBadge: 'subagents (ad-hoc)',
      workflowModeBadge: 'workflow',
      workflowModeHint:
        '"workflow" = a dynamic-workflow run dir on disk; "subagents (ad-hoc)" = a plain Task-tool fan-out. The effort level (ultracode/xhigh) is not recorded in the logs, so neither badge claims one.',
      workflowNativeHint:
        'Native-Claude ultracode often keeps its orchestration in the main session (no agent files), so it appears in Sessions / Usage tracking rather than as a row here. Runs that do write agent files show their Claude cost in the orchestration line. (Tracked for a future release.)',
      orchestration: 'main-session orchestration',
      commonTaskPrefix: 'Shared task text',
      thinkingShare: 'Thinking %',
      effortHint: 'High thinking share — consider /effort high instead of xhigh for tasks like this.',
      thinkingHidden: 'Thinking was on, but this model (e.g. Fable 5 / Opus 4.8) does not expose its reasoning text, so the share can’t be measured — the real value is higher than shown.',
      thinkingHiddenShort: 'hidden',
      quotaWarnBanner:
        'Only {remaining}% of your 5-hour window is left. A workflow run can consume a large share of it — consider waiting for the reset: interrupted runs lose their prompt cache and re-run ~40% more expensive.',
      dismiss: 'Dismiss',
      attribution: 'Usage tracking',
      attrDisclaimer:
        'Approximate, based on local sessions on this machine — does not include other devices or claude.ai. These are independent characteristics of your usage, not a breakdown.',
      attrLargeContext: '{pct}% of your usage was at >150k context',
      attrLargeContextShort: '>150k context',
      attrLargeContextHint:
        'Longer sessions are more expensive even when cached. /compact mid-task, /clear when switching to new tasks.',
      attrLongSessions: '{pct}% of your usage came from sessions active 8+ hours',
      attrLongSessionsShort: '8h+ sessions',
      attrLongSessionsHint:
        'These are often background/loop sessions. Continuous usage can add up quickly, so make sure it is intentional.',
      attrSubagentHeavy: '{pct}% of your usage came from subagent-heavy sessions',
      attrSubagentHeavyShort: 'Subagent-heavy sessions',
      attrSubagentHeavyHint:
        'Each subagent runs its own requests. Be deliberate about spawning them — and consider a cheaper model for simpler subagents.',
      attrWorkflows: '{pct}% of your usage came from workflow runs',
      attrWorkflowsShort: 'Workflow runs',
      attrWorkflowsHint: 'See the Workflows tab for per-run details and cache hit rates.',
      attrSkillChar: '{pct}% of your usage came from {name}',
      attrSkillCharHint: 'Heavy skills can be scoped down or run with a cheaper model via skill frontmatter.',
      attrPluginChar: '{pct}% of your usage came from plugin "{name}"',
      attrPluginCharHint:
        'Review what this plugin contributes — its agents, skills and MCP tools all count toward your limit.',
      attrSkills: 'Skills',
      attrSubagents: 'Subagents',
      attrPlugins: 'Plugins',
      attrModels: 'Models',
      attrShare: '% of usage',
      count: 'Count',
      scopeDay: 'Day',
      scopeWeek: 'Week',
      scopeMonth: 'Month',
      attrTodayPointer: 'Details: Content tab',
      sessionTitle: 'Session',
      sessionActions: 'Actions',
      copySessionId: 'Copy session ID',
      viewConversation: 'View this conversation (read-only) — re-read your prompts and the model\'s answers without loading them back into context.',
      copyPath: 'Copy path',
      resumeSession: 'Resume this conversation — reopens it in Claude Code (same project) or a terminal via "claude --resume", so you can continue where you left off.',
      resumeInvalid: 'Invalid session id — cannot resume.',
      sessionFilterCurrent: 'Current project',
      sessionFilterAll: 'All',
      sessionRangeToday: 'Today',
      sessionRange7d: '7 days',
      sessionRange30d: '30 days',
      sessionModelAll: 'All models',
      deleteSession: 'Delete session',
      deleteSessionConfirm: 'Delete session "{name}"?',
      deleteSessionDetail: 'Its conversation log moves to the trash (recoverable). The extension is otherwise read-only.',
      deleteSessionYes: 'Delete',
      deleteSessionNotFound: 'Session log file not found.',
      deleteSessionDone: 'Deleted "{name}" (moved to trash).',
      getAdvice: 'Get AI Advice',
      adviceCardTitle: 'AI advice',
      adviceCardDesc:
        'Review local evidence first. The exact request defaults to aggregates only; prompt samples and personal context require separate consent, and nothing is sent until you click Send.',
      optimizerTitle: 'Usage optimizer',
      optimizerDesc:
        'Turn a rough, half-formed request into a clean prompt you can paste straight into Claude Code — plus a suggested effort / thinking / model for the task.',
      optimizerHowto:
        'Type or paste your draft below, choose any optional tweaks, then build the exact request preview. Nothing is sent until you click Send; only the text you pasted can be included.',
      optimizerConsent:
        'Build the exact request preview? This does not send anything; sending to your configured API model requires a separate click.',
      optimizerEnableBtn: 'Enable in settings',
      optimizerPlaceholder: 'Paste a rough prompt to optimise…',
      optimizerRun: 'Optimise',
      optimizerRunning: 'Optimising…',
      optimizerCopy: 'Copy prompt',
      optimizerCopied: 'Copied',
      optimizerResolve: 'Flag vague references',
      optimizerResolveHint:
        "Have the model point out vague references (e.g. 'this', 'the file', 'that bug') and pin them down or mark a clear assumption.",
      optimizerDistil: 'Condense long pasted text',
      optimizerDistilHint:
        'If your draft pastes long logs / code / docs, condense them to just what Claude needs.',
      optimizerAesthetic: 'Suggest a style direction',
      optimizerAestheticHint:
        'For UI / visual / writing tasks, propose one concrete style direction so the result is not generic.',
      optimizerPromptHeading: 'Optimised prompt',
      optimizerSettingsHeading: 'Recommended run settings',
      experimentalBadge: 'experimental',
      adviceNeedsKey: 'Set an API key in Settings to use AI advice.',
      adviceGenerating: 'Generating usage advice…',
      adviceFailed: 'Failed to get advice',
      adviceScopeOverall: 'Overall (all projects)',
      adviceScopePrompt: 'Choose what the advice should focus on',
      adviceDemoButton: 'Preview demo',
      adviceDemoNotice:
        '# DEMO — AI Usage Advice preview\n\n' +
        '> **This file is a static demo, not real advice.**\n' +
        '> The text below was hand-written to show what kind of output the\n' +
        '> feature produces. It is **not** based on your actual Claude Code\n' +
        '> usage data — nothing was sent to any API to generate this.\n\n' +
        '### To get real, personalised advice based on YOUR usage:\n\n' +
        '1. Run **`Claude Code Usage: Show Usage Details`**\n' +
        '2. Open the dashboard **Settings → Advice** section\n' +
        '3. Paste an OpenAI-compatible API key — it is kept in VS Code SecretStorage\n' +
        '   DeepSeek: [deepseek.com](https://platform.deepseek.com)\n' +
        '4. Re-run **`Claude Code Usage: Get AI Usage Advice`**',
      costComposition: 'Cost Composition',
      date: 'Date',
      yesterday: 'Yesterday',
      dataDirectory: 'Data Directory',
      noDataMessage: 'No usage data found. Make sure Claude Code is running and configured correctly.',
      errorMessage: 'Error loading usage data. Please check your configuration.',
    },
    settings: {
      title: 'Claude Code Usage Settings',
      refreshInterval: 'Refresh Interval (seconds)',
      dataDirectory: 'Data Directory Path',
      language: 'Language',
      decimalPlaces: 'Decimal Places',
    },
  },
  "de-DE": {
    statusBar: {
      loading: "Lädt...",
      noData: "Keine Claude Code Daten",
      notRunning: "Claude Code nicht erreichbar",
      error: "Fehler",
      refreshFailed: "Aktualisierung fehlgeschlagen. Erneut versuchen oder Diagnoselogs prüfen.",
      currentSession: "Session",
    },
    releaseAnnouncement: {
      v230: 'Neu: Codex-Beta-Nutzung und lokale Optimierungshinweise, versionsgenaue Release-Hinweise und Entfernung der veralteten modellspezifischen wöchentlichen Opus-Option.',
      v231: 'Neu: korrekte 30-Tage-Codex-Werte, reset-bewusste Wochenschätzungen und eine private kombinierte Aktivitäts-Heatmap mit lokalem SVG- und Markdown-Export.',
      v232: 'Neu in 2.3.2: eine 30-/90-Tage-Projektaktivitätsmatrix für Claude und Codex, vollständige Diagramm-Drilldowns, zustandserhaltende Aktualisierung und eine kompakte Währungsauswahl mit festen Referenzkursen.',
    },
    providers: PROVIDERS['de-DE'],
    weeklyValue: WEEKLY_VALUE_COPY['de-DE'],
    popup: {
      title: "Claude Code Nutzung",
      currentSession: "Aktuelle Sitzung",
      today: "Heute",
      thisMonth: "Diesen Monat",
      allTime: "Seit Aufzeichnungsbeginn",
      workspaceToday: "Dieses Projekt",
      refresh: "Aktualisieren",
      autoRefresh: "Auto-Aktualisierung",
      settings: "Einstellungen",
      settingsTab: "Einstellungen",
      settingsIntro:
        "Die Einstellungen sind jetzt hier. Sprache und Datenverzeichnisse bleiben in den VS-Code-Einstellungen; API-Schlüssel liegen in VS Code SecretStorage und werden nie synchronisiert. Änderungen wirken sofort.",
      secretMigrationFailed:
        'Der gespeicherte API-Schlüssel konnte nicht in SecretStorage verschoben werden. Die Nutzungsanzeige bleibt verfügbar und der alte Schlüssel wurde nicht gelöscht, aber die KI-Beratung ist nicht konfiguriert. Korrigieren Sie die alte Einstellung und laden Sie das Fenster neu.',
      secretMigrationWorkspace:
        'Ein arbeitsbereichsspezifischer API-Schlüssel kann nicht sicher in einen globalen SecretStorage-Eintrag migriert werden. Die Nutzungsanzeige bleibt verfügbar, aber die KI-Beratung ist nicht konfiguriert. Kopieren und entfernen Sie den Schlüssel aus den Arbeitsbereichseinstellungen, laden Sie neu und geben Sie ihn unter Dashboard-Einstellungen → Beratung ein.',
      settingsResetAll: "Alle zurücksetzen",
      settingsGroupGeneral: "Allgemein",
      settingsGroupProviders: "Anbieter",
      settingsGroupFeatures: "Optionale Funktionen",
      settingsGroupStatusBar: "Statusleiste",
      quotaFormatBuiltIn: 'Standard',
      quotaFormatFiveHour: 'Nur 5 Stunden',
      quotaFormatWeekly: 'Nur Woche',
      quotaFormatCustom: 'Benutzerdefiniert…',
      quotaFormatShortHelp: 'Kompaktes Layout wählen. „Standard“ übernimmt die obigen Kontingentoptionen.',
      settingsGroupData: "Daten & Aktualisierung",
      settingsGroupAdvice: "KI-Beratung & Optimizer",
      adviceEffectiveness: {
        title: 'Wirksamkeit von KI-Empfehlungen',
        description: 'Prüfe, wie jede Empfehlung von einer lokalen Beobachtung über Evidenz und eine Maßnahme zu einem abgesicherten Ergebnis gelangt.',
        candidateNotice: 'v2.3.1-Kandidat · standardmäßig deaktiviert · keine standardmäßigen oder Hintergrund-KI-Anfragen.',
        spineLabel: 'Evidenzpfad der Empfehlung',
        observation: 'Beobachtung',
        evidence: 'Evidenz',
        recommendation: 'Empfehlung',
        action: 'Maßnahme',
        result: 'Ergebnis',
        source: 'Quelle',
        limitations: 'Einschränkungen',
        proxyMetric: 'Proxy-Metrik',
        longSessionSignal: '{share} der beobachteten Nutzung stammten aus langen Sitzungen.',
        largeContextSignal: '{share} der beobachteten Nutzung traten bei großen Kontextgrößen auf.',
        frameworkOverheadSignal: '{share} der beobachteten Nutzung entfallen auf separat geschätzte Framework-Injektionen; dies bewertet nicht die Qualität der Texte des Nutzers.',
        clearBoundaryRecommendation: 'Nutze klarere Aufgabengrenzen für lange Arbeiten oder Arbeiten mit großem Kontext.',
        clearBoundaryAction: 'Beginne bei einem Aufgabenwechsel eine neue Sitzung; kompaktiere nur beim Fortsetzen derselben Aufgabe.',
        codexLocalRecommendation: 'Prüfe vor der nächsten vergleichbaren Aufgabe das lokale strukturelle Codex-Signal.',
        noEvidenceAdvice: 'Für diesen Bereich ist keine evidenzbasierte Empfehlung verfügbar.',
        codexPreviewUnavailable: 'Eine datenschutzfreundliche Vorschau der aggregierten Codex-Payload ist noch nicht verfügbar.',
        elapsedTimeProxy: 'Die verstrichene Sitzungsspanne ist ein Proxy und keine gemessene aktive Arbeitszeit.',
        qualityGuardrailPending: 'Qualitätsevidenz steht noch aus; daher ist keine Aussage zur Wirksamkeit möglich.',
        payloadTitle: 'Versiegelte Payload-Momentaufnahme',
        payloadDescription: 'Diese versiegelte Momentaufnahme ist exakt der UTF-8-JSON-Body, den der konfigurierte BYOK-Endpunkt erst nach einem separaten Klick auf Senden erhält.',
        aggregatesOnly: 'Nur Aggregate',
        aggregatesWithPersonalization: 'Aggregate + ausdrücklich erlaubter persönlicher Kontext',
        aggregatesWithPromptSamples: 'Aggregate + ausdrücklich erlaubte Prompt-Beispiele',
        payloadBytes: '{bytes} UTF-8-Bytes',
        promptSamplesIncluded: '{count} Prompt-Beispiele enthalten',
        previewPayload: 'Versiegelte Momentaufnahme anzeigen',
        noNetworkTransport: 'Die Vorschau sendet nichts. Das Senden erfordert einen separaten Klick.',
        sendPreparedRequest: 'Genau diese Anfrage senden',
        sendingPreparedRequest: 'Wird gesendet…',
        sentPreparedRequest: 'Strukturierter Rat empfangen.',
        aggregateConsentLabel: 'Aggregierte Nutzungsdaten erlauben',
        aggregateConsentHelp: 'Enthält nur freigegebene numerische Aggregate und strukturelle Signale — keine Prompts, Pfade, Sitzungs-IDs oder Einzelaufzeichnungen.',
        promptConsentLabel: 'Auch Prompt-Beispiele und konfigurierten persönlichen Kontext einschließen',
        promptConsentHelp: 'Optional und standardmäßig deaktiviert. Begrenzter Prompt-Text und der konfigurierte persönliche Kontext werden nur nach dieser separaten ausdrücklichen Einwilligung hinzugefügt.',
        promptWindowHelp: 'Prompt-Beispiele außerhalb des konfigurierten Evidenzfensters von {days} Tagen werden ausgeschlossen.',
        feedbackTitle: 'Lokales Feedback',
        helpful: 'Hilfreich',
        notHelpful: 'Nicht hilfreich',
        applied: 'Angewendet',
        snooze: '7 Tage zurückstellen',
        resume: 'Wieder anzeigen',
        snoozedUntil: 'Zurückgestellt bis {date}',
        feedbackLocalOnly: 'Wird nur auf diesem Gerät gespeichert und nie einer Remote-Payload hinzugefügt.',
        feedbackSaveFailed: 'Das Feedback konnte lokal nicht gespeichert werden. Es wurde nichts gesendet.',
        comparisonTitle: 'Ergebnisse vergleichbarer Aufgaben',
        comparablePairs: '{count} vergleichbare Aufgabenpaare',
        minimumComparablePairs: 'Mindestens {minimum} vergleichbare Aufgabenpaare sind nötig, bevor eine Schlussfolgerung gezogen wird.',
        insufficientEvidence: 'Nicht genügend Evidenz für eine Schlussfolgerung.',
        qualityGuardrailFailed: 'Die Qualitätsleitplanke hielt nicht; deshalb wird keine Wirksamkeit behauptet.',
        improved: 'Die Verbesserung erreichte den vorab festgelegten Schwellenwert, während die Qualitätsleitplanke hielt.',
        noDemonstratedImprovement: 'Es wurde keine Verbesserung nachgewiesen; daraus folgen weder Schaden noch Kausalität.',
        clearLocalData: 'Lokale Empfehlungsdaten löschen',
        clearLocalDataConfirm: 'Einwilligungen, Feedback, vergleichbare Paare und Vergleichsergebnisse auf diesem Gerät löschen?',
        strictOutputRejected: 'Die strukturierte Modellausgabe wurde abgelehnt. Es wurde keine Empfehlung erstellt.',
      },
      totalTokens: "Gesamte Token",
      inputTokens: "Eingabe Token",
      outputTokens: "Ausgabe Token",
      cacheCreation: "Eingabe-Cache (Miss)",
      cacheRead: "Eingabe-Cache (Hit)",
      cost: "Kosten",
      messages: "Nachrichten",
      modelBreakdown: "Nutzung nach Modell",
      dailyBreakdown: "Tages-Nutzungsübersicht",
      monthlyBreakdown: "Monats-Nutzungsübersicht",
      hourlyBreakdown: "Stunden-Nutzungsübersicht",
      sessions: "Sitzungen",
      sessionBreakdown: "Nutzung nach Sitzung",
      project: "Projekt",
      startTime: "Startzeit",
      duration: "Dauer",
      activeDuration: 'Aktiv',
      activeDurationHelp: 'Geschätzte aktive Zeit — die Abstände zwischen den Zügen summiert, jede Leerlauflücke auf 1,5 Std. begrenzt, damit lange Pausen sie nicht aufblähen, Lese-/Prüfzeit aber mitzählt. (Dauer ist die gesamte Spanne.)',
      hour: "Stunde",
      projects: "Projekte",
      projectBreakdown: "Nutzung nach Projekt",
      fullPath: "Vollständiger Pfad",
      peakContext: "Größter Kontext",
      tokenComposition: "Token-Zusammensetzung",
      lastActive: "Zuletzt aktiv",
      pricing: "Preise",
      refreshPricing: "Token-Preise aktualisieren",
      pricingUpdated: "Preise aktualisiert",
      pricingUpdateFailed: "Preisaktualisierung fehlgeschlagen",
      sortHint: "Zum Sortieren auf eine Spaltenüberschrift klicken",
      quota: "Kontingent",
      quotaWindow: "Zeitfenster",
      quotaLimit: "Limit",
      quota5h: "5 Stunden",
      quotaWeekly: "Woche",
      quotaAllModels: "Alle",
      quotaScoped: "Pro Modell",
      quotaCredits: "Nutzungsguthaben",
      quotaHint: "Echte Daten von Anthropic /usage.",
      contextWindow: "Kontextfenster",
      contextHint: "Neue Aufgabe → /clear",
      contextHintCompact: "Gleiche Aufgabe → /compact",
      contextLeft: "Kontext frei",
      contentAnalysis: "Inhalt",
      estimatedNote: "Aus Textlänge geschätzt — relative Anteile sind verlässlich, absolute Werte ungefähr.",
      calibratedNote: "Kalibriert: Anteile je Kategorie aus der Textlänge, skaliert auf die exakten abgerechneten Token-Summen (Ausgabeseite / Eingabe + Cache-Schreiben). Umschalten mit analysis.calibrate.",
      calibratedTokens: "Kalibrierte Tokens",
      thinkingTokensCalibrated: "echte Denk-Tokens (kalibriert)",
      byTool: "Tool-Ergebnisse nach Tool",
      catUserPrompts: "Deine Eingaben",
      catAssistantText: "Assistent-Antworten",
      catAssistantThinking: "Assistent-Denken",
      catToolCalls: "Tool-Aufrufe",
      catToolResults: "Tool-Ergebnisse",
      estTokens: "Gesch. Token",
      share: "Anteil",
      resets: "Reset",
      cacheHitRate: "Cache-Trefferrate",
      last30days: "Letzte 30 Tage",
      branches: "Branches",
      branchBreakdown: "Nutzung nach Branch",
      branch: "Branch",
      workflows: "Workflows",
      workflowBreakdown: "Nutzung nach Workflow",
      workflowName: "Workflow",
      model: "Modell",
      agents: "Agenten",
      agent: "Agent",
      workflowsLast30Days: 'Workflows in den letzten 30 Tagen',
      workflowLast30DaysCostShare: 'Anteil an den Kosten der letzten 30 Tage',
      workflowCacheHint:
        "Cache-Trefferrate = Cache-Lesevorgänge ÷ alle eingabeseitigen Tokens. Native Claude-Workflows nutzen den Prompt-Cache agentenübergreifend (hohe Rate); ein Anbieter ohne agentenübergreifenden Cache zeigt ~0 % — derselbe Workflow kostet dort unverhältnismäßig mehr.",
      adhocBadge: "Subagenten (ad-hoc)",
      workflowModeBadge: "Workflow",
      workflowModeHint:
        '"Workflow" = ein Dynamic-Workflow-Laufverzeichnis auf der Platte; "Subagenten (ad-hoc)" = ein einfacher Task-Tool-Fan-out. Das Effort-Level (ultracode/xhigh) wird nicht protokolliert, daher behauptet kein Badge eines.',
      workflowNativeHint:
        'Native-Claude-Ultracode behält die Orchestrierung oft in der Hauptsitzung (keine Agent-Dateien) und erscheint daher in Sitzungen / Nutzungs-Tracking statt als Zeile hier. Läufe, die Agent-Dateien schreiben, zeigen ihre Claude-Kosten in der Orchestrierungszeile. (Für ein künftiges Release vorgemerkt.)',
      orchestration: "Orchestrierung der Hauptsitzung",
      commonTaskPrefix: "Gemeinsamer Aufgabentext",
      thinkingShare: "Denkanteil",
      effortHint: "Hoher Denkanteil — für solche Aufgaben /effort high statt xhigh erwägen.",
      thinkingHidden: 'Denkmodus war aktiv, aber dieses Modell (z. B. Fable 5 / Opus 4.8) gibt den Denktext nicht preis, daher ist der Anteil nicht messbar — der echte Wert ist höher als angezeigt.',
      thinkingHiddenShort: 'verborgen',
      quotaWarnBanner:
        "Nur noch {remaining}% des 5-Stunden-Fensters übrig. Ein Workflow-Lauf kann einen großen Teil davon verbrauchen — besser auf den Reset warten: unterbrochene Läufe verlieren ihren Prompt-Cache und kosten beim Neustart ~40% mehr.",
      dismiss: "Ausblenden",
      attribution: "Nutzungs-Tracking",
      attrDisclaimer:
        "Ungefähr, basierend auf lokalen Sitzungen dieses Rechners — andere Geräte oder claude.ai sind nicht enthalten. Unabhängige Merkmale der Nutzung, keine Aufschlüsselung.",
      attrLargeContext: "{pct}% der Nutzung lag bei >150k Kontext",
      attrLargeContextShort: ">150k Kontext",
      attrLargeContextHint:
        "Längere Sitzungen sind auch mit Cache teurer. /compact während der Aufgabe, /clear beim Aufgabenwechsel.",
      attrLongSessions: "{pct}% der Nutzung stammte aus Sitzungen mit 8+ aktiven Stunden",
      attrLongSessionsShort: "8h+ Sitzungen",
      attrLongSessionsHint:
        "Oft Hintergrund-/Loop-Sitzungen. Dauernutzung summiert sich schnell — sicherstellen, dass sie beabsichtigt ist.",
      attrSubagentHeavy: "{pct}% der Nutzung stammte aus Subagent-lastigen Sitzungen",
      attrSubagentHeavyShort: "Subagent-lastige Sitzungen",
      attrSubagentHeavyHint:
        "Jeder Subagent stellt eigene Anfragen. Bewusst einsetzen — für einfache Subagenten ein günstigeres Modell erwägen.",
      attrWorkflows: "{pct}% der Nutzung stammte aus Workflow-Läufen",
      attrWorkflowsShort: "Workflow-Läufe",
      attrWorkflowsHint: "Details und Cache-Trefferraten pro Lauf im Workflows-Tab.",
      attrSkillChar: "{pct}% der Nutzung stammte von {name}",
      attrSkillCharHint: "Schwere Skills lassen sich eingrenzen oder per Skill-Frontmatter mit günstigerem Modell betreiben.",
      attrPluginChar: "{pct}% der Nutzung stammte vom Plugin \"{name}\"",
      attrPluginCharHint:
        "Prüfen, was dieses Plugin beiträgt — seine Agenten, Skills und MCP-Tools zählen alle zum Limit.",
      attrSkills: "Skills",
      attrSubagents: "Subagenten",
      attrPlugins: "Plugins",
      attrModels: "Modelle",
      attrShare: "% der Nutzung",
      count: "Anzahl",
      scopeDay: "Tag",
      scopeWeek: "Woche",
      scopeMonth: "Monat",
      attrTodayPointer: "Details: Inhalt-Tab",
      sessionTitle: "Sitzung",
      sessionActions: 'Aktionen',
      copySessionId: 'Sitzungs-ID kopieren',
      viewConversation: 'Dieses Gespräch ansehen (schreibgeschützt) — lies deine Prompts und die Antworten des Modells erneut, ohne sie zurück in den Kontext zu laden.',
      copyPath: 'Pfad kopieren',
      resumeSession: 'Dieses Gespräch fortsetzen — öffnet es erneut in Claude Code (gleiches Projekt) oder in einem Terminal via "claude --resume", um dort weiterzumachen, wo du aufgehört hast.',
      resumeInvalid: 'Ungültige Sitzungs-ID — Fortsetzen nicht möglich.',
      sessionFilterCurrent: 'Aktuelles Projekt',
      sessionFilterAll: 'Alle',
      sessionRangeToday: 'Heute',
      sessionRange7d: '7 Tage',
      sessionRange30d: '30 Tage',
      sessionModelAll: 'Alle Modelle',
      deleteSession: 'Sitzung löschen',
      deleteSessionConfirm: 'Sitzung "{name}" löschen?',
      deleteSessionDetail: 'Das Gesprächsprotokoll wandert in den Papierkorb (wiederherstellbar). Die Erweiterung ist ansonsten schreibgeschützt.',
      deleteSessionYes: 'Löschen',
      deleteSessionNotFound: 'Sitzungs-Protokolldatei nicht gefunden.',
      deleteSessionDone: '"{name}" gelöscht (in den Papierkorb verschoben).',
      getAdvice: "KI-Rat holen",
      adviceCardTitle: "KI-Rat",
      adviceCardDesc:
        "Prüfe zuerst die lokalen Belege. Die exakte Anfrage enthält standardmäßig nur Aggregate; Prompt-Beispiele und persönlicher Kontext brauchen eine separate Einwilligung, und erst ein Klick auf Senden überträgt etwas.",
      optimizerTitle: "Nutzungs-Optimierer",
      optimizerDesc:
        "Mach aus einer groben, halbfertigen Anfrage einen sauberen Prompt, den du direkt in Claude Code einfügen kannst — plus empfohlenes Effort / Thinking / Modell für die Aufgabe.",
      optimizerHowto:
        "Tippe oder füge deinen Entwurf unten ein, wähle optionale Anpassungen und erstelle dann die exakte Anfragevorschau. Erst ein separater Klick auf Senden überträgt etwas; enthalten sein kann nur dein eingefügter Text.",
      optimizerConsent:
        "Exakte Anfragevorschau erstellen? Dabei wird nichts gesendet; die Übertragung an dein konfiguriertes API-Modell erfordert einen separaten Klick.",
      optimizerEnableBtn: "In Einstellungen aktivieren",
      optimizerPlaceholder: "Groben Prompt zum Optimieren einfügen…",
      optimizerRun: "Optimieren",
      optimizerRunning: "Optimiere…",
      optimizerCopy: "Prompt kopieren",
      optimizerCopied: "Kopiert",
      optimizerResolve: "Vage Referenzen markieren",
      optimizerResolveHint:
        "Lässt das Modell vage Bezüge (z. B. \"das\", \"die Datei\", \"der Bug\") benennen und festnageln oder eine klare Annahme markieren.",
      optimizerDistil: "Lange Inhalte verdichten",
      optimizerDistilHint:
        "Wenn dein Entwurf lange Logs / Code / Docs enthält, werden sie auf das Nötige verdichtet.",
      optimizerAesthetic: "Stilrichtung vorschlagen",
      optimizerAestheticHint:
        "Bei UI- / Visual- / Schreibaufgaben eine konkrete Stilrichtung vorschlagen, damit das Ergebnis nicht generisch wird.",
      optimizerPromptHeading: "Optimierter Prompt",
      optimizerSettingsHeading: "Empfohlene Lauf-Einstellungen",
      experimentalBadge: "experimentell",
      adviceNeedsKey: "API-Schlüssel in den Einstellungen festlegen, um KI-Rat zu nutzen.",
      adviceGenerating: "Nutzungsrat wird erstellt…",
      adviceFailed: "Rat konnte nicht abgerufen werden",
      adviceScopeOverall: "Gesamt (alle Projekte)",
      adviceScopePrompt: "Worauf soll sich der Rat konzentrieren?",
      adviceDemoButton: "Demo ansehen",
      adviceDemoNotice:
        '# DEMO — KI-Nutzungsrat-Vorschau\n\n' +
        '> **Diese Datei ist eine statische Demo, kein echter Rat.**\n' +
        '> Der untenstehende Text wurde handgeschrieben, um zu zeigen, welche\n' +
        '> Art von Output die Funktion erzeugt. Er basiert **nicht** auf\n' +
        '> Ihren tatsächlichen Nutzungsdaten — es wurde nichts an eine API\n' +
        '> gesendet, um diesen Text zu generieren.\n\n' +
        '### Für echten, personalisierten Rat basierend auf IHRER Nutzung:\n\n' +
        '1. **`Claude Code Usage: Show Usage Details`** ausführen\n' +
        '2. Im Dashboard **Einstellungen → Beratung** öffnen\n' +
        '3. Einen OpenAI-kompatiblen API-Key einfügen — er bleibt in VS Code SecretStorage\n' +
        '   DeepSeek: [deepseek.com](https://platform.deepseek.com)\n' +
        '4. **`Claude Code Usage: Get AI Usage Advice`** erneut ausführen',
      costComposition: "Kostenzusammensetzung",
      date: "Datum",
      yesterday: "Gestern",
      dataDirectory: "Daten Pfad",
      noDataMessage:
        "Keine Daten gefunden. Stell sicher, dass Claude Code läuft und entsprechend konfiguriert ist.",
      errorMessage:
        "Fehler beim laden der Nutzungsdaten. Bitte prüfe deine Konfiguration.",
    },
    settings: {
      title: "Claude Code Nutzungseinstellungen",
      refreshInterval: "Aktualisierungsinterval (in Sekunden)",
      dataDirectory: "Datenordner Pfad",
      language: "Sprache",
      decimalPlaces: "Dezimalstellen",
    },
  },
  'zh-TW': {
    statusBar: {
      loading: '載入中...',
      noData: '無 Claude Code 資料',
      notRunning: 'Claude Code 未執行',
      error: '錯誤',
      refreshFailed: '使用量重新整理失敗。請重試或查看診斷日誌。',
      currentSession: '當前會話',
    },
    releaseAnnouncement: {
      v230: '新功能：Codex Beta 用量與本機優化建議、與安裝版本精確對應的更新說明，並移除已過時的特定模型每週 Opus 選項。',
      v231: '新功能：正確的 Codex 最近 30 天統計、可識別重置的每週額度估算，以及可匯出本機 SVG／Markdown 的隱私安全綜合活動熱力圖。',
      v232: '2.3.2 新功能：Claude 與 Codex 的 30／90 天專案活動矩陣、完整圖表下鑽、保留介面狀態的重新整理，以及採用固定參考匯率的精簡幣別下拉選單。',
    },
    providers: PROVIDERS['zh-TW'],
    weeklyValue: WEEKLY_VALUE_COPY['zh-TW'],
    popup: {
      title: 'Claude Code 使用量',
      currentSession: '當前會話',
      today: '今日',
      thisMonth: '本月',
      allTime: '所有',
      workspaceToday: '本專案',
      refresh: '重新整理',
      autoRefresh: '自動刷新',
      settings: '設定',
      settingsTab: '設定',
      settingsIntro:
        '設定現在都在這裡。語言與資料目錄仍使用 VS Code 設定；API 金鑰存於 VS Code SecretStorage，絕不同步。變更會立即生效。',
      secretMigrationFailed:
        '無法將已儲存的建議 API 金鑰移入 SecretStorage。用量功能仍可使用，舊金鑰也未刪除，但 AI 建議尚未設定。請修正舊設定並重新載入視窗。',
      secretMigrationWorkspace:
        '工作區專用 API 金鑰無法安全遷移至單一全域 SecretStorage。用量功能仍可使用，但 AI 建議尚未設定。請先複製金鑰並從工作區設定移除，重新載入後在「儀表板設定 → 建議」輸入。',
      settingsResetAll: '全部還原為預設',
      settingsGroupGeneral: '一般',
      settingsGroupProviders: '供應商',
      settingsGroupFeatures: '選用功能',
      settingsGroupStatusBar: '狀態列',
      quotaFormatBuiltIn: '內建',
      quotaFormatFiveHour: '僅 5 小時',
      quotaFormatWeekly: '僅每週',
      quotaFormatCustom: '自訂…',
      quotaFormatShortHelp: '選擇精簡版面；「內建」沿用上方配額選項。',
      settingsGroupData: '資料與重新整理',
      settingsGroupAdvice: 'AI 建議與最佳化工具',
      adviceEffectiveness: {
        title: 'AI 建議有效性',
        description: '檢視每項建議如何從本機觀察，經由證據與行動，走到有品質護欄的結果。',
        candidateNotice: 'v2.3.1 候選功能 · 預設關閉 · 沒有預設或背景 AI 請求。',
        spineLabel: '建議證據路徑',
        observation: '觀察',
        evidence: '證據',
        recommendation: '建議',
        action: '行動',
        result: '結果',
        source: '來源',
        limitations: '限制',
        proxyMetric: '代理指標',
        longSessionSignal: '觀察到的用量中，有 {share} 來自長工作階段。',
        largeContextSignal: '觀察到的用量中，有 {share} 發生於大型上下文。',
        frameworkOverheadSignal: '觀察到的用量中，{share} 是另行估算的框架注入占比；這不評價使用者的寫作品質。',
        clearBoundaryRecommendation: '對長時間或大型上下文工作採用更清楚的任務邊界。',
        clearBoundaryAction: '任務改變時開始新的工作階段；只有繼續同一任務時才壓縮上下文。',
        codexLocalRecommendation: '在下一個可比任務前，先檢視本機 Codex 結構訊號。',
        noEvidenceAdvice: '此範圍目前沒有以證據為基礎的建議。',
        codexPreviewUnavailable: '隱私安全的 Codex 彙總 payload 預覽尚未可用。',
        elapsedTimeProxy: '工作階段首尾跨度是代理指標，不是實測的活躍工作時間。',
        qualityGuardrailPending: '品質證據仍待補充，因此目前無法判定建議有效性。',
        payloadTitle: '密封 payload 快照',
        payloadDescription: '此密封快照就是設定的 BYOK 端點在另行點擊「傳送」後才會收到的確切 UTF-8 JSON body。',
        aggregatesOnly: '僅彙總資料',
        aggregatesWithPersonalization: '彙總資料 + 明確允許的個人上下文',
        aggregatesWithPromptSamples: '彙總資料 + 明確允許的 prompt 樣本',
        payloadBytes: '{bytes} 個 UTF-8 位元組',
        promptSamplesIncluded: '包含 {count} 個 prompt 樣本',
        previewPayload: '預覽密封快照',
        noNetworkTransport: '預覽不會傳送任何內容；傳送需要另行點擊。',
        sendPreparedRequest: '傳送這個完全相同的請求',
        sendingPreparedRequest: '正在傳送…',
        sentPreparedRequest: '已收到結構化建議。',
        aggregateConsentLabel: '允許使用彙總用量資料',
        aggregateConsentHelp: '只包含允許清單內的數值彙總與結構訊號——不含 prompt、路徑、工作階段 ID 或逐筆記錄。',
        promptConsentLabel: '同時包含 prompt 樣本與設定的個人上下文',
        promptConsentHelp: '選用且預設關閉。只有在另行明確同意後，才會加入有數量與長度限制的 prompt 文字及設定的個人上下文。',
        promptWindowHelp: '早於設定之 {days} 天證據視窗的 prompt 樣本不會包含。',
        feedbackTitle: '本機意見回饋',
        helpful: '有用',
        notHelpful: '無用',
        applied: '已套用',
        snooze: '暫停 7 天',
        resume: '再次顯示',
        snoozedUntil: '暫停至 {date}',
        feedbackLocalOnly: '只儲存在此裝置，絕不加入遠端 payload。',
        feedbackSaveFailed: '無法在本機儲存回饋。未傳送任何內容。',
        comparisonTitle: '可比任務結果',
        comparablePairs: '{count} 組可比任務',
        minimumComparablePairs: '至少需要 {minimum} 組可比任務，才能下結論。',
        insufficientEvidence: '證據不足，無法下結論。',
        qualityGuardrailFailed: '品質護欄未通過，因此不聲稱建議有效。',
        improved: '改善達到預先聲明的門檻，且品質護欄維持通過。',
        noDemonstratedImprovement: '尚未證明有改善；這不代表造成傷害，也不建立因果關係。',
        clearLocalData: '清除本機建議資料',
        clearLocalDataConfirm: '要清除此裝置上的建議同意、回饋、可比配對與比較結果嗎？',
        strictOutputRejected: '結構化模型輸出遭拒絕，因此未建立任何建議。',
      },
      totalTokens: '總 Token 數',
      inputTokens: '輸入 Token',
      outputTokens: '輸出 Token',
      cacheCreation: '輸入快取（未命中）',
      cacheRead: '輸入快取（命中）',
      cost: '成本',
      messages: '訊息數',
      modelBreakdown: '模型使用量',
      dailyBreakdown: '每日使用量',
      monthlyBreakdown: '每月使用量',
      hourlyBreakdown: '每小時使用量',
      sessions: '會話',
      sessionBreakdown: '各會話使用量',
      project: '專案',
      startTime: '開始時間',
      duration: '時長',
      activeDuration: '活躍時長',
      activeDurationHelp: '估算的實際操作時間——把各輪之間的間隔加總，每段閒置間隔上限 1.5 小時，避免長時間中斷灌水，同時把閱讀／審閱時間也算進去。（時長是首尾完整跨度。）',
      hour: '小時',
      projects: '專案',
      projectBreakdown: '各專案使用量',
      fullPath: '完整路徑',
      peakContext: '峰值上下文',
      tokenComposition: 'Token 組成',
      lastActive: '最近活動',
      pricing: '計費標準',
      refreshPricing: '更新 Token 單價',
      pricingUpdated: '價格已更新',
      pricingUpdateFailed: '價格更新失敗',
      sortHint: '點擊欄位標題可排序',
      quota: '用量額度',
      quotaWindow: '時間視窗',
      quotaLimit: '上限',
      quota5h: '5 小時',
      quotaWeekly: '每週',
      quotaAllModels: '全部',
      quotaScoped: '依模型',
      quotaCredits: '使用額度',
      quotaHint: '來自 Anthropic /usage 的真實資料。',
      contextWindow: '上下文視窗',
      contextHint: '切換任務用 /clear',
      contextHintCompact: '同任務可 /compact',
      contextLeft: '上下文餘量',
      contentAnalysis: '內容分析',
      estimatedNote: '由文字長度估算 —— 相對佔比可靠,絕對數值為近似值。',
      calibratedNote: '已校準：各類別佔比由文字長度估算,再縮放到精確的帳單 token 總量（輸出側 / 輸入＋快取寫入側）。用 analysis.calibrate 切換。',
      calibratedTokens: '已校準 token',
      thinkingTokensCalibrated: '真實思考 token（已校準）',
      byTool: '各工具結果用量',
      catUserPrompts: '你的提問',
      catAssistantText: '助手回覆',
      catAssistantThinking: '助手思考',
      catToolCalls: '工具呼叫',
      catToolResults: '工具結果',
      estTokens: '估算 Token',
      share: '佔比',
      resets: '重置',
      cacheHitRate: '快取命中率',
      last30days: '近 30 天',
      branches: '分支',
      branchBreakdown: '各分支使用量',
      branch: '分支',
      workflows: '工作流',
      workflowBreakdown: '各工作流使用量',
      workflowName: '工作流',
      model: '模型',
      agents: '代理數',
      agent: '代理',
      workflowsLast30Days: '最近 30 天工作流',
      workflowLast30DaysCostShare: '佔最近 30 天成本',
      workflowCacheHint:
        '快取命中率 = 快取讀取 ÷ 全部輸入側 token。原生 Claude 工作流可在代理間重用提示快取（命中率高）；不支援跨代理快取的供應商約為 0%——同樣的工作流在那裡的成本會高出許多。',
      adhocBadge: '子代理（臨時）',
      workflowModeBadge: '工作流',
      workflowModeHint:
        '「工作流」= 磁碟上有動態工作流運行目錄；「子代理（臨時）」= 普通 Task 工具扇出。effort 等級（ultracode/xhigh）不會記入日誌，所以兩種徽標都不對其作斷言。',
      workflowNativeHint:
        '原生 Claude 的 ultracode 常把編排留在主會話（不寫 agent 檔），因此會出現在「會話 / 用量追蹤」而非此處的列。會寫 agent 檔的運行，其 Claude 成本顯示在編排行。（已記入後續版本待辦。）',
      orchestration: '主會話編排',
      commonTaskPrefix: '共同任務文字',
      thinkingShare: '思考佔比',
      effortHint: '思考佔比偏高——此類任務可考慮用 /effort high 取代 xhigh。',
      thinkingHidden: '思考已開啟,但此模型(如 Fable 5 / Opus 4.8)不會輸出思考文字,因此無法計算佔比——實際值高於此處顯示。',
      thinkingHiddenShort: '隱藏',
      quotaWarnBanner:
        '5 小時窗口僅剩 {remaining}%。一次工作流運行可能消耗其中很大一部分——建議等待重置後再啟動：中斷的運行會遺失提示快取，重跑成本約高 40%。',
      dismiss: '關閉',
      attribution: '用量追蹤',
      attrDisclaimer:
        '近似值，基於本機的本地會話——不含其他裝置或 claude.ai。以下為用量的獨立特徵，並非分解。',
      attrLargeContext: '{pct}% 的用量處於 >150k 上下文',
      attrLargeContextShort: '>150k 上下文',
      attrLargeContextHint: '長上下文即使有快取也更貴。任務中用 /compact，切換任務時用 /clear。',
      attrLongSessions: '{pct}% 的用量來自活躍 8 小時以上的會話',
      attrLongSessionsShort: '8 小時以上會話',
      attrLongSessionsHint: '通常是背景／循環會話。持續用量累積很快，請確認是有意為之。',
      attrSubagentHeavy: '{pct}% 的用量來自子代理密集的會話',
      attrSubagentHeavyShort: '子代理密集會話',
      attrSubagentHeavyHint: '每個子代理都有自己的請求。請審慎派生——簡單子代理可考慮更便宜的模型。',
      attrWorkflows: '{pct}% 的用量來自工作流運行',
      attrWorkflowsShort: '工作流運行',
      attrWorkflowsHint: '各運行的明細與快取命中率見「工作流」頁籤。',
      attrSkillChar: '{pct}% 的用量來自 {name}',
      attrSkillCharHint: '重型 skill 可縮小範圍，或透過 skill frontmatter 指定更便宜的模型。',
      attrPluginChar: '{pct}% 的用量來自插件「{name}」',
      attrPluginCharHint: '檢視該插件的貢獻——其代理、skill 與 MCP 工具都計入額度。',
      attrSkills: 'Skills',
      attrSubagents: '子代理',
      attrPlugins: '插件',
      attrModels: '模型',
      attrShare: '用量佔比',
      count: '次數',
      scopeDay: '日',
      scopeWeek: '週',
      scopeMonth: '月',
      attrTodayPointer: '詳情見「內容分析」頁籤',
      sessionTitle: '會話',
      sessionActions: '操作',
      copySessionId: '複製會話 ID',
      viewConversation: '檢視這個對話（唯讀）— 重新閱讀你的提示與模型回覆，而不會重新載入到上下文中。',
      copyPath: '複製路徑',
      resumeSession: '恢復此對話 —— 在 Claude Code(同一專案)中重新開啟,或透過終端機 “claude --resume” 繼續先前中斷的會話。',
      resumeInvalid: '無效的會話 ID,無法恢復。',
      sessionFilterCurrent: '目前專案',
      sessionFilterAll: '全部',
      sessionRangeToday: '今天',
      sessionRange7d: '7 天',
      sessionRange30d: '30 天',
      sessionModelAll: '全部模型',
      deleteSession: '刪除會話',
      deleteSessionConfirm: '刪除會話「{name}」？',
      deleteSessionDetail: '對話記錄會移至垃圾桶（可復原）。此擴充功能其餘部分為唯讀。',
      deleteSessionYes: '刪除',
      deleteSessionNotFound: '找不到會話記錄檔。',
      deleteSessionDone: '已刪除「{name}」（已移至垃圾桶）。',
      getAdvice: '取得 AI 建議',
      adviceCardTitle: 'AI 建議',
      adviceCardDesc:
        '先查看本機證據。精確請求預設只含彙總資料；prompt 樣本與個人上下文需另行同意，而且只有按下「傳送」才會送出。',
      optimizerTitle: '用量優化器',
      optimizerDesc:
        '把粗略、半成形的需求，變成可直接貼進 Claude Code 的乾淨 prompt，並附上這個任務建議的 effort / thinking / 模型。',
      optimizerHowto:
        '在下方輸入或貼上草稿，選取需要的調整，再建立精確請求預覽。此步驟不會傳送；只有另按「傳送」才會送出，且只會包含你貼上的文字。',
      optimizerConsent:
        '要建立精確請求預覽嗎？此步驟不會傳送；送往你配置的 API 模型仍需另按一次「傳送」。',
      optimizerEnableBtn: '在設定中啟用',
      optimizerPlaceholder: '貼上要優化的粗略 prompt…',
      optimizerRun: '優化',
      optimizerRunning: '優化中…',
      optimizerCopy: '複製 prompt',
      optimizerCopied: '已複製',
      optimizerResolve: '標出含糊指代',
      optimizerResolveHint:
        '讓模型標出含糊的指代（例如「這個」「那個檔案」「那個 bug」），並要求釐清或標注一個明確假設。',
      optimizerDistil: '壓縮長貼上內容',
      optimizerDistilHint:
        '若草稿貼了很長的日誌／程式碼／文件，壓縮成 Claude 真正需要的部分。',
      optimizerAesthetic: '建議風格方向',
      optimizerAestheticHint:
        '對 UI／視覺／寫作類任務，提出一個具體的風格方向，讓結果不流於通用。',
      optimizerPromptHeading: '優化後 prompt',
      optimizerSettingsHeading: '建議運行設定',
      experimentalBadge: '實驗性',
      adviceNeedsKey: '請先在設定中填入 API 金鑰以使用 AI 建議。',
      adviceGenerating: '正在產生使用建議…',
      adviceFailed: '取得建議失敗',
      adviceScopeOverall: '整體(所有專案)',
      adviceScopePrompt: '選擇建議要聚焦的範圍',
      adviceDemoButton: '查看示範',
      adviceDemoNotice:
        '# 示範 — AI 用量建議預覽\n\n' +
        '> **本檔案是靜態示範,不是真實建議。**\n' +
        '> 下面的內容是手寫的範例,用來展示此功能的輸出風格。\n' +
        '> 它**不是**基於你實際的 Claude Code 用量資料 ——\n' +
        '> 沒有任何資料被送往 API 來產生本內容。\n\n' +
        '### 要取得基於你實際用量的個人化建議:\n\n' +
        '1. 執行 **`Claude Code Usage: Show Usage Details`**\n' +
        '2. 開啟儀表板的 **設定 → 建議** 區段\n' +
        '3. 貼入 OpenAI 相容 API key —— 金鑰只會存於 VS Code SecretStorage\n' +
        '   DeepSeek: [deepseek.com](https://platform.deepseek.com)\n' +
        '4. 重新執行 **`Claude Code Usage: Get AI Usage Advice`**',
      costComposition: '成本構成',
      date: '日期',
      yesterday: '昨日',
      dataDirectory: '資料目錄',
      noDataMessage: '找不到使用資料。請確認 Claude Code 正在執行且設定正確。',
      errorMessage: '載入使用資料時發生錯誤。請檢查您的設定。',
    },
    settings: {
      title: 'Claude Code 使用量設定',
      refreshInterval: '重新整理間隔（秒）',
      dataDirectory: '資料目錄路徑',
      language: '語言',
      decimalPlaces: '小數位數',
    },
  },
  'zh-CN': {
    statusBar: {
      loading: '加载中...',
      noData: '无 Claude Code 数据',
      notRunning: 'Claude Code 未运行',
      error: '错误',
      refreshFailed: '用量刷新失败。请重试或查看诊断日志。',
      currentSession: '当前会话',
    },
    releaseAnnouncement: {
      v230: '新功能：Codex Beta 用量与本地优化建议、与安装版本精确对应的更新说明，并移除已过时的特定模型每周 Opus 选项。',
      v231: '新功能：准确的 Codex 最近 30 天统计、可识别重置的每周额度估算，以及可导出本地 SVG／Markdown 的隐私安全综合活动热力图。',
      v232: '2.3.2 新功能：Claude 与 Codex 的 30／90 天项目活动矩阵、完整图表下钻、保留界面状态的刷新，以及采用固定参考汇率的紧凑币种下拉栏。',
    },
    providers: PROVIDERS['zh-CN'],
    weeklyValue: WEEKLY_VALUE_COPY['zh-CN'],
    popup: {
      title: 'Claude Code 使用量',
      currentSession: '当前会话',
      today: '今日',
      thisMonth: '本月',
      allTime: '所有',
      workspaceToday: '本项目',
      refresh: '刷新',
      autoRefresh: '自动刷新',
      settings: '设置',
      settingsTab: '设置',
      settingsIntro:
        '设置现在都在这里。语言和数据目录仍使用 VS Code 设置；API 密钥存入 VS Code SecretStorage，绝不同步。更改即时生效。',
      secretMigrationFailed:
        '无法把已保存的建议 API 密钥迁入 SecretStorage。用量功能仍可使用，旧密钥也未删除，但 AI 建议尚未配置。请修正旧设置并重新加载窗口。',
      secretMigrationWorkspace:
        '工作区专用 API 密钥无法安全迁移到单一全局 SecretStorage。用量功能仍可使用，但 AI 建议尚未配置。请先复制密钥并从工作区设置中移除，重新加载后在“仪表板设置 → 建议”中输入。',
      settingsResetAll: '全部恢复默认',
      settingsGroupGeneral: '常规',
      settingsGroupProviders: '供应商',
      settingsGroupFeatures: '可选功能',
      settingsGroupStatusBar: '状态栏',
      quotaFormatBuiltIn: '默认',
      quotaFormatFiveHour: '仅 5 小时',
      quotaFormatWeekly: '仅每周',
      quotaFormatCustom: '自定义…',
      quotaFormatShortHelp: '选择简洁布局；“默认”沿用上方额度选项。',
      settingsGroupData: '数据与刷新',
      settingsGroupAdvice: 'AI 建议与优化器',
      adviceEffectiveness: {
        title: 'AI 建议有效性',
        description: '查看每条建议如何从本地观察，经由证据与行动，走到有质量护栏的结果。',
        candidateNotice: 'v2.3.1 候选功能 · 默认关闭 · 不存在默认或后台 AI 请求。',
        spineLabel: '建议证据路径',
        observation: '观察',
        evidence: '证据',
        recommendation: '建议',
        action: '行动',
        result: '结果',
        source: '来源',
        limitations: '限制',
        proxyMetric: '代理指标',
        longSessionSignal: '观察到的用量中，有 {share} 来自长会话。',
        largeContextSignal: '观察到的用量中，有 {share} 发生在大型上下文。',
        frameworkOverheadSignal: '观察到的用量中，{share} 是单独估算的框架注入占比；这不评价用户的写作质量。',
        clearBoundaryRecommendation: '对长时间或大型上下文工作采用更清晰的任务边界。',
        clearBoundaryAction: '任务改变时开始新会话；只有继续同一任务时才压缩上下文。',
        codexLocalRecommendation: '在下一个可比任务前，先查看本地 Codex 结构信号。',
        noEvidenceAdvice: '此范围目前没有基于证据的建议。',
        codexPreviewUnavailable: '隐私安全的 Codex 汇总 payload 预览尚不可用。',
        elapsedTimeProxy: '会话首尾跨度是代理指标，不是实测的活跃工作时间。',
        qualityGuardrailPending: '质量证据仍待补充，因此目前无法判断建议有效性。',
        payloadTitle: '密封 payload 快照',
        payloadDescription: '此密封快照就是配置的 BYOK 端点仅在另行点击“发送”后才会收到的确切 UTF-8 JSON body。',
        aggregatesOnly: '仅汇总数据',
        aggregatesWithPersonalization: '汇总数据 + 明确允许的个人上下文',
        aggregatesWithPromptSamples: '汇总数据 + 明确允许的 prompt 样本',
        payloadBytes: '{bytes} 个 UTF-8 字节',
        promptSamplesIncluded: '包含 {count} 个 prompt 样本',
        previewPayload: '预览密封快照',
        noNetworkTransport: '预览不会发送任何内容；发送需要另行点击。',
        sendPreparedRequest: '发送这份完全相同的请求',
        sendingPreparedRequest: '正在发送…',
        sentPreparedRequest: '已收到结构化建议。',
        aggregateConsentLabel: '允许使用汇总用量数据',
        aggregateConsentHelp: '只包含允许列表内的数值汇总与结构信号——不含 prompt、路径、会话 ID 或逐条记录。',
        promptConsentLabel: '同时包含 prompt 样本与配置的个人上下文',
        promptConsentHelp: '可选且默认关闭。只有另行明确同意后，才会加入有数量和长度限制的 prompt 文本及配置的个人上下文。',
        promptWindowHelp: '早于所配置 {days} 天证据窗口的 prompt 样本不会包含。',
        feedbackTitle: '本地反馈',
        helpful: '有用',
        notHelpful: '无用',
        applied: '已应用',
        snooze: '暂停 7 天',
        resume: '再次显示',
        snoozedUntil: '暂停至 {date}',
        feedbackLocalOnly: '只存储在此设备上，绝不加入远程 payload。',
        feedbackSaveFailed: '无法在本地保存反馈。未发送任何内容。',
        comparisonTitle: '可比任务结果',
        comparablePairs: '{count} 组可比任务',
        minimumComparablePairs: '至少需要 {minimum} 组可比任务，才能下结论。',
        insufficientEvidence: '证据不足，无法下结论。',
        qualityGuardrailFailed: '质量护栏未通过，因此不声称建议有效。',
        improved: '改善达到预先声明的门槛，且质量护栏保持通过。',
        noDemonstratedImprovement: '尚未证明有改善；这不代表造成伤害，也不建立因果关系。',
        clearLocalData: '清除本地建议数据',
        clearLocalDataConfirm: '要清除此设备上保存的建议同意、反馈、可比配对和比较结果吗？',
        strictOutputRejected: '结构化模型输出被拒绝，因此未创建任何建议。',
      },
      totalTokens: '总 Token 数',
      inputTokens: '输入 Token',
      outputTokens: '输出 Token',
      cacheCreation: '输入缓存（未命中）',
      cacheRead: '输入缓存（命中）',
      cost: '成本',
      messages: '消息数',
      modelBreakdown: '模型使用量',
      dailyBreakdown: '每日使用量',
      monthlyBreakdown: '每月使用量',
      hourlyBreakdown: '每小时使用量',
      sessions: '会话',
      sessionBreakdown: '各会话使用量',
      project: '项目',
      startTime: '开始时间',
      duration: '时长',
      activeDuration: '活跃时长',
      activeDurationHelp: '估算的实际操作时间——把各轮之间的间隔加总，每段空闲间隔上限 1.5 小时，避免长时间中断灌水，同时把阅读／审阅时间也算进去。（时长是首尾完整跨度。）',
      hour: '小时',
      projects: '项目',
      projectBreakdown: '各项目使用量',
      fullPath: '完整路径',
      peakContext: '峰值上下文',
      tokenComposition: 'Token 组成',
      lastActive: '最近活动',
      pricing: '计费标准',
      refreshPricing: '更新 Token 单价',
      pricingUpdated: '价格已更新',
      pricingUpdateFailed: '价格更新失败',
      sortHint: '点击列标题可排序',
      quota: '用量额度',
      quotaWindow: '时间窗口',
      quotaLimit: '上限',
      quota5h: '5 小时',
      quotaWeekly: '每周',
      quotaAllModels: '全部',
      quotaScoped: '按模型',
      quotaCredits: '使用额度',
      quotaHint: '来自 Anthropic /usage 的真实数据。',
      contextWindow: '上下文窗口',
      contextHint: '切换任务用 /clear',
      contextHintCompact: '同任务可 /compact',
      contextLeft: '上下文余量',
      contentAnalysis: '内容分析',
      estimatedNote: '由文本长度估算 —— 相对占比可靠,绝对数值为近似值。',
      calibratedNote: '已校准：各类别占比由文本长度估算,再缩放到精确的账单 token 总量（输出侧 / 输入＋缓存写入侧）。用 analysis.calibrate 切换。',
      calibratedTokens: '已校准 token',
      thinkingTokensCalibrated: '真实思考 token（已校准）',
      byTool: '各工具结果用量',
      catUserPrompts: '你的提问',
      catAssistantText: '助手回复',
      catAssistantThinking: '助手思考',
      catToolCalls: '工具调用',
      catToolResults: '工具结果',
      estTokens: '估算 Token',
      share: '占比',
      resets: '重置',
      cacheHitRate: '缓存命中率',
      last30days: '近 30 天',
      branches: '分支',
      branchBreakdown: '各分支使用量',
      branch: '分支',
      workflows: '工作流',
      workflowBreakdown: '各工作流使用量',
      workflowName: '工作流',
      model: '模型',
      agents: '代理数',
      agent: '代理',
      workflowsLast30Days: '最近 30 天工作流',
      workflowLast30DaysCostShare: '占最近 30 天成本',
      workflowCacheHint:
        '缓存命中率 = 缓存读取 ÷ 全部输入侧 token。原生 Claude 工作流可在代理间复用提示缓存（命中率高）；不支持跨代理缓存的供应商约为 0%——同样的工作流在那里的成本会高出许多。',
      adhocBadge: '子代理（临时）',
      workflowModeBadge: '工作流',
      workflowModeHint:
        '「工作流」= 磁盘上有动态工作流运行目录；「子代理（临时）」= 普通 Task 工具扇出。effort 等级（ultracode/xhigh）不会记入日志，所以两种徽标都不对其作断言。',
      workflowNativeHint:
        '原生 Claude 的 ultracode 常把编排留在主会话（不写 agent 文件），因此会出现在「会话 / 用量追踪」而非此处的行。会写 agent 文件的运行，其 Claude 成本显示在编排行。（已记入后续版本待办。）',
      orchestration: '主会话编排',
      commonTaskPrefix: '共同任务文字',
      thinkingShare: '思考占比',
      effortHint: '思考占比偏高——此类任务可考虑用 /effort high 取代 xhigh。',
      thinkingHidden: '思考已开启,但此模型(如 Fable 5 / Opus 4.8)不会输出思考文字,因此无法计算占比——实际值高于此处显示。',
      thinkingHiddenShort: '隐藏',
      quotaWarnBanner:
        '5 小时窗口仅剩 {remaining}%。一次工作流运行可能消耗其中很大一部分——建议等待重置后再启动：中断的运行会丢失提示缓存，重跑成本约高 40%。',
      dismiss: '关闭',
      attribution: '用量追踪',
      attrDisclaimer:
        '近似值，基于本机的本地会话——不含其他设备或 claude.ai。以下为用量的独立特征，并非分解。',
      attrLargeContext: '{pct}% 的用量处于 >150k 上下文',
      attrLargeContextShort: '>150k 上下文',
      attrLargeContextHint: '长上下文即使有缓存也更贵。任务中用 /compact，切换任务时用 /clear。',
      attrLongSessions: '{pct}% 的用量来自活跃 8 小时以上的会话',
      attrLongSessionsShort: '8 小时以上会话',
      attrLongSessionsHint: '通常是后台／循环会话。持续用量累积很快，请确认是有意为之。',
      attrSubagentHeavy: '{pct}% 的用量来自子代理密集的会话',
      attrSubagentHeavyShort: '子代理密集会话',
      attrSubagentHeavyHint: '每个子代理都有自己的请求。请审慎派生——简单子代理可考虑更便宜的模型。',
      attrWorkflows: '{pct}% 的用量来自工作流运行',
      attrWorkflowsShort: '工作流运行',
      attrWorkflowsHint: '各运行的明细与缓存命中率见「工作流」页签。',
      attrSkillChar: '{pct}% 的用量来自 {name}',
      attrSkillCharHint: '重型 skill 可缩小范围，或通过 skill frontmatter 指定更便宜的模型。',
      attrPluginChar: '{pct}% 的用量来自插件「{name}」',
      attrPluginCharHint: '检视该插件的贡献——其代理、skill 与 MCP 工具都计入额度。',
      attrSkills: 'Skills',
      attrSubagents: '子代理',
      attrPlugins: '插件',
      attrModels: '模型',
      attrShare: '用量占比',
      count: '次数',
      scopeDay: '日',
      scopeWeek: '周',
      scopeMonth: '月',
      attrTodayPointer: '详情见「内容分析」页签',
      sessionTitle: '会话',
      sessionActions: '操作',
      copySessionId: '复制会话 ID',
      viewConversation: '查看这个对话（只读）— 重新阅读你的提示词和模型回复，而不会重新载入到上下文中。',
      copyPath: '复制路径',
      resumeSession: '恢复此对话 —— 在 Claude Code(同一项目)中重新打开,或通过终端 “claude --resume” 继续之前中断的会话。',
      resumeInvalid: '无效的会话 ID,无法恢复。',
      sessionFilterCurrent: '当前工程',
      sessionFilterAll: '全部',
      sessionRangeToday: '今天',
      sessionRange7d: '7 天',
      sessionRange30d: '30 天',
      sessionModelAll: '全部模型',
      deleteSession: '删除会话',
      deleteSessionConfirm: '删除会话「{name}」？',
      deleteSessionDetail: '对话日志将移至回收站（可恢复）。本扩展其余部分为只读。',
      deleteSessionYes: '删除',
      deleteSessionNotFound: '未找到会话日志文件。',
      deleteSessionDone: '已删除「{name}」（已移至回收站）。',
      getAdvice: '获取 AI 建议',
      adviceCardTitle: 'AI 建议',
      adviceCardDesc:
        '先查看本地证据。精确请求默认只含汇总数据；prompt 样本与个人上下文需另行同意，而且只有点击“发送”才会发出。',
      optimizerTitle: '用量优化器',
      optimizerDesc:
        '把粗略、没成形的需求，变成可以直接粘进 Claude Code 的干净 prompt，并附上这个任务建议的 effort / thinking / 模型。',
      optimizerHowto:
        '在下方输入或粘贴草稿，选择需要的调整，再生成精确请求预览。此步骤不会发送；只有另点“发送”才会发出，且只会包含你粘贴的文字。',
      optimizerConsent:
        '要生成精确请求预览吗？此步骤不会发送；发送到你配置的 API 模型仍需另点一次“发送”。',
      optimizerEnableBtn: '在设置中启用',
      optimizerPlaceholder: '粘贴要优化的粗略 prompt…',
      optimizerRun: '优化',
      optimizerRunning: '优化中…',
      optimizerCopy: '复制 prompt',
      optimizerCopied: '已复制',
      optimizerResolve: '标出含糊指代',
      optimizerResolveHint:
        '让模型标出含糊的指代（比如「这个」「那个文件」「那个 bug」），并要求你澄清，或标注一个明确的假设。',
      optimizerDistil: '压缩长粘贴内容',
      optimizerDistilHint:
        '如果草稿里粘了很长的日志／代码／文档，压缩成 Claude 真正需要的部分。',
      optimizerAesthetic: '建议风格方向',
      optimizerAestheticHint:
        '对 UI／视觉／写作类任务，给出一个具体的风格方向，让结果不那么千篇一律。',
      optimizerPromptHeading: '优化后 prompt',
      optimizerSettingsHeading: '建议运行设置',
      experimentalBadge: '实验性',
      adviceNeedsKey: '请先在设置中填入 API 密钥以使用 AI 建议。',
      adviceGenerating: '正在生成使用建议…',
      adviceFailed: '获取建议失败',
      adviceScopeOverall: '整体(所有项目)',
      adviceScopePrompt: '选择建议要聚焦的范围',
      adviceDemoButton: '查看示例',
      adviceDemoNotice:
        '# 示例 — AI 用量建议预览\n\n' +
        '> **本文件是静态示例,不是真实建议。**\n' +
        '> 下面的内容是手写的样例,用来展示此功能的输出风格。\n' +
        '> 它**不是**基于你实际的 Claude Code 用量数据 ——\n' +
        '> 没有任何数据被发往 API 来生成本内容。\n\n' +
        '### 要获得基于你实际用量的个性化建议:\n\n' +
        '1. 运行 **`Claude Code Usage: Show Usage Details`**\n' +
        '2. 打开仪表板的 **设置 → 建议** 区域\n' +
        '3. 填入 OpenAI 兼容 API key —— 密钥只存入 VS Code SecretStorage\n' +
        '   DeepSeek: [deepseek.com](https://platform.deepseek.com)\n' +
        '4. 重新运行 **`Claude Code Usage: Get AI Usage Advice`**',
      costComposition: '成本构成',
      date: '日期',
      yesterday: '昨日',
      dataDirectory: '数据目录',
      noDataMessage: '找不到使用数据。请确认 Claude Code 正在运行且配置正确。',
      errorMessage: '加载使用数据时发生错误。请检查您的配置。',
    },
    settings: {
      title: 'Claude Code 使用量设置',
      refreshInterval: '刷新间隔（秒）',
      dataDirectory: '数据目录路径',
      language: '语言',
      decimalPlaces: '小数位数',
    },
  },
  ja: {
    statusBar: {
      loading: '読み込み中...',
      noData: 'Claude Code データなし',
      notRunning: 'Claude Code 未実行',
      error: 'エラー',
      refreshFailed: '使用量の更新に失敗しました。再試行するか診断ログを確認してください。',
      currentSession: '現在のセッション',
    },
    releaseAnnouncement: {
      v230: '新機能：Codex Beta の使用量とローカル最適化ガイド、完全なバージョンに対応するリリース通知、および古いモデル別の週間 Opus オプションの削除。',
      v231: '新機能：正確な Codex の直近 30 日集計、リセットを考慮した週間枠の推定、ローカル SVG／Markdown 共有に対応したプライバシー保護の統合アクティビティヒートマップ。',
      v232: '2.3.2 の新機能：Claude と Codex の30／90日プロジェクト活動マトリクス、完全なチャートドリルダウン、状態を保つ更新、固定参照レートのコンパクトな通貨選択。',
    },
    providers: PROVIDERS.ja,
    weeklyValue: WEEKLY_VALUE_COPY.ja,
    popup: {
      title: 'Claude Code 使用量',
      currentSession: '現在のセッション',
      today: '今日',
      thisMonth: '今月',
      allTime: 'すべて',
      workspaceToday: 'このプロジェクト',
      refresh: '更新',
      autoRefresh: '自動更新',
      settings: '設定',
      settingsTab: '設定',
      settingsIntro:
        '設定はここにまとまりました。言語とデータディレクトリは VS Code 設定を使い、API キーは同期されない VS Code SecretStorage に保存されます。変更は即時反映されます。',
      secretMigrationFailed:
        '保存済みのアドバイス API キーを SecretStorage に移動できませんでした。使用量表示は利用でき、旧キーも削除されていませんが、AI アドバイスは未設定です。旧設定を修正してウィンドウを再読み込みしてください。',
      secretMigrationWorkspace:
        'ワークスペース固有の API キーを単一のグローバル SecretStorage に安全に移行できません。使用量表示は利用できますが、AI アドバイスは未設定です。キーをコピーしてワークスペース設定から削除し、再読み込み後に「ダッシュボード設定 → アドバイス」で入力してください。',
      settingsResetAll: 'すべて既定値に戻す',
      settingsGroupGeneral: '一般',
      settingsGroupProviders: 'プロバイダー',
      settingsGroupFeatures: 'オプション機能',
      settingsGroupStatusBar: 'ステータスバー',
      quotaFormatBuiltIn: '標準',
      quotaFormatFiveHour: '5時間のみ',
      quotaFormatWeekly: '週のみ',
      quotaFormatCustom: 'カスタム…',
      quotaFormatShortHelp: '簡潔な表示を選択します。「標準」は上の利用枠設定を使います。',
      settingsGroupData: 'データと更新',
      settingsGroupAdvice: 'AI アドバイス & オプティマイザー',
      adviceEffectiveness: {
        title: 'AI アドバイスの有効性',
        description: '各提案がローカルの観察から根拠と行動を経て、品質ガードレール付きの結果に至る流れを確認します。',
        candidateNotice: 'v2.3.1 候補機能 · デフォルトは無効 · 既定またはバックグラウンドの AI リクエストはありません。',
        spineLabel: 'アドバイスの根拠経路',
        observation: '観察',
        evidence: '根拠',
        recommendation: 'アドバイス',
        action: '行動',
        result: '結果',
        source: '情報源',
        limitations: '制約',
        proxyMetric: '代理指標',
        longSessionSignal: '観測された使用量のうち {share} は長時間セッションから生じました。',
        largeContextSignal: '観測された使用量のうち {share} は大きなコンテキストで生じました。',
        frameworkOverheadSignal: '観測された使用量のうち {share} は、別途推定したフレームワーク注入の割合です。ユーザーの文章品質を評価するものではありません。',
        clearBoundaryRecommendation: '長時間または大きなコンテキストの作業では、タスク境界をより明確にします。',
        clearBoundaryAction: 'タスクが変わったら新しいセッションを開始し、同じタスクを続ける場合にだけコンテキストを圧縮します。',
        codexLocalRecommendation: '次の比較可能なタスクの前に、ローカルの Codex 構造シグナルを確認します。',
        noEvidenceAdvice: 'この範囲には、根拠に基づくアドバイスがありません。',
        codexPreviewUnavailable: 'プライバシーを保護した Codex 集計 payload のプレビューは、まだ利用できません。',
        elapsedTimeProxy: 'セッションの経過範囲は代理指標であり、実測した作業時間ではありません。',
        qualityGuardrailPending: '品質の根拠が未確定のため、有効性について結論を出せません。',
        payloadTitle: '封印済み payload スナップショット',
        payloadDescription: 'この封印済みスナップショットは、別の送信クリック後にだけ設定済み BYOK エンドポイントが受け取る UTF-8 JSON body と完全に同一です。',
        aggregatesOnly: '集計データのみ',
        aggregatesWithPersonalization: '集計データ + 明示的に許可した個人コンテキスト',
        aggregatesWithPromptSamples: '集計データ + 明示的に許可したプロンプト例',
        payloadBytes: '{bytes} UTF-8 バイト',
        promptSamplesIncluded: '{count} 件のプロンプト例を含む',
        previewPayload: '封印済みスナップショットをプレビュー',
        noNetworkTransport: 'プレビューでは何も送信されません。送信には別のクリックが必要です。',
        sendPreparedRequest: 'この同一リクエストを送信',
        sendingPreparedRequest: '送信中…',
        sentPreparedRequest: '構造化された助言を受信しました。',
        aggregateConsentLabel: '集計使用データを許可する',
        aggregateConsentHelp: '許可リスト内の数値集計と構造シグナルだけを含み、プロンプト、パス、セッション ID、個別レコードは含みません。',
        promptConsentLabel: 'プロンプト例と設定済み個人コンテキストも含める',
        promptConsentHelp: '任意で、デフォルトは無効です。この独立した明示的同意の後にだけ、件数と長さを制限したプロンプト本文と設定済み個人コンテキストを追加します。',
        promptWindowHelp: '設定した {days} 日間の根拠期間より古いプロンプト例は除外します。',
        feedbackTitle: 'ローカルフィードバック',
        helpful: '役に立った',
        notHelpful: '役に立たなかった',
        applied: '適用済み',
        snooze: '7日間保留',
        resume: '再表示',
        snoozedUntil: '{date} まで保留',
        feedbackLocalOnly: 'この端末だけに保存され、リモート payload には追加されません。',
        feedbackSaveFailed: 'フィードバックをローカルに保存できませんでした。何も送信されていません。',
        comparisonTitle: '比較可能なタスクの結果',
        comparablePairs: '{count} 組の比較可能なタスク',
        minimumComparablePairs: '結論を出す前に、少なくとも {minimum} 組の比較可能なタスクが必要です。',
        insufficientEvidence: '結論を出すには根拠が不足しています。',
        qualityGuardrailFailed: '品質ガードレールを満たさなかったため、有効性を主張しません。',
        improved: '品質ガードレールを保ったまま、事前に定めた改善基準に達しました。',
        noDemonstratedImprovement: '改善は実証されていません。これは害や因果関係を示すものではありません。',
        clearLocalData: 'ローカルのアドバイスデータを消去',
        clearLocalDataConfirm: 'この端末に保存された同意、フィードバック、比較可能ペア、比較結果を消去しますか？',
        strictOutputRejected: '構造化されたモデル出力を拒否しました。アドバイスは作成されていません。',
      },
      totalTokens: '総トークン数',
      inputTokens: '入力トークン',
      outputTokens: '出力トークン',
      cacheCreation: '入力キャッシュ（ミス）',
      cacheRead: '入力キャッシュ（ヒット）',
      cost: 'コスト',
      messages: 'メッセージ数',
      modelBreakdown: 'モデル別使用量',
      dailyBreakdown: '日別使用量',
      monthlyBreakdown: '月別使用量',
      hourlyBreakdown: '時間別使用量',
      sessions: 'セッション',
      sessionBreakdown: 'セッション別使用量',
      project: 'プロジェクト',
      startTime: '開始時刻',
      duration: '期間',
      activeDuration: 'アクティブ',
      activeDurationHelp: '実作業時間の推定——各ターン間の間隔を合計し、アイドルは1回あたり1.5時間で上限を設けて長い中断で膨らまないようにしつつ、読む／レビューの時間も算入します。（期間は最初から最後までの全体です。）',
      hour: '時刻',
      projects: 'プロジェクト',
      projectBreakdown: 'プロジェクト別使用量',
      fullPath: 'フルパス',
      peakContext: '最大コンテキスト',
      tokenComposition: 'トークン構成',
      lastActive: '最終アクティブ',
      pricing: '料金',
      refreshPricing: 'Token 単価を更新',
      pricingUpdated: '価格を更新しました',
      pricingUpdateFailed: '価格の更新に失敗しました',
      sortHint: '列見出しをクリックで並べ替え',
      quota: '使用枠',
      quotaWindow: '期間',
      quotaLimit: '上限',
      quota5h: '5時間',
      quotaWeekly: '週間',
      quotaAllModels: '全体',
      quotaScoped: 'モデル別',
      quotaCredits: '使用クレジット',
      quotaHint: 'Anthropic /usage からの実データ。',
      contextWindow: 'コンテキストウィンドウ',
      contextHint: 'タスク切替 → /clear',
      contextHintCompact: '同じタスク → /compact',
      contextLeft: 'コンテキスト残り',
      contentAnalysis: 'コンテンツ',
      estimatedNote: 'テキスト長からの推定値 — 相対割合は信頼でき、絶対値は概算です。',
      calibratedNote: 'キャリブレーション済み：カテゴリ別の割合はテキスト長から推定し、正確な請求トークン総量（出力側 / 入力＋キャッシュ書込側）にスケールしています。analysis.calibrate で切替。',
      calibratedTokens: 'キャリブレーション済みトークン',
      thinkingTokensCalibrated: '実際の思考トークン（キャリブレーション済み）',
      byTool: 'ツール別の結果使用量',
      catUserPrompts: 'あなたの入力',
      catAssistantText: 'アシスタント応答',
      catAssistantThinking: 'アシスタント思考',
      catToolCalls: 'ツール呼び出し',
      catToolResults: 'ツール結果',
      estTokens: '推定トークン',
      share: '割合',
      resets: 'リセット',
      cacheHitRate: 'キャッシュヒット率',
      last30days: '過去 30 日',
      branches: 'ブランチ',
      branchBreakdown: 'ブランチ別使用量',
      branch: 'ブランチ',
      workflows: 'ワークフロー',
      workflowBreakdown: 'ワークフロー別使用量',
      workflowName: 'ワークフロー',
      model: 'モデル',
      agents: 'エージェント数',
      agent: 'エージェント',
      workflowsLast30Days: '過去30日間のワークフロー',
      workflowLast30DaysCostShare: '過去30日間のコストに占める割合',
      workflowCacheHint:
        'キャッシュヒット率 = キャッシュ読取 ÷ 入力側トークン全体。ネイティブ Claude のワークフローはエージェント間でプロンプトキャッシュを再利用します（高い率）。エージェント間キャッシュのないプロバイダーでは約 0% となり、同じワークフローのコストが大幅に高くなります。',
      adhocBadge: 'サブエージェント（アドホック）',
      workflowModeBadge: 'ワークフロー',
      workflowModeHint:
        '「ワークフロー」= ディスク上に動的ワークフローの実行ディレクトリがある場合；「サブエージェント（アドホック）」= 単純な Task ツールのファンアウト。effort レベル（ultracode/xhigh）はログに記録されないため、どちらのバッジもそれを主張しません。',
      workflowNativeHint:
        'ネイティブ Claude の ultracode はオーケストレーションをメインセッションに保持する（エージェントファイルなし）ことが多く、ここではなく「セッション / 使用量トラッキング」に表示されます。エージェントファイルを書く実行は、その Claude コストをオーケストレーション行に表示します。（今後のリリースで対応予定。）',
      orchestration: 'メインセッションのオーケストレーション',
      commonTaskPrefix: '共通タスクテキスト',
      thinkingShare: '思考割合',
      effortHint: '思考割合が高め — このようなタスクでは xhigh ではなく /effort high の利用を検討してください。',
      thinkingHidden: '思考は有効でしたが、このモデル(Fable 5 / Opus 4.8 など)は思考テキストを出力しないため割合を測定できません — 実際の値は表示より高くなります。',
      thinkingHiddenShort: '非表示',
      quotaWarnBanner:
        '5 時間ウィンドウの残りは {remaining}% のみです。ワークフロー実行はその大部分を消費する可能性があります — リセットを待つことを検討してください。中断された実行はプロンプトキャッシュを失い、再実行は約 40% 高くなります。',
      dismiss: '閉じる',
      attribution: '使用量トラッキング',
      attrDisclaimer:
        'このマシンのローカルセッションに基づく概算 — 他のデバイスや claude.ai は含みません。これらは使用量の独立した特徴であり、内訳ではありません。',
      attrLargeContext: '使用量の {pct}% が >150k コンテキストでした',
      attrLargeContextShort: '>150k コンテキスト',
      attrLargeContextHint:
        '長いコンテキストはキャッシュがあっても高コストです。タスク中は /compact、タスク切替時は /clear を。',
      attrLongSessions: '使用量の {pct}% が 8 時間以上アクティブなセッションからでした',
      attrLongSessionsShort: '8時間以上のセッション',
      attrLongSessionsHint:
        '多くはバックグラウンド／ループセッションです。継続的な使用はすぐ積み上がるため、意図的か確認してください。',
      attrSubagentHeavy: '使用量の {pct}% がサブエージェント中心のセッションからでした',
      attrSubagentHeavyShort: 'サブエージェント中心セッション',
      attrSubagentHeavyHint:
        '各サブエージェントは独自のリクエストを実行します。生成は慎重に — 単純なものには安価なモデルの利用も検討を。',
      attrWorkflows: '使用量の {pct}% がワークフロー実行からでした',
      attrWorkflowsShort: 'ワークフロー実行',
      attrWorkflowsHint: '実行ごとの詳細とキャッシュヒット率はワークフロータブへ。',
      attrSkillChar: '使用量の {pct}% が {name} からでした',
      attrSkillCharHint: '重いスキルは範囲を絞るか、skill frontmatter で安価なモデルを指定できます。',
      attrPluginChar: '使用量の {pct}% がプラグイン「{name}」からでした',
      attrPluginCharHint:
        'このプラグインの寄与を確認してください — エージェント、スキル、MCP ツールはすべて制限にカウントされます。',
      attrSkills: 'スキル',
      attrSubagents: 'サブエージェント',
      attrPlugins: 'プラグイン',
      attrModels: 'モデル',
      attrShare: '使用量比率',
      count: '回数',
      scopeDay: '日',
      scopeWeek: '週',
      scopeMonth: '月',
      attrTodayPointer: '詳細はコンテンツタブへ',
      sessionTitle: 'セッション',
      sessionActions: '操作',
      copySessionId: 'セッションIDをコピー',
      viewConversation: 'この会話を表示（読み取り専用）— プロンプトとモデルの回答を、コンテキストに再読み込みせずに読み返せます。',
      copyPath: 'パスをコピー',
      resumeSession: 'この会話を再開 — Claude Code(同じプロジェクト)で開き直すか、ターミナルで "claude --resume" を実行し、中断したところから続けます。',
      resumeInvalid: '無効なセッションIDのため再開できません。',
      sessionFilterCurrent: '現在のプロジェクト',
      sessionFilterAll: 'すべて',
      sessionRangeToday: '今日',
      sessionRange7d: '7日間',
      sessionRange30d: '30日間',
      sessionModelAll: 'すべてのモデル',
      deleteSession: 'セッションを削除',
      deleteSessionConfirm: 'セッション「{name}」を削除しますか？',
      deleteSessionDetail: '会話ログはゴミ箱に移動します（復元可能）。この拡張機能は他の部分では読み取り専用です。',
      deleteSessionYes: '削除',
      deleteSessionNotFound: 'セッションのログファイルが見つかりません。',
      deleteSessionDone: '「{name}」を削除しました（ゴミ箱に移動）。',
      getAdvice: 'AI アドバイスを取得',
      adviceCardTitle: 'AI アドバイス',
      adviceCardDesc:
        'まずローカルの根拠を確認します。正確なリクエストは既定で集計のみです。プロンプト例と個人コンテキストには別の同意が必要で、「送信」を押すまで何も送られません。',
      optimizerTitle: '使用量オプティマイザー',
      optimizerDesc:
        '雑で半端な依頼を、Claude Code にそのまま貼り付けられる整ったプロンプトに変換し、そのタスクに推奨の effort / thinking / モデルも返します。',
      optimizerHowto:
        '下に下書きを入力または貼り付け、必要な調整を選んで正確なリクエストをプレビューします。この段階では送信されません。別途「送信」を押した場合のみ、貼り付けたテキストが含まれます。',
      optimizerConsent:
        '正確なリクエストをプレビューしますか？この操作では送信されません。設定した API モデルへの送信には別のクリックが必要です。',
      optimizerEnableBtn: '設定で有効化',
      optimizerPlaceholder: '最適化する雑なプロンプトを貼り付け…',
      optimizerRun: '最適化',
      optimizerRunning: '最適化中…',
      optimizerCopy: 'プロンプトをコピー',
      optimizerCopied: 'コピー済み',
      optimizerResolve: '曖昧な参照を指摘',
      optimizerResolveHint:
        '曖昧な参照（「これ」「そのファイル」「あのバグ」など）をモデルに指摘させ、明確化を求めるか、明示的な前提を置きます。',
      optimizerDistil: '長い貼付内容を要約',
      optimizerDistilHint:
        '下書きに長いログ／コード／ドキュメントが貼られている場合、Claude に必要な部分だけに圧縮します。',
      optimizerAesthetic: 'スタイル方向を提案',
      optimizerAestheticHint:
        'UI／ビジュアル／文章のタスクでは、結果が無難になりすぎないよう具体的なスタイル方向を提案します。',
      optimizerPromptHeading: '最適化されたプロンプト',
      optimizerSettingsHeading: '推奨実行設定',
      experimentalBadge: '実験的',
      adviceNeedsKey: '設定で API キーを入力してください。',
      adviceGenerating: '使用アドバイスを生成中…',
      adviceFailed: 'アドバイスの取得に失敗しました',
      adviceScopeOverall: '全体(全プロジェクト)',
      adviceScopePrompt: 'アドバイスの対象範囲を選択',
      adviceDemoButton: 'デモを見る',
      adviceDemoNotice:
        '# デモ — AI 使用アドバイス プレビュー\n\n' +
        '> **このファイルは静的デモであり、実際のアドバイスではありません。**\n' +
        '> 以下の内容は、この機能がどのような出力を生成するかを示すために\n' +
        '> 手書きされたサンプルです。あなたの実際の Claude Code 使用データ\n' +
        '> に基づくものでは**ありません** —— この内容を生成するために\n' +
        '> API にデータは送信されていません。\n\n' +
        '### あなたの実際の使用量に基づくパーソナライズされたアドバイスを取得するには:\n\n' +
        '1. **`Claude Code Usage: Show Usage Details`** を実行\n' +
        '2. ダッシュボードの **設定 → アドバイス** を開く\n' +
        '3. OpenAI 互換 API キーを貼り付け —— VS Code SecretStorage のみに保存されます\n' +
        '   DeepSeek: [deepseek.com](https://platform.deepseek.com)\n' +
        '4. **`Claude Code Usage: Get AI Usage Advice`** を再実行',
      costComposition: 'コスト構成',
      date: '日付',
      yesterday: '昨日',
      dataDirectory: 'データディレクトリ',
      noDataMessage: '使用データが見つかりません。Claude Code が実行され、正しく設定されていることを確認してください。',
      errorMessage: '使用データの読み込み中にエラーが発生しました。設定を確認してください。',
    },
    settings: {
      title: 'Claude Code 使用量設定',
      refreshInterval: '更新間隔（秒）',
      dataDirectory: 'データディレクトリパス',
      language: '言語',
      decimalPlaces: '小数点以下桁数',
    },
  },
  ko: {
    statusBar: {
      loading: '로딩 중...',
      noData: 'Claude Code 데이터 없음',
      notRunning: 'Claude Code 실행되지 않음',
      error: '오류',
      refreshFailed: '사용량 새로 고침에 실패했습니다. 다시 시도하거나 진단 로그를 확인하세요.',
      currentSession: '현재 세션',
    },
    releaseAnnouncement: {
      v230: '새 기능: Codex Beta 사용량과 로컬 최적화 안내, 설치된 전체 버전에 맞는 릴리스 알림, 그리고 오래된 모델별 주간 Opus 옵션 제거.',
      v231: '새 기능: 정확한 Codex 최근 30일 통계, 재설정을 인식하는 주간 한도 추정, 로컬 SVG/Markdown 공유를 지원하는 개인정보 보호 통합 활동 히트맵.',
      v232: '2.3.2 새 기능: Claude와 Codex의 30/90일 프로젝트 활동 매트릭스, 완전한 차트 드릴다운, 상태를 보존하는 새로 고침, 고정 기준 환율의 간결한 통화 선택.',
    },
    providers: PROVIDERS.ko,
    weeklyValue: WEEKLY_VALUE_COPY.ko,
    popup: {
      title: 'Claude Code 사용량',
      currentSession: '현재 세션',
      today: '오늘',
      thisMonth: '이번 달',
      allTime: '전체',
      workspaceToday: '이 프로젝트',
      refresh: '새로고침',
      autoRefresh: '자동 새로고침',
      settings: '설정',
      settingsTab: '설정',
      settingsIntro:
        '설정이 이제 여기로 모였습니다. 언어와 데이터 디렉터리는 VS Code 설정을 사용하고, API 키는 동기화되지 않는 VS Code SecretStorage에 저장됩니다. 변경은 즉시 적용됩니다.',
      secretMigrationFailed:
        '저장된 조언 API 키를 SecretStorage로 옮기지 못했습니다. 사용량 기능은 계속 사용할 수 있고 기존 키도 삭제되지 않았지만 AI 조언은 설정되지 않았습니다. 기존 설정을 수정하고 창을 다시 로드하세요.',
      secretMigrationWorkspace:
        '작업 영역별 API 키는 하나의 전역 SecretStorage 항목으로 안전하게 이전할 수 없습니다. 사용량 기능은 계속 사용할 수 있지만 AI 조언은 설정되지 않았습니다. 키를 복사해 작업 영역 설정에서 제거하고, 다시 로드한 후 대시보드 설정 → 조언에 입력하세요.',
      settingsResetAll: '모두 기본값으로',
      settingsGroupGeneral: '일반',
      settingsGroupProviders: '공급자',
      settingsGroupFeatures: '선택 기능',
      settingsGroupStatusBar: '상태 표시줄',
      quotaFormatBuiltIn: '기본',
      quotaFormatFiveHour: '5시간만',
      quotaFormatWeekly: '주간만',
      quotaFormatCustom: '사용자 지정…',
      quotaFormatShortHelp: '간결한 표시를 선택하세요. 기본은 위의 한도 옵션을 따릅니다.',
      settingsGroupData: '데이터 및 새로고침',
      settingsGroupAdvice: 'AI 조언 & 옵티마이저',
      adviceEffectiveness: {
        title: 'AI 조언 효과성',
        description: '각 제안이 로컬 관찰에서 근거와 행동을 거쳐 품질 가드레일이 있는 결과로 이어지는 과정을 확인합니다.',
        candidateNotice: 'v2.3.1 후보 기능 · 기본적으로 꺼짐 · 기본 또는 백그라운드 AI 요청 없음.',
        spineLabel: '조언 근거 경로',
        observation: '관찰',
        evidence: '근거',
        recommendation: '조언',
        action: '행동',
        result: '결과',
        source: '출처',
        limitations: '제한 사항',
        proxyMetric: '프록시 지표',
        longSessionSignal: '관찰된 사용량 중 {share}가 긴 세션에서 발생했습니다.',
        largeContextSignal: '관찰된 사용량 중 {share}가 큰 컨텍스트에서 발생했습니다.',
        frameworkOverheadSignal: '관찰된 사용량 중 {share}는 별도로 추정한 프레임워크 주입 비중이며, 사용자의 글쓰기 품질을 평가하지 않습니다.',
        clearBoundaryRecommendation: '오래 걸리거나 컨텍스트가 큰 작업에는 더 명확한 작업 경계를 사용하세요.',
        clearBoundaryAction: '작업이 바뀌면 새 세션을 시작하고, 같은 작업을 계속할 때만 컨텍스트를 압축하세요.',
        codexLocalRecommendation: '다음 비교 가능한 작업 전에 로컬 Codex 구조 신호를 검토하세요.',
        noEvidenceAdvice: '이 범위에는 근거 기반 조언이 없습니다.',
        codexPreviewUnavailable: '개인정보를 보호하는 Codex 집계 payload 미리보기는 아직 사용할 수 없습니다.',
        elapsedTimeProxy: '세션의 시작과 끝 사이 시간은 프록시이며, 실제로 측정한 활성 작업 시간이 아닙니다.',
        qualityGuardrailPending: '품질 근거가 아직 준비되지 않아 효과성 결론을 내릴 수 없습니다.',
        payloadTitle: '봉인된 payload 스냅샷',
        payloadDescription: '이 봉인된 스냅샷은 별도의 보내기 클릭 후에만 설정된 BYOK 엔드포인트가 받는 UTF-8 JSON body와 정확히 같습니다.',
        aggregatesOnly: '집계 데이터만',
        aggregatesWithPersonalization: '집계 데이터 + 명시적으로 허용한 개인 컨텍스트',
        aggregatesWithPromptSamples: '집계 데이터 + 명시적으로 허용한 프롬프트 샘플',
        payloadBytes: '{bytes} UTF-8바이트',
        promptSamplesIncluded: '프롬프트 샘플 {count}개 포함',
        previewPayload: '봉인된 스냅샷 미리보기',
        noNetworkTransport: '미리보기는 아무것도 보내지 않습니다. 전송하려면 별도로 클릭해야 합니다.',
        sendPreparedRequest: '이 동일한 요청 보내기',
        sendingPreparedRequest: '전송 중…',
        sentPreparedRequest: '구조화된 조언을 받았습니다.',
        aggregateConsentLabel: '집계 사용량 데이터 허용',
        aggregateConsentHelp: '허용 목록의 수치 집계와 구조 신호만 포함하며 프롬프트, 경로, 세션 ID, 개별 레코드는 포함하지 않습니다.',
        promptConsentLabel: '프롬프트 샘플과 설정된 개인 컨텍스트도 포함',
        promptConsentHelp: '선택 사항이며 기본적으로 꺼져 있습니다. 이 별도의 명시적 동의 후에만 제한된 프롬프트 텍스트와 설정된 개인 컨텍스트를 추가합니다.',
        promptWindowHelp: '설정한 {days}일 근거 기간보다 오래된 프롬프트 샘플은 제외합니다.',
        feedbackTitle: '로컬 피드백',
        helpful: '유용함',
        notHelpful: '유용하지 않음',
        applied: '적용함',
        snooze: '7일간 숨기기',
        resume: '다시 표시',
        snoozedUntil: '{date}까지 숨김',
        feedbackLocalOnly: '이 기기에만 저장되며 원격 payload에는 절대 추가되지 않습니다.',
        feedbackSaveFailed: '피드백을 로컬에 저장하지 못했습니다. 아무것도 전송되지 않았습니다.',
        comparisonTitle: '비교 가능한 작업 결과',
        comparablePairs: '비교 가능한 작업 쌍 {count}개',
        minimumComparablePairs: '결론을 내리기 전에 비교 가능한 작업 쌍이 최소 {minimum}개 필요합니다.',
        insufficientEvidence: '결론을 내리기에 근거가 부족합니다.',
        qualityGuardrailFailed: '품질 가드레일을 충족하지 못했으므로 효과성을 주장하지 않습니다.',
        improved: '품질 가드레일을 유지하면서 사전에 정한 개선 기준을 충족했습니다.',
        noDemonstratedImprovement: '개선이 입증되지 않았습니다. 이는 피해나 인과관계를 뜻하지 않습니다.',
        clearLocalData: '로컬 조언 데이터 지우기',
        clearLocalDataConfirm: '이 기기에 저장된 조언 동의, 피드백, 비교 쌍 및 비교 결과를 지우시겠습니까?',
        strictOutputRejected: '구조화된 모델 출력을 거부했습니다. 조언이 생성되지 않았습니다.',
      },
      totalTokens: '총 토큰 수',
      inputTokens: '입력 토큰',
      outputTokens: '출력 토큰',
      cacheCreation: '입력 캐시 (미스)',
      cacheRead: '입력 캐시 (히트)',
      cost: '비용',
      messages: '메시지 수',
      modelBreakdown: '모델별 사용량',
      dailyBreakdown: '일별 사용량',
      monthlyBreakdown: '월별 사용량',
      hourlyBreakdown: '시간별 사용량',
      sessions: '세션',
      sessionBreakdown: '세션별 사용량',
      project: '프로젝트',
      startTime: '시작 시간',
      duration: '사용 시간',
      activeDuration: '활성 시간',
      activeDurationHelp: '실제 작업 시간 추정 — 턴 사이 간격을 합산하되, 유휴 간격은 1.5시간으로 상한을 두어 긴 중단이 부풀리지 않게 하면서 읽기/검토 시간은 포함합니다. (사용 시간은 처음부터 끝까지 전체 구간입니다.)',
      hour: '시각',
      projects: '프로젝트',
      projectBreakdown: '프로젝트별 사용량',
      fullPath: '전체 경로',
      peakContext: '최대 컨텍스트',
      tokenComposition: '토큰 구성',
      lastActive: '마지막 활동',
      pricing: '요금',
      refreshPricing: '토큰 단가 업데이트',
      pricingUpdated: '가격이 업데이트됨',
      pricingUpdateFailed: '가격 업데이트 실패',
      sortHint: '열 머리글을 클릭하여 정렬',
      quota: '사용 한도',
      quotaWindow: '기간',
      quotaLimit: '한도',
      quota5h: '5시간',
      quotaWeekly: '주간',
      quotaAllModels: '전체',
      quotaScoped: '모델별',
      quotaCredits: '사용 크레딧',
      quotaHint: 'Anthropic /usage의 실제 데이터입니다.',
      contextWindow: '컨텍스트 윈도우',
      contextHint: '작업 전환 → /clear',
      contextHintCompact: '같은 작업 → /compact',
      contextLeft: '컨텍스트 여유',
      contentAnalysis: '콘텐츠',
      estimatedNote: '텍스트 길이로 추정 — 상대 비율은 신뢰할 수 있고 절대값은 근사치입니다.',
      calibratedNote: '보정됨: 카테고리별 비율은 텍스트 길이로 추정하고, 정확한 청구 토큰 총량(출력 측 / 입력＋캐시 쓰기 측)에 맞춰 스케일했습니다. analysis.calibrate로 전환.',
      calibratedTokens: '보정된 토큰',
      thinkingTokensCalibrated: '실제 사고 토큰(보정됨)',
      byTool: '도구별 결과 사용량',
      catUserPrompts: '내 입력',
      catAssistantText: '어시스턴트 응답',
      catAssistantThinking: '어시스턴트 사고',
      catToolCalls: '도구 호출',
      catToolResults: '도구 결과',
      estTokens: '추정 토큰',
      share: '비율',
      resets: '재설정',
      cacheHitRate: '캐시 적중률',
      last30days: '최근 30일',
      branches: '브랜치',
      branchBreakdown: '브랜치별 사용량',
      branch: '브랜치',
      workflows: '워크플로',
      workflowBreakdown: '워크플로별 사용량',
      workflowName: '워크플로',
      model: '모델',
      agents: '에이전트 수',
      agent: '에이전트',
      workflowsLast30Days: '최근 30일 워크플로',
      workflowLast30DaysCostShare: '최근 30일 비용 중 비율',
      workflowCacheHint:
        '캐시 적중률 = 캐시 읽기 ÷ 전체 입력측 토큰. 네이티브 Claude 워크플로는 에이전트 간 프롬프트 캐시를 재사용합니다(높은 적중률). 에이전트 간 캐시가 없는 공급자는 약 0%로, 같은 워크플로 비용이 훨씬 더 많이 듭니다.',
      adhocBadge: '서브에이전트(애드혹)',
      workflowModeBadge: '워크플로',
      workflowModeHint:
        '"워크플로" = 디스크에 동적 워크플로 실행 디렉터리가 있는 경우; "서브에이전트(애드혹)" = 일반 Task 도구 팬아웃. effort 수준(ultracode/xhigh)은 로그에 기록되지 않으므로 어느 배지도 이를 주장하지 않습니다.',
      workflowNativeHint:
        '네이티브 Claude의 ultracode는 오케스트레이션을 메인 세션에 두는 경우가 많아(에이전트 파일 없음) 여기 대신 "세션 / 사용량 추적"에 표시됩니다. 에이전트 파일을 쓰는 실행은 Claude 비용을 오케스트레이션 행에 표시합니다. (향후 릴리스에서 처리 예정.)',
      orchestration: '메인 세션 오케스트레이션',
      commonTaskPrefix: '공통 작업 텍스트',
      thinkingShare: '사고 비율',
      effortHint: '사고 비율이 높습니다 — 이런 작업에는 xhigh 대신 /effort high를 고려하세요.',
      thinkingHidden: '사고가 켜져 있었지만 이 모델(예: Fable 5 / Opus 4.8)은 사고 텍스트를 노출하지 않아 비율을 측정할 수 없습니다 — 실제 값은 표시된 것보다 높습니다.',
      thinkingHiddenShort: '숨김',
      quotaWarnBanner:
        '5시간 윈도우가 {remaining}%만 남았습니다. 워크플로 실행은 그중 큰 부분을 소비할 수 있습니다 — 리셋을 기다리는 것을 고려하세요. 중단된 실행은 프롬프트 캐시를 잃어 재실행 비용이 약 40% 더 듭니다.',
      dismiss: '닫기',
      attribution: '사용량 추적',
      attrDisclaimer:
        '이 기기의 로컬 세션 기반 근사치 — 다른 기기나 claude.ai는 포함되지 않습니다. 사용량의 독립적인 특성이며, 분해가 아닙니다.',
      attrLargeContext: '사용량의 {pct}%가 >150k 컨텍스트에서 발생했습니다',
      attrLargeContextShort: '>150k 컨텍스트',
      attrLargeContextHint:
        '긴 컨텍스트는 캐시가 있어도 더 비쌉니다. 작업 중에는 /compact, 작업 전환 시에는 /clear를 사용하세요.',
      attrLongSessions: '사용량의 {pct}%가 8시간 이상 활성 세션에서 발생했습니다',
      attrLongSessionsShort: '8시간 이상 세션',
      attrLongSessionsHint:
        '대개 백그라운드/루프 세션입니다. 지속적인 사용은 빠르게 누적되니 의도된 것인지 확인하세요.',
      attrSubagentHeavy: '사용량의 {pct}%가 서브에이전트 중심 세션에서 발생했습니다',
      attrSubagentHeavyShort: '서브에이전트 중심 세션',
      attrSubagentHeavyHint:
        '각 서브에이전트는 자체 요청을 실행합니다. 신중하게 생성하고, 단순한 작업에는 저렴한 모델을 고려하세요.',
      attrWorkflows: '사용량의 {pct}%가 워크플로 실행에서 발생했습니다',
      attrWorkflowsShort: '워크플로 실행',
      attrWorkflowsHint: '실행별 세부 정보와 캐시 적중률은 워크플로 탭에서 확인하세요.',
      attrSkillChar: '사용량의 {pct}%가 {name}에서 발생했습니다',
      attrSkillCharHint: '무거운 스킬은 범위를 줄이거나 skill frontmatter로 저렴한 모델을 지정할 수 있습니다.',
      attrPluginChar: '사용량의 {pct}%가 플러그인 "{name}"에서 발생했습니다',
      attrPluginCharHint:
        '이 플러그인의 기여를 검토하세요 — 에이전트, 스킬, MCP 도구 모두 한도에 포함됩니다.',
      attrSkills: '스킬',
      attrSubagents: '서브에이전트',
      attrPlugins: '플러그인',
      attrModels: '모델',
      attrShare: '사용량 비율',
      count: '횟수',
      scopeDay: '일',
      scopeWeek: '주',
      scopeMonth: '월',
      attrTodayPointer: '자세한 내용은 콘텐츠 탭에서',
      sessionTitle: '세션',
      sessionActions: '작업',
      copySessionId: '세션 ID 복사',
      viewConversation: '이 대화 보기(읽기 전용) — 프롬프트와 모델 답변을 컨텍스트에 다시 불러오지 않고 다시 읽어볼 수 있습니다.',
      copyPath: '경로 복사',
      resumeSession: '이 대화 재개 — Claude Code(같은 프로젝트)에서 다시 열거나 터미널에서 "claude --resume"으로 중단한 지점부터 이어갑니다.',
      resumeInvalid: '잘못된 세션 ID입니다 — 재개할 수 없습니다.',
      sessionFilterCurrent: '현재 프로젝트',
      sessionFilterAll: '전체',
      sessionRangeToday: '오늘',
      sessionRange7d: '7일',
      sessionRange30d: '30일',
      sessionModelAll: '전체 모델',
      deleteSession: '세션 삭제',
      deleteSessionConfirm: '세션 "{name}"을(를) 삭제할까요?',
      deleteSessionDetail: '대화 로그가 휴지통으로 이동합니다(복구 가능). 확장 프로그램은 그 외에는 읽기 전용입니다.',
      deleteSessionYes: '삭제',
      deleteSessionNotFound: '세션 로그 파일을 찾을 수 없습니다.',
      deleteSessionDone: '"{name}"을(를) 삭제했습니다(휴지통으로 이동).',
      getAdvice: 'AI 조언 받기',
      adviceCardTitle: 'AI 조언',
      adviceCardDesc:
        '먼저 로컬 근거를 확인합니다. 정확한 요청은 기본적으로 집계만 포함하며, 프롬프트 샘플과 개인 컨텍스트는 별도 동의가 필요하고 「전송」을 누르기 전에는 아무것도 보내지 않습니다.',
      optimizerTitle: '사용량 옵티마이저',
      optimizerDesc:
        '대략적이고 정리되지 않은 요청을 Claude Code에 바로 붙여넣을 수 있는 깔끔한 프롬프트로 바꾸고, 그 작업에 추천하는 effort / thinking / 모델도 함께 제공합니다.',
      optimizerHowto:
        '아래에 초안을 입력하거나 붙여넣고 필요한 옵션을 고른 뒤 정확한 요청을 미리 봅니다. 이 단계에서는 전송되지 않으며, 별도로 「전송」을 눌렀을 때만 붙여넣은 텍스트가 포함됩니다.',
      optimizerConsent:
        '정확한 요청을 미리 볼까요? 이 단계에서는 아무것도 보내지 않으며, 설정한 API 모델로 보내려면 별도의 클릭이 필요합니다.',
      optimizerEnableBtn: '설정에서 사용',
      optimizerPlaceholder: '최적화할 대략적인 프롬프트 붙여넣기…',
      optimizerRun: '최적화',
      optimizerRunning: '최적화 중…',
      optimizerCopy: '프롬프트 복사',
      optimizerCopied: '복사됨',
      optimizerResolve: '모호한 참조 표시',
      optimizerResolveHint:
        "모호한 참조(예: '이것', '그 파일', '그 버그')를 모델이 짚어내 명확히 하거나 분명한 가정을 표시하게 합니다.",
      optimizerDistil: '긴 붙여넣기 내용 압축',
      optimizerDistilHint:
        '초안에 긴 로그/코드/문서가 붙어 있으면 Claude에 필요한 부분만 압축합니다.',
      optimizerAesthetic: '스타일 방향 제안',
      optimizerAestheticHint:
        'UI/비주얼/글쓰기 작업에서는 결과가 평범해지지 않도록 구체적인 스타일 방향을 제안합니다.',
      optimizerPromptHeading: '최적화된 프롬프트',
      optimizerSettingsHeading: '추천 실행 설정',
      experimentalBadge: '실험적',
      adviceNeedsKey: '설정에서 API 키를 입력하세요.',
      adviceGenerating: '사용 조언 생성 중…',
      adviceFailed: '조언을 가져오지 못했습니다',
      adviceScopeOverall: '전체(모든 프로젝트)',
      adviceScopePrompt: '조언 범위를 선택하세요',
      adviceDemoButton: '데모 보기',
      adviceDemoNotice:
        '# 데모 — AI 사용 조언 미리보기\n\n' +
        '> **이 파일은 정적 데모이며, 실제 조언이 아닙니다.**\n' +
        '> 아래 내용은 이 기능이 어떤 종류의 출력을 생성하는지 보여주기\n' +
        '> 위해 직접 작성된 샘플입니다. 실제 Claude Code 사용 데이터에\n' +
        '> 기반하지 **않으며**, 이 내용을 생성하기 위해 API에 데이터가\n' +
        '> 전송된 적이 없습니다.\n\n' +
        '### 실제 사용량 기반의 맞춤형 조언을 받으려면:\n\n' +
        '1. **`Claude Code Usage: Show Usage Details`** 실행\n' +
        '2. 대시보드의 **설정 → 조언** 섹션 열기\n' +
        '3. OpenAI 호환 API 키 붙여넣기 — VS Code SecretStorage에만 저장됩니다\n' +
        '   DeepSeek: [deepseek.com](https://platform.deepseek.com)\n' +
        '4. **`Claude Code Usage: Get AI Usage Advice`** 다시 실행',
      costComposition: '비용 구성',
      date: '날짜',
      yesterday: '어제',
      dataDirectory: '데이터 디렉토리',
      noDataMessage: '사용 데이터를 찾을 수 없습니다. Claude Code가 실행 중이고 올바르게 구성되었는지 확인하세요.',
      errorMessage: '사용 데이터를 로드하는 중 오류가 발생했습니다. 구성을 확인하세요.',
    },
    settings: {
      title: 'Claude Code 사용량 설정',
      refreshInterval: '새로고침 간격 (초)',
      dataDirectory: '데이터 디렉토리 경로',
      language: '언어',
      decimalPlaces: '소수점 자릿수',
    },
  },
  'pt-BR': {
    statusBar: {
      loading: 'Carregando...',
      noData: 'Sem dados do Claude Code',
      notRunning: 'Claude Code não está em execução',
      error: 'Erro',
      refreshFailed: 'Falha ao atualizar o uso. Tente novamente ou verifique os logs de diagnóstico.',
      currentSession: 'Sessão',
    },
    releaseAnnouncement: {
      v230: 'Novidades: uso do Codex Beta e orientações locais de otimização, avisos da versão exata instalada e remoção da opção semanal obsoleta do Opus por modelo.',
      v231: 'Novidades: totais corretos dos últimos 30 dias do Codex, estimativas semanais cientes de redefinições e um mapa de calor combinado e privado com exportação local em SVG e Markdown.',
      v232: 'Novidades da 2.3.2: matriz de atividade por projeto em 30/90 dias para Claude e Codex, detalhamento completo dos gráficos, atualização que preserva o estado e seletor compacto de moeda com taxas de referência fixas.',
    },
    providers: PROVIDERS['pt-BR'],
    weeklyValue: WEEKLY_VALUE_COPY['pt-BR'],
    popup: {
      title: 'Uso do Claude Code',
      currentSession: 'Sessão atual',
      today: 'Hoje',
      thisMonth: 'Este mês',
      allTime: 'Todo o período',
      workspaceToday: 'Este projeto',
      refresh: 'Atualizar',
      autoRefresh: 'Atualização automática',
      settings: 'Configurações',
      settingsTab: 'Configurações',
      settingsIntro:
        'As configurações agora ficam aqui. Idioma e diretórios de dados continuam nas Configurações do VS Code; chaves de API ficam no VS Code SecretStorage e nunca são sincronizadas. As alterações são aplicadas imediatamente.',
      secretMigrationFailed:
        'Não foi possível mover a chave de API de conselho salva para o SecretStorage. O uso continua disponível e a chave antiga não foi excluída, mas o conselho de IA não está configurado. Corrija a configuração antiga e recarregue a janela.',
      secretMigrationWorkspace:
        'Uma chave de API específica do espaço de trabalho não pode ser migrada com segurança para uma única entrada global do SecretStorage. O uso continua disponível, mas o conselho de IA não está configurado. Copie a chave, remova-a das configurações do espaço de trabalho, recarregue e informe-a em Configurações do painel → Conselho.',
      settingsResetAll: 'Restaurar tudo para os padrões',
      settingsGroupGeneral: 'Geral',
      settingsGroupProviders: 'Provedores',
      settingsGroupFeatures: 'Recursos opcionais',
      settingsGroupStatusBar: 'Barra de status',
      quotaFormatBuiltIn: 'Padrão',
      quotaFormatFiveHour: 'Só 5 horas',
      quotaFormatWeekly: 'Só semanal',
      quotaFormatCustom: 'Personalizado…',
      quotaFormatShortHelp: 'Escolha um layout compacto. Padrão mantém as opções de limite acima.',
      settingsGroupData: 'Dados e atualização',
      settingsGroupAdvice: 'Conselho de IA e Optimizer',
      adviceEffectiveness: {
        title: 'Eficácia dos conselhos de IA',
        description: 'Revise como cada sugestão passa de uma observação local para evidências, uma ação e um resultado com proteção de qualidade.',
        candidateNotice: 'Candidato v2.3.1 · desativado por padrão · sem solicitações de IA padrão ou em segundo plano.',
        spineLabel: 'Trilha de evidências do conselho',
        observation: 'Observação',
        evidence: 'Evidência',
        recommendation: 'Conselho',
        action: 'Ação',
        result: 'Resultado',
        source: 'Fonte',
        limitations: 'Limitações',
        proxyMetric: 'Métrica proxy',
        longSessionSignal: '{share} do uso observado veio de sessões longas.',
        largeContextSignal: '{share} do uso observado ocorreu com contextos grandes.',
        frameworkOverheadSignal: '{share} do uso observado corresponde à parcela estimada separadamente de injeção do framework; isso não avalia a qualidade da escrita do usuário.',
        clearBoundaryRecommendation: 'Use limites de tarefa mais claros em trabalhos longos ou com contexto grande.',
        clearBoundaryAction: 'Inicie uma nova sessão quando a tarefa mudar; compacte apenas ao continuar a mesma tarefa.',
        codexLocalRecommendation: 'Revise o sinal estrutural local do Codex antes da próxima tarefa comparável.',
        noEvidenceAdvice: 'Não há conselho baseado em evidências disponível para este escopo.',
        codexPreviewUnavailable: 'Uma prévia de payload agregado do Codex que preserve a privacidade ainda não está disponível.',
        elapsedTimeProxy: 'O intervalo decorrido da sessão é um proxy, não tempo de trabalho ativo medido.',
        qualityGuardrailPending: 'As evidências de qualidade estão pendentes; portanto, ainda não há conclusão sobre eficácia.',
        payloadTitle: 'Snapshot de payload selado',
        payloadDescription: 'Este snapshot selado é exatamente o body JSON em UTF-8 que o endpoint BYOK configurado recebe somente após um clique separado em Enviar.',
        aggregatesOnly: 'Somente agregados',
        aggregatesWithPersonalization: 'Agregados + contexto pessoal permitido explicitamente',
        aggregatesWithPromptSamples: 'Agregados + amostras de prompt permitidas explicitamente',
        payloadBytes: '{bytes} bytes UTF-8',
        promptSamplesIncluded: '{count} amostras de prompt incluídas',
        previewPayload: 'Visualizar snapshot selado',
        noNetworkTransport: 'A prévia não envia nada. O envio exige um clique separado.',
        sendPreparedRequest: 'Enviar esta solicitação exata',
        sendingPreparedRequest: 'Enviando…',
        sentPreparedRequest: 'Conselho estruturado recebido.',
        aggregateConsentLabel: 'Permitir dados agregados de uso',
        aggregateConsentHelp: 'Inclui somente agregados numéricos e sinais estruturais da lista permitida — sem prompts, caminhos, IDs de sessão ou registros individuais.',
        promptConsentLabel: 'Incluir amostras de prompt e contexto pessoal configurado',
        promptConsentHelp: 'Opcional e desativado por padrão. Texto de prompt limitado e contexto pessoal configurado só são adicionados após este consentimento explícito separado.',
        promptWindowHelp: 'Amostras de prompt anteriores à janela de evidências configurada de {days} dias são excluídas.',
        feedbackTitle: 'Feedback local',
        helpful: 'Útil',
        notHelpful: 'Não útil',
        applied: 'Aplicado',
        snooze: 'Adiar por 7 dias',
        resume: 'Mostrar novamente',
        snoozedUntil: 'Adiado até {date}',
        feedbackLocalOnly: 'Armazenado somente neste dispositivo e nunca adicionado a um payload remoto.',
        feedbackSaveFailed: 'Não foi possível salvar o feedback localmente. Nada foi enviado.',
        comparisonTitle: 'Resultados de tarefas comparáveis',
        comparablePairs: '{count} pares de tarefas comparáveis',
        minimumComparablePairs: 'São necessários pelo menos {minimum} pares de tarefas comparáveis antes de chegar a uma conclusão.',
        insufficientEvidence: 'Não há evidências suficientes para chegar a uma conclusão.',
        qualityGuardrailFailed: 'A proteção de qualidade não foi mantida, portanto nenhuma eficácia é afirmada.',
        improved: 'A melhoria atingiu o limite pré-declarado enquanto a proteção de qualidade foi mantida.',
        noDemonstratedImprovement: 'Nenhuma melhoria foi demonstrada; isso não estabelece dano nem causalidade.',
        clearLocalData: 'Limpar dados locais de conselho',
        clearLocalDataConfirm: 'Limpar consentimentos, feedback, pares comparáveis e resultados de comparação armazenados neste dispositivo?',
        strictOutputRejected: 'A saída estruturada do modelo foi rejeitada. Nenhum conselho foi criado.',
      },
      totalTokens: 'Total de tokens',
      inputTokens: 'Tokens de entrada',
      outputTokens: 'Tokens de saída',
      cacheCreation: 'Cache de entrada (Miss)',
      cacheRead: 'Cache de entrada (Hit)',
      cost: 'Custo',
      messages: 'Mensagens',
      modelBreakdown: 'Uso por modelo',
      dailyBreakdown: 'Uso diário',
      monthlyBreakdown: 'Uso mensal',
      hourlyBreakdown: 'Uso por hora',
      sessions: 'Sessões',
      sessionBreakdown: 'Uso por sessão',
      project: 'Projeto',
      startTime: 'Início',
      duration: 'Duração',
      activeDuration: 'Ativo',
      activeDurationHelp: 'Tempo de uso estimado — a soma dos intervalos entre turnos, com cada intervalo ocioso limitado a 1,5 h para que pausas longas não o inflem, mas o tempo de leitura / revisão ainda conta. (Duração é o intervalo completo do início ao fim.)',
      hour: 'Hora',
      projects: 'Projetos',
      projectBreakdown: 'Uso por projeto',
      fullPath: 'Caminho completo',
      peakContext: 'Pico de contexto',
      tokenComposition: 'Composição de tokens',
      lastActive: 'Última atividade',
      pricing: 'Preços',
      refreshPricing: 'Atualizar preço dos tokens',
      pricingUpdated: 'Preços atualizados',
      pricingUpdateFailed: 'Falha ao atualizar preços',
      sortHint: 'Clique no cabeçalho da coluna para ordenar',
      quota: 'Cota',
      quotaWindow: 'Janela',
      quotaLimit: 'Limite',
      quota5h: '5 horas',
      quotaWeekly: 'Semanal',
      quotaAllModels: 'Todos',
      quotaScoped: 'Por modelo',
      quotaCredits: 'Créditos de uso',
      quotaHint: 'Dados reais da Anthropic /usage.',
      contextWindow: 'Janela de contexto',
      contextHint: 'Nova tarefa → /clear',
      contextHintCompact: 'Mesma tarefa → /compact',
      contextLeft: 'Contexto restante',
      contentAnalysis: 'Conteúdo',
      estimatedNote: 'Estimado pelo tamanho do texto — as proporções relativas são confiáveis; os valores absolutos são aproximados.',
      calibratedNote: 'Calibrado: as proporções por categoria vêm do tamanho do texto, ajustadas aos totais exatos de tokens cobrados (lado da saída / lado da entrada + escrita de cache). Alterne com analysis.calibrate.',
      calibratedTokens: 'Tokens calibrados',
      thinkingTokensCalibrated: 'tokens reais de raciocínio (calibrado)',
      byTool: 'Resultados de ferramentas por ferramenta',
      catUserPrompts: 'Seus prompts',
      catAssistantText: 'Respostas do assistente',
      catAssistantThinking: 'Raciocínio do assistente',
      catToolCalls: 'Chamadas de ferramenta',
      catToolResults: 'Resultados de ferramenta',
      estTokens: 'Tokens estimados',
      share: 'Proporção',
      resets: 'Reinicia em',
      cacheHitRate: 'Taxa de acerto do cache',
      last30days: 'Últimos 30 dias',
      branches: 'Branches',
      branchBreakdown: 'Uso por branch',
      branch: 'Branch',
      workflows: 'Workflows',
      workflowBreakdown: 'Uso por workflow',
      workflowName: 'Workflow',
      model: 'Modelo',
      agents: 'Agentes',
      agent: 'Agente',
      workflowsLast30Days: 'Workflows nos últimos 30 dias',
      workflowLast30DaysCostShare: 'dos custos dos últimos 30 dias',
      workflowCacheHint:
        'Taxa de acerto do cache = leituras de cache ÷ todos os tokens do lado da entrada. Workflows nativos do Claude reaproveitam o cache de prompt entre agentes (taxa alta); um provedor sem cache entre agentes mostra ~0% — o mesmo workflow custa desproporcionalmente mais nele.',
      adhocBadge: 'subagentes (ad-hoc)',
      workflowModeBadge: 'workflow',
      workflowModeHint:
        '"workflow" = um diretório de execução de workflow dinâmico em disco; "subagentes (ad-hoc)" = um disparo simples da ferramenta Task. O nível de esforço (ultracode/xhigh) não é registrado nos logs, então nenhum dos selos afirma um.',
      workflowNativeHint:
        'O ultracode nativo do Claude muitas vezes mantém a orquestração na sessão principal (sem arquivos de agente), então aparece em Sessões / Uso em vez de como uma linha aqui. Execuções que gravam arquivos de agente mostram seu custo Claude na linha de orquestração. (Previsto para uma versão futura.)',
      orchestration: 'orquestração na sessão principal',
      commonTaskPrefix: 'Texto de tarefa compartilhado',
      thinkingShare: '% de raciocínio',
      effortHint: 'Alta proporção de raciocínio — considere /effort high em vez de xhigh para tarefas como esta.',
      thinkingHidden: 'O raciocínio estava ativo, mas este modelo (por ex. Fable 5 / Opus 4.8) não expõe o texto do raciocínio, então a proporção não pode ser medida — o valor real é maior que o exibido.',
      thinkingHiddenShort: 'oculto',
      quotaWarnBanner:
        'Resta apenas {remaining}% da sua janela de 5 horas. Uma execução de workflow pode consumir grande parte dela — considere esperar o reset: execuções interrompidas perdem o cache de prompt e refazem ~40% mais caro.',
      dismiss: 'Dispensar',
      attribution: 'Acompanhamento de uso',
      attrDisclaimer:
        'Aproximado, baseado nas sessões locais desta máquina — não inclui outros dispositivos nem o claude.ai. São características independentes do seu uso, não uma decomposição.',
      attrLargeContext: '{pct}% do seu uso foi com contexto >150k',
      attrLargeContextShort: 'contexto >150k',
      attrLargeContextHint:
        'Sessões mais longas são mais caras mesmo com cache. Use /compact no meio da tarefa e /clear ao mudar para novas tarefas.',
      attrLongSessions: '{pct}% do seu uso veio de sessões ativas por 8+ horas',
      attrLongSessionsShort: 'sessões de 8h+',
      attrLongSessionsHint:
        'Costumam ser sessões em segundo plano/loop. O uso contínuo soma rápido, então confirme se é intencional.',
      attrSubagentHeavy: '{pct}% do seu uso veio de sessões com muitos subagentes',
      attrSubagentHeavyShort: 'Sessões com muitos subagentes',
      attrSubagentHeavyHint:
        'Cada subagente executa suas próprias requisições. Seja deliberado ao criá-los — e considere um modelo mais barato para subagentes mais simples.',
      attrWorkflows: '{pct}% do seu uso veio de execuções de workflow',
      attrWorkflowsShort: 'Execuções de workflow',
      attrWorkflowsHint: 'Veja a aba Workflows para detalhes por execução e taxas de acerto de cache.',
      attrSkillChar: '{pct}% do seu uso veio de {name}',
      attrSkillCharHint: 'Skills pesadas podem ter o escopo reduzido ou rodar com um modelo mais barato via frontmatter da skill.',
      attrPluginChar: '{pct}% do seu uso veio do plugin "{name}"',
      attrPluginCharHint:
        'Revise o que este plugin contribui — seus agentes, skills e ferramentas MCP contam para o seu limite.',
      attrSkills: 'Skills',
      attrSubagents: 'Subagentes',
      attrPlugins: 'Plugins',
      attrModels: 'Modelos',
      attrShare: '% do uso',
      count: 'Quantidade',
      scopeDay: 'Dia',
      scopeWeek: 'Semana',
      scopeMonth: 'Mês',
      attrTodayPointer: 'Detalhes: aba Conteúdo',
      sessionTitle: 'Sessão',
      sessionActions: 'Ações',
      copySessionId: 'Copiar ID da sessão',
      viewConversation: 'Ver esta conversa (somente leitura) — releia seus prompts e as respostas do modelo sem recarregá-los no contexto.',
      copyPath: 'Copiar caminho',
      resumeSession: 'Retomar esta conversa — reabre no Claude Code (mesmo projeto) ou num terminal via "claude --resume", para continuar de onde parou.',
      resumeInvalid: 'ID de sessão inválido — não é possível retomar.',
      sessionFilterCurrent: 'Projeto atual',
      sessionFilterAll: 'Todos',
      sessionRangeToday: 'Hoje',
      sessionRange7d: '7 dias',
      sessionRange30d: '30 dias',
      sessionModelAll: 'Todos os modelos',
      deleteSession: 'Excluir sessão',
      deleteSessionConfirm: 'Excluir a sessão "{name}"?',
      deleteSessionDetail: 'O log da conversa vai para a lixeira (recuperável). A extensão é somente leitura no restante.',
      deleteSessionYes: 'Excluir',
      deleteSessionNotFound: 'Arquivo de log da sessão não encontrado.',
      deleteSessionDone: 'Sessão "{name}" excluída (movida para a lixeira).',
      getAdvice: 'Obter conselho de IA',
      adviceCardTitle: 'Conselho de IA',
      adviceCardDesc:
        'Revise primeiro as evidências locais. A solicitação exata usa apenas agregados por padrão; amostras de prompts e contexto pessoal exigem consentimento separado, e nada é enviado até você clicar em Enviar.',
      optimizerTitle: 'Otimizador de uso',
      optimizerDesc:
        'Transforme um pedido rascunhado e malformado em um prompt limpo para colar direto no Claude Code — além de um esforço / raciocínio / modelo sugeridos para a tarefa.',
      optimizerHowto:
        'Digite ou cole seu rascunho abaixo, escolha os ajustes opcionais e gere a visualização da solicitação exata. Nada é enviado até um clique separado em Enviar; somente o texto colado pode ser incluído.',
      optimizerConsent:
        'Gerar a visualização da solicitação exata? Isso não envia nada; o envio ao modelo de API configurado exige outro clique.',
      optimizerEnableBtn: 'Ativar nas configurações',
      optimizerPlaceholder: 'Cole um prompt rascunhado para otimizar…',
      optimizerRun: 'Otimizar',
      optimizerRunning: 'Otimizando…',
      optimizerCopy: 'Copiar prompt',
      optimizerCopied: 'Copiado',
      optimizerResolve: 'Sinalizar referências vagas',
      optimizerResolveHint:
        'Faça o modelo apontar referências vagas (ex.: "isto", "o arquivo", "aquele bug") e defini-las ou marcar uma suposição clara.',
      optimizerDistil: 'Condensar texto longo colado',
      optimizerDistilHint:
        'Se o seu rascunho cola logs / código / docs longos, condense-os ao que o Claude realmente precisa.',
      optimizerAesthetic: 'Sugerir uma direção de estilo',
      optimizerAestheticHint:
        'Para tarefas de UI / visuais / de escrita, proponha uma direção de estilo concreta para o resultado não ficar genérico.',
      optimizerPromptHeading: 'Prompt otimizado',
      optimizerSettingsHeading: 'Configurações de execução recomendadas',
      experimentalBadge: 'experimental',
      adviceNeedsKey: 'Defina uma chave de API nas configurações para usar o conselho de IA.',
      adviceGenerating: 'Gerando conselho de uso…',
      adviceFailed: 'Falha ao obter conselho',
      adviceScopeOverall: 'Geral (todos os projetos)',
      adviceScopePrompt: 'Escolha o foco do conselho',
      adviceDemoButton: 'Ver demonstração',
      adviceDemoNotice:
        '# DEMO — Prévia do conselho de uso de IA\n\n' +
        '> **Este arquivo é uma demo estática, não um conselho real.**\n' +
        '> O texto abaixo foi escrito manualmente para ilustrar o tipo de saída\n' +
        '> que o recurso produz. Ele **não** é baseado nos seus dados reais de uso\n' +
        '> do Claude Code — nada foi enviado a nenhuma API para gerar isso.\n\n' +
        '### Para obter um conselho real e personalizado com base no SEU uso:\n\n' +
        '1. Execute **`Claude Code Usage: Show Usage Details`**\n' +
        '2. Abra **Configurações → Conselho** no painel\n' +
        '3. Cole uma chave compatível com OpenAI — ela fica apenas no VS Code SecretStorage\n' +
        '   DeepSeek: [deepseek.com](https://platform.deepseek.com)\n' +
        '4. Execute novamente **`Claude Code Usage: Get AI Usage Advice`**',
      costComposition: 'Composição de custos',
      date: 'Data',
      yesterday: 'Ontem',
      dataDirectory: 'Diretório de dados',
      noDataMessage: 'Nenhum dado de uso encontrado. Verifique se o Claude Code está em execução e configurado corretamente.',
      errorMessage: 'Erro ao carregar os dados de uso. Verifique sua configuração.',
    },
    settings: {
      title: 'Configurações de uso do Claude Code',
      refreshInterval: 'Intervalo de atualização (segundos)',
      dataDirectory: 'Caminho do diretório de dados',
      language: 'Idioma',
      decimalPlaces: 'Casas decimais',
    },
  },
  id: {
    statusBar: {
      loading: 'Memuat...',
      noData: 'Tidak Ada Data Claude Code',
      notRunning: 'Claude Code Tidak Berjalan',
      error: 'Error',
      refreshFailed: 'Gagal menyegarkan penggunaan. Coba lagi atau periksa log diagnostik.',
      currentSession: 'Sesi',
    },
    releaseAnnouncement: {
      v230: 'Yang baru: penggunaan Codex Beta dan panduan optimasi lokal, catatan rilis yang sesuai dengan versi lengkap terpasang, serta penghapusan opsi Opus mingguan khusus model yang sudah usang.',
      v231: 'Yang baru: statistik 30 hari Codex yang akurat, estimasi batas mingguan yang mengenali reset, dan heatmap aktivitas gabungan privat dengan ekspor SVG serta Markdown lokal.',
      v232: 'Baru di 2.3.2: matriks aktivitas proyek 30/90 hari untuk Claude dan Codex, drill-down grafik lengkap, refresh yang mempertahankan state, serta pemilih mata uang ringkas dengan kurs referensi tetap.',
    },
    providers: PROVIDERS.id,
    weeklyValue: WEEKLY_VALUE_COPY.id,
    popup: {
      title: 'Claude Code Usage',
      currentSession: 'Sesi Saat Ini',
      today: 'Hari Ini',
      thisMonth: 'Bulan Ini',
      allTime: 'Sepanjang Waktu',
      workspaceToday: 'Proyek ini',
      refresh: 'Segarkan',
      autoRefresh: 'Segarkan otomatis',
      settings: 'Pengaturan',
      settingsTab: 'Pengaturan',
      settingsIntro:
        'Pengaturan sekarang ada di sini. Bahasa dan direktori data tetap memakai Pengaturan VS Code; API key disimpan di VS Code SecretStorage dan tidak pernah disinkronkan. Perubahan langsung diterapkan.',
      secretMigrationFailed:
        'API key saran yang tersimpan tidak dapat dipindahkan ke SecretStorage. Fitur penggunaan tetap tersedia dan key lama tidak dihapus, tetapi saran AI belum dikonfigurasi. Perbaiki pengaturan lama lalu muat ulang jendela.',
      secretMigrationWorkspace:
        'API key khusus workspace tidak dapat dimigrasikan dengan aman ke satu entri SecretStorage global. Fitur penggunaan tetap tersedia, tetapi saran AI belum dikonfigurasi. Salin key, hapus dari pengaturan workspace, muat ulang, kemudian masukkan di Pengaturan Dashboard → Saran.',
      settingsResetAll: 'Kembalikan semua ke default',
      settingsGroupGeneral: 'Umum',
      settingsGroupProviders: 'Penyedia',
      settingsGroupFeatures: 'Fitur opsional',
      settingsGroupStatusBar: 'Status bar',
      quotaFormatBuiltIn: 'Bawaan',
      quotaFormatFiveHour: 'Hanya 5 jam',
      quotaFormatWeekly: 'Hanya mingguan',
      quotaFormatCustom: 'Kustom…',
      quotaFormatShortHelp: 'Pilih tampilan ringkas. Bawaan mengikuti opsi kuota di atas.',
      settingsGroupData: 'Data & penyegaran',
      settingsGroupAdvice: 'Saran AI & Optimizer',
      adviceEffectiveness: {
        title: 'Efektivitas saran AI',
        description: 'Tinjau bagaimana setiap saran bergerak dari pengamatan lokal menuju bukti, tindakan, dan hasil dengan pagar pengaman kualitas.',
        candidateNotice: 'Kandidat v2.3.1 · nonaktif secara default · tanpa permintaan AI default atau latar belakang.',
        spineLabel: 'Alur bukti saran',
        observation: 'Pengamatan',
        evidence: 'Bukti',
        recommendation: 'Saran',
        action: 'Tindakan',
        result: 'Hasil',
        source: 'Sumber',
        limitations: 'Keterbatasan',
        proxyMetric: 'Metrik proksi',
        longSessionSignal: '{share} penggunaan yang diamati berasal dari sesi panjang.',
        largeContextSignal: '{share} penggunaan yang diamati terjadi pada konteks besar.',
        frameworkOverheadSignal: '{share} dari penggunaan yang diamati adalah porsi injeksi framework yang diperkirakan secara terpisah; ini tidak menilai kualitas tulisan pengguna.',
        clearBoundaryRecommendation: 'Gunakan batas tugas yang lebih jelas untuk pekerjaan panjang atau berkonteks besar.',
        clearBoundaryAction: 'Mulai sesi baru saat tugas berubah; ringkas konteks hanya saat melanjutkan tugas yang sama.',
        codexLocalRecommendation: 'Tinjau sinyal struktural Codex lokal sebelum tugas berikutnya yang sebanding.',
        noEvidenceAdvice: 'Tidak ada saran berbasis bukti untuk cakupan ini.',
        codexPreviewUnavailable: 'Pratinjau payload agregat Codex yang aman bagi privasi belum tersedia.',
        elapsedTimeProxy: 'Rentang waktu sesi adalah proksi, bukan waktu kerja aktif yang diukur.',
        qualityGuardrailPending: 'Bukti kualitas masih tertunda, sehingga belum ada kesimpulan efektivitas.',
        payloadTitle: 'Snapshot payload tersegel',
        payloadDescription: 'Snapshot tersegel ini persis sama dengan body JSON UTF-8 yang diterima endpoint BYOK terkonfigurasi hanya setelah klik Kirim yang terpisah.',
        aggregatesOnly: 'Hanya agregat',
        aggregatesWithPersonalization: 'Agregat + konteks pribadi yang diizinkan secara eksplisit',
        aggregatesWithPromptSamples: 'Agregat + sampel prompt yang diizinkan secara eksplisit',
        payloadBytes: '{bytes} byte UTF-8',
        promptSamplesIncluded: '{count} sampel prompt disertakan',
        previewPayload: 'Pratinjau snapshot tersegel',
        noNetworkTransport: 'Pratinjau tidak mengirim apa pun. Pengiriman memerlukan klik terpisah.',
        sendPreparedRequest: 'Kirim permintaan persis ini',
        sendingPreparedRequest: 'Mengirim…',
        sentPreparedRequest: 'Saran terstruktur diterima.',
        aggregateConsentLabel: 'Izinkan data penggunaan agregat',
        aggregateConsentHelp: 'Hanya mencakup agregat numerik dan sinyal struktural dalam daftar izin — tanpa prompt, path, ID sesi, atau catatan individual.',
        promptConsentLabel: 'Sertakan sampel prompt dan konteks pribadi terkonfigurasi',
        promptConsentHelp: 'Opsional dan nonaktif secara default. Teks prompt terbatas dan konteks pribadi terkonfigurasi hanya ditambahkan setelah persetujuan eksplisit terpisah ini.',
        promptWindowHelp: 'Sampel prompt yang lebih lama dari jendela bukti {days} hari yang dikonfigurasi akan dikecualikan.',
        feedbackTitle: 'Umpan balik lokal',
        helpful: 'Bermanfaat',
        notHelpful: 'Tidak bermanfaat',
        applied: 'Diterapkan',
        snooze: 'Tunda 7 hari',
        resume: 'Tampilkan lagi',
        snoozedUntil: 'Ditunda hingga {date}',
        feedbackLocalOnly: 'Disimpan hanya di perangkat ini dan tidak pernah ditambahkan ke payload jarak jauh.',
        feedbackSaveFailed: 'Umpan balik tidak dapat disimpan secara lokal. Tidak ada yang dikirim.',
        comparisonTitle: 'Hasil tugas yang sebanding',
        comparablePairs: '{count} pasangan tugas yang sebanding',
        minimumComparablePairs: 'Setidaknya {minimum} pasangan tugas yang sebanding diperlukan sebelum menarik kesimpulan.',
        insufficientEvidence: 'Bukti belum cukup untuk menarik kesimpulan.',
        qualityGuardrailFailed: 'Pagar pengaman kualitas tidak terpenuhi, sehingga tidak ada klaim efektivitas.',
        improved: 'Peningkatan mencapai ambang yang ditetapkan sebelumnya sambil mempertahankan pagar pengaman kualitas.',
        noDemonstratedImprovement: 'Belum ada peningkatan yang terbukti; ini tidak membuktikan kerugian atau hubungan sebab-akibat.',
        clearLocalData: 'Hapus data saran lokal',
        clearLocalDataConfirm: 'Hapus persetujuan saran, umpan balik, pasangan sebanding, dan hasil perbandingan yang tersimpan di perangkat ini?',
        strictOutputRejected: 'Output model terstruktur ditolak. Tidak ada saran yang dibuat.',
      },
      totalTokens: 'Total Token',
      inputTokens: 'Token Masukan',
      outputTokens: 'Token Keluaran',
      cacheCreation: 'Cache Masukan (Miss)',
      cacheRead: 'Cache Masukan (Hit)',
      cost: 'Biaya',
      messages: 'Pesan',
      modelBreakdown: 'Penggunaan Model',
      dailyBreakdown: 'Penggunaan Harian',
      monthlyBreakdown: 'Penggunaan Bulanan',
      hourlyBreakdown: 'Penggunaan per Jam',
      sessions: 'Sesi',
      sessionBreakdown: 'Penggunaan Sesi',
      project: 'Proyek',
      startTime: 'Waktu Mulai',
      duration: 'Durasi',
      activeDuration: 'Aktif',
      activeDurationHelp:
        'Perkiraan waktu penggunaan aktif — jumlah jeda antar-giliran, dengan setiap jeda idle dibatasi maksimal 1,5 jam agar jeda panjang tidak menggelembungkan angkanya, sementara waktu membaca / meninjau tetap terhitung. (Durasi adalah rentang penuh dari awal hingga akhir.)',
      hour: 'Jam',
      projects: 'Proyek',
      projectBreakdown: 'Penggunaan Proyek',
      fullPath: 'Path Lengkap',
      peakContext: 'Konteks Puncak',
      tokenComposition: 'Komposisi Token',
      lastActive: 'Terakhir Aktif',
      pricing: 'Harga',
      refreshPricing: 'Segarkan Harga Token',
      pricingUpdated: 'Harga diperbarui',
      pricingUpdateFailed: 'Gagal memperbarui harga',
      sortHint: 'Klik judul kolom untuk mengurutkan',
      quota: 'Kuota',
      quotaWindow: 'Periode',
      quotaLimit: 'Batas',
      quota5h: '5 Jam',
      quotaWeekly: 'Mingguan',
      quotaAllModels: 'Semua',
      quotaScoped: 'Per model',
      quotaCredits: 'Kredit penggunaan',
      quotaHint: 'Data nyata dari /usage Anthropic.',
      contextWindow: 'Jendela konteks',
      contextHint: 'Tugas baru → /clear',
      contextHintCompact: 'Tugas sama → /compact',
      contextLeft: 'Konteks tersisa',
      contentAnalysis: 'Konten',
      estimatedNote: 'Diperkirakan dari panjang teks — proporsi relatif dapat diandalkan, angka absolut bersifat perkiraan.',
      calibratedNote: 'Terkalibrasi: proporsi per kategori dari panjang teks, diskalakan ke total token yang benar-benar ditagih (sisi keluaran / sisi masukan + cache-write). Aktifkan/nonaktifkan dengan analysis.calibrate.',
      calibratedTokens: 'Token terkalibrasi',
      thinkingTokensCalibrated: 'token pemikiran sebenarnya (terkalibrasi)',
      byTool: 'Hasil Tool per Tool',
      catUserPrompts: 'Prompt Anda',
      catAssistantText: 'Respons asisten',
      catAssistantThinking: 'Pemikiran asisten',
      catToolCalls: 'Panggilan tool',
      catToolResults: 'Hasil tool',
      estTokens: 'Token perkiraan',
      share: 'Proporsi',
      resets: 'Reset',
      cacheHitRate: 'Tingkat Cache Hit',
      last30days: '30 hari terakhir',
      branches: 'Branch',
      branchBreakdown: 'Penggunaan Branch',
      branch: 'Branch',
      workflows: 'Workflow',
      workflowBreakdown: 'Penggunaan Workflow',
      workflowName: 'Workflow',
      model: 'Model',
      agents: 'Agen',
      agent: 'Agen',
      workflowsLast30Days: 'Workflow 30 hari terakhir',
      workflowLast30DaysCostShare: 'proporsi biaya 30 hari terakhir',
      workflowCacheHint:
        'Tingkat cache hit = cache read ÷ semua token sisi masukan. Workflow native Claude memakai ulang prompt cache lintas agen (tingkat tinggi); provider tanpa cache lintas-agen menunjukkan ~0% — workflow yang sama jadi jauh lebih mahal di sana.',
      adhocBadge: 'subagent (ad-hoc)',
      workflowModeBadge: 'workflow',
      workflowModeHint:
        '"workflow" = direktori proses dynamic-workflow di disk; "subagent (ad-hoc)" = pemanggilan Task-tool biasa. Tingkat effort (ultracode/xhigh) tidak tercatat di log, jadi kedua badge ini tidak mengklaim salah satunya.',
      workflowNativeHint:
        'Ultracode native Claude sering menyimpan orkestrasinya di sesi utama (tanpa file agen), sehingga muncul di Sesi / Pelacakan Penggunaan, bukan sebagai baris di sini. Proses yang menulis file agen menampilkan biaya Claude-nya di baris orkestrasi. (Direncanakan untuk rilis mendatang.)',
      orchestration: 'orkestrasi sesi utama',
      commonTaskPrefix: 'Teks tugas bersama',
      thinkingShare: 'Pemikiran %',
      effortHint: 'Proporsi pemikiran tinggi — pertimbangkan /effort high alih-alih xhigh untuk tugas seperti ini.',
      thinkingHidden: 'Pemikiran aktif, tetapi model ini (mis. Fable 5 / Opus 4.8) tidak menampilkan teks penalarannya, sehingga proporsinya tidak dapat diukur — nilai sebenarnya lebih tinggi dari yang ditampilkan.',
      thinkingHiddenShort: 'tersembunyi',
      quotaWarnBanner:
        'Hanya {remaining}% tersisa untuk periode 5 jam Anda. Sebuah proses workflow bisa memakai porsi besar — pertimbangkan menunggu reset: proses yang terinterupsi kehilangan prompt cache-nya dan diulang dengan biaya ~40% lebih mahal.',
      dismiss: 'Tutup',
      attribution: 'Pelacakan Penggunaan',
      attrDisclaimer:
        'Perkiraan, berdasarkan sesi lokal di mesin ini — tidak termasuk perangkat lain atau claude.ai. Ini adalah karakteristik independen dari penggunaan Anda, bukan rincian lengkap.',
      attrLargeContext: '{pct}% penggunaan Anda berada di konteks >150k',
      attrLargeContextShort: 'konteks >150k',
      attrLargeContextHint:
        'Sesi yang lebih panjang lebih mahal meski sudah di-cache. Gunakan /compact di tengah tugas, /clear saat beralih ke tugas baru.',
      attrLongSessions: '{pct}% penggunaan Anda berasal dari sesi yang aktif 8+ jam',
      attrLongSessionsShort: 'sesi 8 jam+',
      attrLongSessionsHint:
        'Ini sering kali sesi latar belakang/loop. Penggunaan berkelanjutan bisa cepat menumpuk, jadi pastikan itu memang disengaja.',
      attrSubagentHeavy: '{pct}% penggunaan Anda berasal dari sesi dengan banyak subagent',
      attrSubagentHeavyShort: 'Sesi dengan banyak subagent',
      attrSubagentHeavyHint:
        'Setiap subagent menjalankan requestnya sendiri. Berhati-hatilah saat memunculkannya — dan pertimbangkan model yang lebih murah untuk subagent yang lebih sederhana.',
      attrWorkflows: '{pct}% penggunaan Anda berasal dari proses workflow',
      attrWorkflowsShort: 'Proses workflow',
      attrWorkflowsHint: 'Lihat tab Workflow untuk detail per proses dan tingkat cache hit.',
      attrSkillChar: '{pct}% penggunaan Anda berasal dari {name}',
      attrSkillCharHint: 'Skill yang berat bisa dipersempit cakupannya atau dijalankan dengan model yang lebih murah lewat frontmatter skill.',
      attrPluginChar: '{pct}% penggunaan Anda berasal dari plugin "{name}"',
      attrPluginCharHint:
        'Tinjau apa yang disumbang plugin ini — agen, skill, dan tool MCP-nya semuanya turut menghitung ke batas Anda.',
      attrSkills: 'Skill',
      attrSubagents: 'Subagent',
      attrPlugins: 'Plugin',
      attrModels: 'Model',
      attrShare: '% penggunaan',
      count: 'Jumlah',
      scopeDay: 'Hari',
      scopeWeek: 'Minggu',
      scopeMonth: 'Bulan',
      attrTodayPointer: 'Detail: tab Konten',
      sessionTitle: 'Sesi',
      sessionActions: 'Aksi',
      copySessionId: 'Salin ID sesi',
      viewConversation: 'Lihat percakapan ini (baca-saja) — baca ulang prompt Anda dan jawaban model tanpa memuatnya kembali ke konteks.',
      copyPath: 'Salin path',
      resumeSession: 'Lanjutkan percakapan ini — membuka kembali di Claude Code (proyek yang sama) atau terminal lewat "claude --resume", sehingga Anda bisa melanjutkan dari titik terakhir.',
      resumeInvalid: 'ID sesi tidak valid — tidak dapat dilanjutkan.',
      sessionFilterCurrent: 'Proyek saat ini',
      sessionFilterAll: 'Semua',
      sessionRangeToday: 'Hari ini',
      sessionRange7d: '7 hari',
      sessionRange30d: '30 hari',
      sessionModelAll: 'Semua model',
      deleteSession: 'Hapus sesi',
      deleteSessionConfirm: 'Hapus sesi "{name}"?',
      deleteSessionDetail: 'Log percakapannya dipindahkan ke sampah (dapat dipulihkan). Selebihnya extension ini bersifat baca-saja.',
      deleteSessionYes: 'Hapus',
      deleteSessionNotFound: 'File log sesi tidak ditemukan.',
      deleteSessionDone: '"{name}" dihapus (dipindahkan ke sampah).',
      getAdvice: 'Dapatkan Saran AI',
      adviceCardTitle: 'Saran AI',
      adviceCardDesc:
        'Tinjau bukti lokal terlebih dahulu. Permintaan persis hanya berisi agregat secara default; sampel prompt dan konteks pribadi memerlukan persetujuan terpisah, dan tidak ada yang dikirim sampai Anda mengeklik Kirim.',
      optimizerTitle: 'Pengoptimal Penggunaan',
      optimizerDesc:
        'Ubah permintaan yang masih kasar dan belum rapi menjadi prompt bersih yang bisa langsung ditempel ke Claude Code — plus saran effort / thinking / model untuk tugas tersebut.',
      optimizerHowto:
        'Ketik atau tempel draf Anda di bawah, pilih penyesuaian opsional, lalu buat pratinjau permintaan persis. Tidak ada yang dikirim sampai Anda mengeklik Kirim secara terpisah; hanya teks yang ditempel yang dapat disertakan.',
      optimizerConsent:
        'Buat pratinjau permintaan persis? Ini tidak mengirim apa pun; pengiriman ke model API yang dikonfigurasi memerlukan klik terpisah.',
      optimizerEnableBtn: 'Aktifkan di pengaturan',
      optimizerPlaceholder: 'Tempel draf prompt untuk dioptimalkan…',
      optimizerRun: 'Optimalkan',
      optimizerRunning: 'Mengoptimalkan…',
      optimizerCopy: 'Salin prompt',
      optimizerCopied: 'Disalin',
      optimizerResolve: 'Tandai referensi yang ambigu',
      optimizerResolveHint:
        "Minta model menunjukkan referensi yang ambigu (mis. 'ini', 'file itu', 'bug itu') lalu memperjelasnya atau menandai asumsi yang jelas.",
      optimizerDistil: 'Ringkas teks tempelan yang panjang',
      optimizerDistilHint:
        'Jika draf Anda menempel log / kode / dokumen yang panjang, ringkas menjadi hanya yang dibutuhkan Claude.',
      optimizerAesthetic: 'Sarankan arah gaya',
      optimizerAestheticHint:
        'Untuk tugas UI / visual / tulisan, usulkan satu arah gaya yang konkret agar hasilnya tidak generik.',
      optimizerPromptHeading: 'Prompt teroptimasi',
      optimizerSettingsHeading: 'Pengaturan proses yang disarankan',
      experimentalBadge: 'eksperimental',
      adviceNeedsKey: 'Atur API key di Pengaturan untuk menggunakan saran AI.',
      adviceGenerating: 'Membuat saran penggunaan…',
      adviceFailed: 'Gagal mendapatkan saran',
      adviceScopeOverall: 'Keseluruhan (semua proyek)',
      adviceScopePrompt: 'Pilih fokus saran yang diinginkan',
      adviceDemoButton: 'Pratinjau demo',
      adviceDemoNotice:
        '# DEMO — Pratinjau Saran Penggunaan AI\n\n' +
        '> **File ini adalah demo statis, bukan saran sungguhan.**\n' +
        '> Teks di bawah ini ditulis manual untuk menunjukkan jenis keluaran\n' +
        '> yang dihasilkan fitur ini. Ini **bukan** berdasarkan data penggunaan\n' +
        '> Claude Code Anda yang sebenarnya — tidak ada yang dikirim ke API mana pun untuk menghasilkan ini.\n\n' +
        '### Untuk mendapatkan saran nyata dan personal berdasarkan penggunaan ANDA:\n\n' +
        '1. Jalankan **`Claude Code Usage: Show Usage Details`**\n' +
        '2. Buka bagian **Pengaturan → Saran** di dashboard\n' +
        '3. Tempel API key yang kompatibel dengan OpenAI — hanya disimpan di VS Code SecretStorage\n' +
        '   DeepSeek: [deepseek.com](https://platform.deepseek.com)\n' +
        '4. Jalankan ulang **`Claude Code Usage: Get AI Usage Advice`**',
      costComposition: 'Komposisi Biaya',
      date: 'Tanggal',
      yesterday: 'Kemarin',
      dataDirectory: 'Direktori Data',
      noDataMessage: 'Tidak ada data penggunaan yang ditemukan. Pastikan Claude Code sudah berjalan dan dikonfigurasi dengan benar.',
      errorMessage: 'Gagal memuat data penggunaan. Periksa kembali konfigurasi Anda.',
    },
    settings: {
      title: 'Pengaturan Claude Code Usage',
      refreshInterval: 'Interval Penyegaran (detik)',
      dataDirectory: 'Path Direktori Data',
      language: 'Bahasa',
      decimalPlaces: 'Angka Desimal',
    },
  },
};

// Per-setting label / help translations for the dashboard ⚙ Settings panel.
// English lives in the settings catalog (settings.ts); these override it for the
// non-English UIs so the descriptions follow the plugin language too. Code /
// command tokens (token, /v1/messages, opus:NN%, k/M, git/folder/flat …) are kept
// verbatim. Generated with DeepSeek V4 Pro and validated for completeness.
const SETTINGS_I18N: Partial<Record<SupportedLanguage, Record<string, { label: string; help: string }>>> = {
  'de-DE': {
    'language': { label: 'Anzeigesprache', help: 'UI-Sprache. "auto" folgt VS Code.' },
    'decimalPlaces': { label: 'Kosten-Dezimalstellen', help: '' },
    'displayCurrency': { label: 'Anzeigewährung', help: 'Nur Anzeige. Verwendet integrierte Referenzkurse vom 09.09.2026; Kurse sind weder bearbeitbar noch werden sie abgerufen, die Basis bleibt USD.' },
    'tokenDecimalPlaces': { label: 'Token-Dezimalstellen', help: 'Dezimalstellen für kompakte Token-Anzeige (1.2M / 345.6K). Volle Ganzzahlen bleiben unberührt.' },
    'compactNumbers': { label: 'Kompakte Token-Zahlen', help: 'Zeige 1.2M / 345K statt voller Zahlen.' },
    'releaseAnnouncements': { label: 'Release-Hinweise', help: 'Nach einem Erweiterungs-Upgrade einmal die Neuerungen anzeigen.' },
    'pricingBackend': { label: 'Claude-Preisquelle', help: 'Wähle AWS-Bedrock-In-Region-Preise, wenn Claude Code über Bedrock geroutet wird.' },
    'codex.enabled': { label: 'Codex Beta aktivieren', help: 'Datenschutzfreundliche Nutzungsaggregate aus lokalen Codex-Sitzungslogs lesen.' },
    'codex.dataDirectory': { label: 'Benutzerdefiniertes Codex-Datenverzeichnis', help: 'Leer = CODEX_HOME, dann ~/.codex. Authentifizierungsdateien werden nie gelesen.' },
    'codex.fileWatchSeconds': { label: 'Codex-Live-Aktualisierungsverzögerung', help: 'Ruhe-Debounce nach lokalen Codex-JSONL-Änderungen. Aus deaktiviert die Überwachung.' },
    'codex.optimization.enabled': { label: 'Codex-Verhaltensoptimierung anzeigen', help: 'Lokale, deterministische Codex-Verhaltensmetriken und Empfehlungen anzeigen.' },
    'statusBarProvider': { label: 'Statusleisten-Anbieter', help: 'Auto bevorzugt Claude, wenn beide Anbieter Daten haben.' },
    'codex.statusMetric': { label: 'Codex-Statusmetrik', help: 'Heutige Nutzung ohne Cache, verarbeitete Token oder Ausgabe-Token.' },
    'timezone': { label: 'Zeitzone für Daten', help: 'Gängige Zone oder UTC-Offset (jeder Offset abgedeckt) oder Systemstandard. Labels zeigen den aktuellen UTC-Offset.' },
    'showWeeklyEquivalentValue': { label: 'Wöchentlichen API-Gegenwert anzeigen', help: 'Standardmäßig an. Zeigt den historischen wöchentlichen API-Gegenwert in „Seit Aufzeichnungsbeginn“ und „Vergleich“. Dies ist eine Schätzung, keine Rechnung und kein Abonnementkontingent.' },
    'showProjectUsageMatrix': { label: 'Projekt-Nutzungsmatrix anzeigen', help: 'Standardmäßig an. Ergänzt Projekte um eine lokale 30/90-Tage-Token-Heatmap und einen gestapelten Trend. Nutzt bestehende Indexaggregate und ordnet Projekten kein Abonnementkontingent zu.' },
    'showHeatmap': { label: 'Token-Heatmap zeigen (Tab „Seit Aufzeichnungsbeginn“)', help: 'Standardmäßig aus. GitHub-artige Jahres-Heatmap; als SVG exportieren oder auf dein GitHub-Profil veröffentlichen.' },
    'showEfficiency': { label: 'Effizienz-Einblicke zeigen', help: 'Standardmäßig aus. Kosten/Nachricht, Token/Nachricht, Cache-Ersparnis und die Cache-Warmzeit-Schätzung.' },
    'showCostliestMessages': { label: '„Top 10 teuerste Nachrichten“ zeigen', help: 'Standardmäßig aus. Reiht deine teuersten Einzel-Turns; das Aufklappen zeigt den Prompt (dein eigener Text).' },
    'enableShareCard': { label: 'Freigabe-Arbeitsbereich aktivieren', help: 'Standardmäßig an. Zeigt den Freigabe-Arbeitsbereich im Vergleich und die Anbieter-Sharecard. Ausschalten blendet die Freigabeoberfläche aus; Export bleibt eine ausdrückliche Aktion.' },
    'enableSessionActions': { label: 'Sitzungsaktionen (Fortsetzen & Löschen)', help: 'Standardmäßig aus. Zeigt auf dem Sitzungen-Tab die Schaltflächen „Fortsetzen“ und „Löschen“. Beide WIRKEN auf dein Claude Code (Gespräch erneut öffnen / Log in den Papierkorb), anders als diese schreibgeschützte Erweiterung — daher zusammen optional.' },
    'projectGroupingMode': { label: 'Projektgruppierung', help: 'git = nach Repo · folder = oberste Ebene · flat = jedes cwd.' },
    'showCost': { label: 'Heutige Kosten / Token anzeigen', help: '' },
    'statusBarMetric': { label: 'Statusleisten-Metrik', help: 'Was das erste Statusleistenelement zeigt: heutige Kosten oder die heutige Gesamt-Tokenanzahl (k/M).' },
    'showContext': { label: 'Kontextfenster-Auslastung anzeigen (experimental)', help: 'Standardmäßig aus. Schätzt den aktuellen Sitzungskontext in %, ähnlich /context, anhand des neuesten Logeintrags. Es kann nur die Eingabeseite insgesamt anzeigen, nicht die Kategorieaufteilung von /context (diese sind Claude Code-interne Daten, die nicht auf die Festplatte geschrieben werden), daher ist es nur eine Näherung — ein "~" kennzeichnet eine geschätzte Fenstergröße.' },
    'contextWindowOverride': { label: 'Überschreibung des Kontextfensters (Tokens)', help: '0 = automatisch vom Modell erkennen. Legen Sie Ihr echtes Fenster (z.B. 1000000) für Proxy- oder benutzerdefinierte Modelle fest, die die Autoerkennung nicht erkennt.' },
    'usageLimitTracking': { label: '5-Stunden / Wochenkontingent anzeigen', help: '' },
    'showScopedWeekly': { label: 'Wöchentliches Limit pro Modell anzeigen', help: 'Ergänzt den Wochenwert um jede modellspezifische Wochengrenze deines Plans, z. B. „wk 9% (fable 17%)“, sobald sie genutzt wurde. Der Name kommt von Anthropic und folgt dem jeweils begrenzten Modell. Wenn dies aus ist, bleibt sie im Tooltip sichtbar.' },
    'quotaFiveHourOnly': { label: 'Kontingent: nur 5-Stunden-Fenster', help: 'Nur das 5-Stunden-Kontingent in der Statusleiste zeigen, den Wochenwert ausblenden (Reset-Details bleiben im Tooltip).' },
    'showResetInStatusBar': { label: 'Kontingent: Reset-Countdown zeigen', help: 'Kompakten Reset-Countdown in der Statusleiste anhängen (5h 6% ↻4.8h). Aus hält es sauber (5h 6% · wk 1%); der Tooltip zeigt immer volle Reset-Zeiten.' },
    'resetCountdownFormat': { label: 'Kontingent: Format des Reset-Countdowns', help: 'Gilt nur, wenn „Kontingent: Reset-Countdown zeigen“ aktiv ist. Dezimal (4.8h / 1.6d), ganze Einheiten (4h 48m / 1d 14h) oder die lokale Uhrzeit/Datum deines Rechners (18:20 / 2026-07-22).' },
    'statusBarQuotaFormat': { label: 'Kontingent: Statusleisten-Format', help: 'Leer behält das eingebaute Layout (5h 6% · wk 1%). Sonst: {5h.pct}, {wk.pct} (oder {7d.pct}) und {model:Fable.pct}, jeweils auch mit .reset und .label — z. B. "{5h.pct} | {7d.pct} · {model:Fable.pct}". Ein Fenster, das dein Tarif nicht meldet, bleibt leer. .reset kann einen eigenen Stil tragen: {5h.reset:units}, :decimal, :clock oder :at (Uhrzeit).' },
    'workflowQuotaWarnPercent': { label: 'Warnung bei Workflow-Kontingent %', help: 'Warnt vor einem Lauf, wenn das verbleibende 5h-Kontingent darunter liegt. 0 = aus.' },
    'dataDirectory': { label: 'Benutzerdefiniertes Datenverzeichnis', help: 'Claude-Datenverzeichnis; leer = automatisch erkennen.' },
    'refreshInterval': { label: 'Aktualisierungsintervall (s)', help: '' },
    'fileWatchSeconds': { label: 'Verzögerung der Live-Aktualisierung', help: 'Wartezeit nach der letzten lokalen JSONL-Änderung vor der Aktualisierung (Ruhe-Debounce; jedes neue Ereignis startet die Wartezeit neu). Es erfolgt kein API-Aufruf; Kontingent-Abfragen werden separat gedrosselt. „Aus“ deaktiviert die Überwachung, 60–300 s schont große Verläufe am stärksten.' },
    'showInsights': { label: 'Experimentelle Insights anzeigen', help: 'Standardmäßig aus. Fügt dem Content-Tab einen Abschnitt „Experimentelle Insights“ hinzu (Cache-Churn-Rechnung, Cache-Wärme pro Modell, große Einzelantworten, aktive Stunden, Skill-ROI) — heuristische Schätzungen aus deinen lokalen Logs, als Schätzungen gekennzeichnet.' },
    'showConversationViewer': { label: 'Gesprächs-Viewer aktivieren', help: 'Standardmäßig an. Fügt dem Sitzungen-Tab eine Ansicht-Schaltfläche hinzu, um ein früheres Gespräch schreibgeschützt erneut zu lesen, ohne es in den Modellkontext zu laden. Liest nur lokale Logs.' },
    'dashboardAutoRefresh': { label: 'Dashboard-Auto-Aktualisierung', help: 'Aktualisiert das Dashboard automatisch bei neuer Nutzung. Aus = nur manuelle Aktualisierung (die Statusleiste aktualisiert weiter).' },
    'enableContentAnalysis': { label: 'Inhaltsanalyse (Content-Registerkarte)', help: 'Deaktivieren, um die CPU-intensive Textprüfung zu überspringen.' },
    'analysis.calibrate': { label: 'Inhaltszahlen kalibrieren', help: 'Skalieren Sie Schätzungen auf die exakten abgerechneten Token-Gesamtzahlen.' },
    'advice.effectiveness.enabled': { label: 'Vorschau zur Wirksamkeit von KI-Empfehlungen aktivieren', help: 'Standardmäßig aus. Zeigt lokale Evidenz, exakte BYOK-Anfragevorschau, Feedback und Vergleiche; gesendet wird nur nach einem separaten Klick.' },
    'advice.apiKey': { label: 'API-Schlüssel', help: 'Für das api-Backend. Liegt in VS Code SecretStorage, wird nie synchronisiert und nie an das Dashboard gesendet.' },
    'advice.apiFormat': { label: 'API-Format', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API-URL', help: 'Endpunkt für das api-Backend.' },
    'advice.model': { label: 'API-Modell', help: '' },
    'advice.reasoningEffort': { label: 'Reasoning-Aufwand (openai)', help: '' },
    'advice.promptWindowDays': { label: 'Evidenz- und Prompt-Fenster (Tage)', help: '' },
    'advice.userContext': { label: 'Persönlicher/Projektkontext', help: 'Optional; wird nur mit separater Prompt-Personalisierungs-Einwilligung und sichtbar in der exakten Vorschau gesendet.' },
    'advice.optimizer.enabled': { label: 'Usage Optimizer aktivieren', help: 'Zeigt die Opt-in-Optimizer-Karte auf der Registerkarte "Content" an.' },
  },
  'zh-TW': {
    'language': { label: '顯示語言', help: 'UI 語言。"auto" 會跟隨 VS Code。' },
    'decimalPlaces': { label: '費用小數位數', help: '' },
    'displayCurrency': { label: '費用顯示幣別', help: '僅影響顯示。使用 2026-09-09 內建參考匯率；匯率不可調整且不會連線擷取，底層估算仍維持 USD。' },
    'tokenDecimalPlaces': { label: 'Token 小數位數', help: '緊湊 token 顯示（1.2M / 345.6K）的小數位數。完整整數值不受影響。' },
    'compactNumbers': { label: '簡潔的 Token 計數', help: '顯示 1.2M / 345K 而非完整數字。' },
    'releaseAnnouncements': { label: '版本更新通知', help: '擴充套件升級後顯示一次「新功能」通知。' },
    'pricingBackend': { label: 'Claude 價格來源', help: '若 Claude Code 透過 Bedrock 路由，請選擇 AWS Bedrock 區域內價格。' },
    'codex.enabled': { label: '啟用 Codex Beta', help: '從本機 Codex 工作階段日誌讀取隱私安全的用量彙總。' },
    'codex.dataDirectory': { label: '自訂 Codex 資料目錄', help: '留空時使用 CODEX_HOME，再使用 ~/.codex；不會讀取認證檔案。' },
    'codex.fileWatchSeconds': { label: 'Codex 即時重新整理延遲', help: '本機 Codex JSONL 變更後的靜默防抖；關閉即停用監看。' },
    'codex.optimization.enabled': { label: '顯示 Codex 行為最佳化', help: '顯示本機、確定性的 Codex 行為指標與建議。' },
    'statusBarProvider': { label: '狀態列供應商', help: '兩個供應商都有資料時，自動模式優先顯示 Claude。' },
    'codex.statusMetric': { label: 'Codex 狀態列指標', help: '今日未快取用量、已處理 Token 或輸出 Token。' },
    'timezone': { label: '日期時區', help: '常用時區或 UTC 偏移（涵蓋所有偏移），或系統預設。標籤顯示目前的 UTC 偏移。' },
    'showWeeklyEquivalentValue': { label: '顯示每週 API 等效價值', help: '預設開啟。在「所有」與「比較」中顯示歷史每週 API 等效價值；屬於估算，不是帳單或訂閱額度。' },
    'showProjectUsageMatrix': { label: '顯示專案用量矩陣', help: '預設開啟。在「專案」加入本機 30/90 天 Token 熱力圖與堆疊趨勢；沿用既有索引彙總，不會把訂閱額度分配到專案。' },
    'showHeatmap': { label: '顯示 Token 熱力圖（「所有」分頁）', help: '預設關閉。全部分頁上的 GitHub 風格年度熱力圖；可匯出 SVG 或發佈到你的 GitHub 首頁。' },
    'showEfficiency': { label: '顯示效率洞察', help: '預設關閉。加入每則成本、每則 token、快取節省與快取保溫估計。' },
    'showCostliestMessages': { label: '顯示「最貴 10 則訊息」', help: '預設關閉。列出最貴的單則對話；展開會顯示 prompt（隱私：你自己的文字）。' },
    'enableShareCard': { label: '啟用分享工作台', help: '預設開啟。顯示「比較」分享工作台與供應商分享卡；關閉後隱藏分享介面，匯出仍需明確操作。' },
    'enableSessionActions': { label: '會話操作（恢復與刪除）', help: '預設關閉。在「會話」分頁顯示「恢復」和「刪除」按鈕。兩者都會「操作」你的 Claude Code（重開對話／把紀錄檔丟進垃圾桶），與這個唯讀擴充功能的定位相反，所以一起維持選用。' },
    'projectGroupingMode': { label: '專案分組', help: 'git = 依儲存庫 · folder = 最上層 · flat = 每個目前工作目錄。' },
    'showCost': { label: '顯示今日費用 / Token 用量', help: '' },
    'statusBarMetric': { label: '狀態列指標', help: '第一個狀態列項目顯示的是：今日費用或今日總 Token 數量 (k/M)。' },
    'showContext': { label: '顯示上下文視窗填充 (experimental)', help: '預設關閉。從最新的日誌記錄估計當前工作階段上下文百分比，類似 /context。它只能顯示輸入側的總計，而不是 /context 的類別細分（這些是 Claude Code 內部資料，未寫入磁碟），因此是近似值 — "~" 標記一個猜測的視窗大小。' },
    'contextWindowOverride': { label: '上下文視窗覆寫 (tokens)', help: '0 = 從模型自動檢測。為自動檢測無法識別的代理/自訂模型設定實際視窗（例如 1000000）。' },
    'usageLimitTracking': { label: '顯示 5 小時 / 每週配額', help: '' },
    'showScopedWeekly': { label: '顯示每模型每週限制', help: '在每週數字中一併顯示方案針對特定模型的每週上限(例如「wk 9% (fable 17%)」),該上限有用量後才會出現。名稱由 Anthropic 提供,因此會跟著實際受限的模型變動。關閉此項不會將其從提示框中隱藏。' },
    'quotaFiveHourOnly': { label: '配額：僅 5 小時視窗', help: '狀態列只顯示 5 小時配額，隱藏每週數字（重置詳情仍在 tooltip）。' },
    'showResetInStatusBar': { label: '配額：顯示重置倒數', help: '在狀態列附加精簡的重置倒數（5h 6% ↻4.8h）。關閉則保持清爽（5h 6% · wk 1%）；tooltip 一律顯示完整重置時間。' },
    'resetCountdownFormat': { label: '配額：重置倒數格式', help: '僅在「配額：顯示重置倒數」開啟時生效。小數（4.8h / 1.6d）、整數單位（4h 48m / 1d 14h），或你電腦的本地時間／日期（18:20 / 2026-07-22）。' },
    'statusBarQuotaFormat': { label: '配額：狀態列格式', help: '留空維持內建版面（5h 6% · wk 1%）。否則：{5h.pct}、{wk.pct}（或 {7d.pct}）與 {model:Fable.pct}，每個也可加 .reset 與 .label — 例如「{5h.pct} | {7d.pct} · {model:Fable.pct}」。方案未回報的視窗會顯示為空。.reset 可自帶樣式：{5h.reset:units}、:decimal、:clock 或 :at（時刻）。' },
    'workflowQuotaWarnPercent': { label: '工作流程配額警告 %', help: '當剩餘 5 小時配額低於此值時，在執行前發出警告。0 = 關閉。' },
    'dataDirectory': { label: '自訂資料目錄', help: 'Claude 資料目錄；空白 = 自動偵測。' },
    'refreshInterval': { label: '重新整理間隔 (秒)', help: '' },
    'fileWatchSeconds': { label: '即時重新整理延遲', help: '在最後一次本機 JSONL 變更後等待多久才重新整理（安靜期去抖；每個新事件都會重新計時）。不會呼叫 API；配額查詢另行節流。「關閉」會停用監控，60–300 秒最適合降低大量歷史資料的 CPU 負載。' },
    'showInsights': { label: '顯示實驗性洞察', help: '預設關閉。在 Content 分頁加入「實驗性洞察」區塊（快取損耗帳單、各模型快取有效時長、大型單輪、活躍時段、技能 ROI）——皆為本機紀錄的啟發式估算，已標註為估計值。' },
    'showConversationViewer': { label: '啟用對話檢視器', help: '預設開啟。在「會話」分頁加入「檢視」按鈕，可唯讀地重讀先前的對話，而不會載入模型上下文。只讀取本機紀錄。' },
    'dashboardAutoRefresh': { label: '儀表板自動重新整理', help: '有新用量時自動重新整理儀表板。關閉 = 僅手動重新整理（狀態列仍會更新）。' },
    'enableContentAnalysis': { label: '內容分析 (Content 分頁)', help: '停用以跳過 CPU 密集的文字掃描。' },
    'analysis.calibrate': { label: '校準內容數據', help: '將估計值縮放至確切的計費 Token 總數。' },
    'advice.effectiveness.enabled': { label: '啟用 AI 建議有效性預覽', help: '預設關閉。顯示本機證據、精確 BYOK 請求預覽、回饋與比較；只有另行點擊後才會傳送。' },
    'advice.apiKey': { label: 'API 金鑰', help: '用於 api 後端。只存於 VS Code SecretStorage，不同步，也不傳送至儀表板。' },
    'advice.apiFormat': { label: 'API 格式', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API URL', help: 'api 後端的端點。' },
    'advice.model': { label: 'API 模型', help: '' },
    'advice.reasoningEffort': { label: '推論努力度 (openai)', help: '' },
    'advice.promptWindowDays': { label: '證據與提示視窗 (天數)', help: '' },
    'advice.userContext': { label: '個人/專案上下文', help: '選用；僅在另行同意提示個人化後傳送，並完整顯示在精確預覽中。' },
    'advice.optimizer.enabled': { label: '啟用使用情況優化器', help: '在 Content 分頁上顯示自願加入的 Optimizer 卡片。' },
  },
  'zh-CN': {
    'language': { label: '显示语言', help: 'UI 语言。"auto" 会跟随 VS Code。' },
    'decimalPlaces': { label: '费用小数位数', help: '' },
    'displayCurrency': { label: '费用显示币种', help: '仅影响显示。使用 2026-09-09 内置参考汇率；汇率不可调整且不会联网获取，底层估算仍保持 USD。' },
    'tokenDecimalPlaces': { label: 'Token 小数位数', help: '紧凑 token 显示（1.2M / 345.6K）的小数位数。完整整数值不受影响。' },
    'compactNumbers': { label: '简洁的 token 计数', help: '显示 1.2M / 345K 而非完整数字。' },
    'releaseAnnouncements': { label: '版本更新通知', help: '扩展升级后显示一次“新功能”通知。' },
    'pricingBackend': { label: 'Claude 价格来源', help: '如果 Claude Code 通过 Bedrock 路由，请选择 AWS Bedrock 区域内价格。' },
    'codex.enabled': { label: '启用 Codex Beta', help: '从本地 Codex 会话日志读取隐私安全的用量汇总。' },
    'codex.dataDirectory': { label: '自定义 Codex 数据目录', help: '留空时使用 CODEX_HOME，再使用 ~/.codex；不会读取认证文件。' },
    'codex.fileWatchSeconds': { label: 'Codex 实时刷新延迟', help: '本地 Codex JSONL 变更后的静默防抖；关闭即停用监视。' },
    'codex.optimization.enabled': { label: '显示 Codex 行为优化', help: '显示本地、确定性的 Codex 行为指标与建议。' },
    'statusBarProvider': { label: '状态栏供应商', help: '两个供应商都有数据时，自动模式优先显示 Claude。' },
    'codex.statusMetric': { label: 'Codex 状态栏指标', help: '今日未缓存用量、已处理 Token 或输出 Token。' },
    'timezone': { label: '日期时区', help: '常用时区或 UTC 偏移（涵盖所有偏移），或系统默认。标签显示当前的 UTC 偏移。' },
    'showWeeklyEquivalentValue': { label: '显示每周 API 等效价值', help: '默认开启。在“全部时间”和“对比”中显示历史每周 API 等效价值；属于估算，不是账单或订阅额度。' },
    'showProjectUsageMatrix': { label: '显示项目用量矩阵', help: '默认开启。在“项目”中加入本地 30/90 天 Token 热力图与堆叠趋势；复用现有索引汇总，不会把订阅额度分配到项目。' },
    'showHeatmap': { label: '显示 Token 热力图（“所有”选项卡）', help: '默认关闭。全部标签上的 GitHub 风格年度热力图；可导出 SVG 或发布到你的 GitHub 主页。' },
    'showEfficiency': { label: '显示效率洞察', help: '默认关闭。加入每条成本、每条 token、缓存节省与缓存保温估计。' },
    'showCostliestMessages': { label: '显示“最贵 10 条消息”', help: '默认关闭。列出最贵的单条对话；展开会显示 prompt（隐私：你自己的文字）。' },
    'enableShareCard': { label: '启用分享工作台', help: '默认开启。显示“对比”分享工作台与供应商分享卡；关闭后隐藏分享界面，导出仍需明确操作。' },
    'enableSessionActions': { label: '会话操作（恢复与删除）', help: '默认关闭。在「会话」标签页显示「恢复」和「删除」按钮。两者都会「操作」你的 Claude Code（重开对话／把日志丢进回收站），与这个只读扩展的定位相反，所以一起保持可选。' },
    'projectGroupingMode': { label: '项目分组', help: 'git = 按仓库 · folder = 顶层 · flat = 每个当前工作目录。' },
    'showCost': { label: '显示今日费用 / token 用量', help: '' },
    'statusBarMetric': { label: '状态栏指标', help: '第一个状态栏项目显示的内容：今日费用或今日总 token 数 (k/M)。' },
    'showContext': { label: '显示上下文窗口填充 (experimental)', help: '默认关闭。从最新的日志记录估计当前会话上下文百分比，类似于 /context。它只能显示输入侧的总计，而不是 /context 的类别细分（这些是 Claude Code 内部信息，未写入磁盘），因此是近似值 — "~" 标记猜测的窗口大小。' },
    'contextWindowOverride': { label: '上下文窗口覆盖 (tokens)', help: '0 = 从模型自动检测。为自动检测无法识别的代理/自定义模型设置实际窗口（例如 1000000）。' },
    'usageLimitTracking': { label: '显示 5 小时 / 每周配额', help: '' },
    'showScopedWeekly': { label: '显示每模型每周限制', help: '在每周数字中一并显示方案针对特定模型的每周上限(例如“wk 9% (fable 17%)”),该上限有用量后才会出现。名称来自 Anthropic,因此会随实际受限的模型变化。关闭此项不会将其从悬浮提示中隐藏。' },
    'quotaFiveHourOnly': { label: '配额：仅 5 小时窗口', help: '状态栏只显示 5 小时配额，隐藏每周数字（重置详情仍在 tooltip）。' },
    'showResetInStatusBar': { label: '配额：显示重置倒计时', help: '在状态栏附加精简的重置倒计时（5h 6% ↻4.8h）。关闭则保持清爽（5h 6% · wk 1%）；tooltip 一律显示完整重置时间。' },
    'resetCountdownFormat': { label: '配额：重置倒计时格式', help: '仅在“配额：显示重置倒计时”开启时生效。小数（4.8h / 1.6d）、整数单位（4h 48m / 1d 14h），或你电脑的本地时间／日期（18:20 / 2026-07-22）。' },
    'statusBarQuotaFormat': { label: '配额：状态栏格式', help: '留空保持内置布局（5h 6% · wk 1%）。否则：{5h.pct}、{wk.pct}（或 {7d.pct}）和 {model:Fable.pct}，每个也可加 .reset 与 .label — 例如“{5h.pct} | {7d.pct} · {model:Fable.pct}”。方案未报告的窗口会显示为空。.reset 可自带样式：{5h.reset:units}、:decimal、:clock 或 :at（时刻）。' },
    'workflowQuotaWarnPercent': { label: '工作流配额警告 %', help: '当剩余 5 小时配额低于此值时，运行前发出警告。0 = 关闭。' },
    'dataDirectory': { label: '自定义数据目录', help: 'Claude 数据目录；空 = 自动检测。' },
    'refreshInterval': { label: '刷新间隔 (秒)', help: '' },
    'fileWatchSeconds': { label: '实时刷新延迟', help: '在最后一次本地 JSONL 变更后等待多久再刷新（静默期防抖；每个新事件都会重新计时）。不会调用 API；配额查询单独节流。“关闭”会停用监控，60–300 秒最适合降低大历史的 CPU 负载。' },
    'showInsights': { label: '显示实验性洞察', help: '默认关闭。在 Content 标签页加入「实验性洞察」区块（缓存损耗账单、各模型缓存有效时长、大单轮、活跃时段、技能 ROI）——皆为本地日志的启发式估算，已标注为估计值。' },
    'showConversationViewer': { label: '启用对话查看器', help: '默认开启。在「会话」标签页加入「查看」按钮，可只读地重读先前的对话，而不会载入模型上下文。只读取本地日志。' },
    'dashboardAutoRefresh': { label: '仪表板自动刷新', help: '有新用量时自动刷新仪表板。关闭 = 仅手动刷新（状态栏仍会更新）。' },
    'enableContentAnalysis': { label: '内容分析 (Content 选项卡)', help: '禁用以跳过 CPU 密集型文本扫描。' },
    'analysis.calibrate': { label: '校准内容数据', help: '将估计值缩放至确切的计费 token 总数。' },
    'advice.effectiveness.enabled': { label: '启用 AI 建议有效性预览', help: '默认关闭。显示本地证据、精确 BYOK 请求预览、反馈与比较；只有另行点击后才会发送。' },
    'advice.apiKey': { label: 'API 密钥', help: '用于 api 后端。只存入 VS Code SecretStorage，不同步，也不发送到仪表板。' },
    'advice.apiFormat': { label: 'API 格式', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API URL', help: 'api 后端的端点。' },
    'advice.model': { label: 'API 模型', help: '' },
    'advice.reasoningEffort': { label: '推理努力度 (openai)', help: '' },
    'advice.promptWindowDays': { label: '证据与提示窗口 (天数)', help: '' },
    'advice.userContext': { label: '个人/项目上下文', help: '可选；仅在另行同意提示个性化后发送，并完整显示在精确预览中。' },
    'advice.optimizer.enabled': { label: '启用使用优化器', help: '在「Content」选项卡上显示自愿加入的 Optimizer 卡片。' },
  },
  'ja': {
    'language': { label: '表示言語', help: 'UI 言語。"auto" は VS Code に従います。' },
    'decimalPlaces': { label: 'コストの小数点以下桁数', help: '' },
    'displayCurrency': { label: 'コスト表示通貨', help: '表示専用です。2026-09-09 時点の内蔵参考レートを使用します。レートは編集も取得もせず、基礎となる推定値は USD のままです。' },
    'tokenDecimalPlaces': { label: 'トークンの小数点以下桁数', help: 'トークンの短縮表示（1.2M / 345.6K）の小数桁数。完全な整数値には影響しません。' },
    'compactNumbers': { label: 'トークン数を短縮表記', help: '完全な数値の代わりに 1.2M / 345K と表示します。' },
    'releaseAnnouncements': { label: 'リリース通知', help: '拡張機能のアップグレード後に新機能を一度通知します。' },
    'pricingBackend': { label: 'Claude の価格ソース', help: 'Claude Code を Bedrock 経由でルーティングする場合は AWS Bedrock のリージョン内価格を選択します。' },
    'codex.enabled': { label: 'Codex Beta を有効化', help: 'ローカルの Codex セッションログからプライバシー安全な使用量集計を読み取ります。' },
    'codex.dataDirectory': { label: 'カスタム Codex データディレクトリ', help: '空欄の場合は CODEX_HOME、次に ~/.codex。認証ファイルは読みません。' },
    'codex.fileWatchSeconds': { label: 'Codex ライブ更新遅延', help: 'ローカル Codex JSONL 変更後の静かなデバウンス。オフで監視を無効化します。' },
    'codex.optimization.enabled': { label: 'Codex の行動最適化を表示', help: 'ローカルで決定論的な Codex の行動指標と提案を表示します。' },
    'statusBarProvider': { label: 'ステータスバーのプロバイダー', help: '両方にデータがある場合、自動は Claude を優先します。' },
    'codex.statusMetric': { label: 'Codex ステータスメトリック', help: '今日の非キャッシュ使用量、処理済みトークン、または出力トークン。' },
    'timezone': { label: '日付のタイムゾーン', help: '一般的なゾーンまたは UTC オフセット（全オフセット対応）、あるいはシステム既定。ラベルは現在の UTC オフセットを表示。' },
    'showWeeklyEquivalentValue': { label: '週間 API 等価価値を表示', help: '既定でオン。「すべて」と「比較」に過去の週間 API 等価価値を表示します。これは推定値であり、請求額やサブスクリプション利用枠ではありません。' },
    'showProjectUsageMatrix': { label: 'プロジェクト使用量マトリクスを表示', help: '既定でオン。「プロジェクト」にローカルの30/90日トークンヒートマップと積み上げトレンドを追加します。既存のインデックス集計を再利用し、サブスクリプション枠をプロジェクト別に配分しません。' },
    'showHeatmap': { label: 'トークンヒートマップを表示（「すべて」タブ）', help: '既定でオフ。GitHub 風の年間ヒートマップ。SVG 書き出しや GitHub プロフィールへの公開が可能。' },
    'showEfficiency': { label: '効率インサイトを表示', help: '既定でオフ。メッセージ単価、メッセージ当たりトークン、キャッシュ節約、キャッシュ保温推定を追加。' },
    'showCostliestMessages': { label: '「最も高価なメッセージ Top 10」を表示', help: '既定でオフ。最も高価な単一ターンを順位付け。展開でプロンプト表示（自分の文章）。' },
    'enableShareCard': { label: '共有ワークスペースを有効化', help: '既定でオン。「比較」の共有ワークスペースとプロバイダーの共有カードを表示します。オフにすると共有 UI を隠し、書き出しは引き続き明示操作です。' },
    'enableSessionActions': { label: 'セッション操作（再開と削除）', help: '既定はオフ。セッションタブに「再開」と「削除」ボタンを表示します。どちらもあなたの Claude Code を操作します（会話を再度開く／ログをゴミ箱へ）。読み取り専用のこの拡張とは相容れないため、まとめてオプトインです。' },
    'projectGroupingMode': { label: 'プロジェクトのグループ化', help: 'git = リポジトリごと · folder = トップレベル · flat = 各 cwd。' },
    'showCost': { label: '今日のコスト / トークンを表示', help: '' },
    'statusBarMetric': { label: 'ステータスバー指標', help: '最初のステータスバー項目に表示するもの：今日のコスト、または今日の総トークン数 (k/M)。' },
    'showContext': { label: 'コンテキストウィンドウの使用率を表示 (experimental)', help: 'デフォルトはオフ。最新のログレコードから、/context のように現在のセッションのコンテキスト使用率を推定します。入力側の合計のみ表示でき、/context のカテゴリーごとの内訳は表示できません（それらはディスクに書き込まれない Claude Code 内部の情報です）。そのため近似値であり、"~" は推測されるウィンドウサイズを示します。' },
    'contextWindowOverride': { label: 'コンテキストウィンドウの上書き (トークン)', help: '0 = モデルから自動検出。自動検出で認識できないプロキシ/カスタムモデルに対して、実際のウィンドウ（例: 1000000）を設定します。' },
    'usageLimitTracking': { label: '5時間 / 週間クォータを表示', help: '' },
    'showScopedWeekly': { label: 'モデル別の週間制限を表示', help: 'プランがモデル別に計測する週間上限を週間の数値に含めます(例:「wk 9% (fable 17%)」)。使用量が発生してから表示されます。名称は Anthropic 由来のため、実際に制限されているモデルに追従します。オフにしてもツールチップからは消えません。' },
    'quotaFiveHourOnly': { label: 'クォータ：5時間ウィンドウのみ', help: 'ステータスバーに 5 時間クォータのみ表示し、週間の数値を隠します（リセット詳細は tooltip に残ります）。' },
    'showResetInStatusBar': { label: 'クォータ：リセットのカウントダウンを表示', help: 'ステータスバーに簡潔なリセットのカウントダウンを追加（5h 6% ↻4.8h）。オフだとすっきり（5h 6% · wk 1%）。tooltip には常に完全なリセット時刻を表示します。' },
    'resetCountdownFormat': { label: 'クォータ：リセットのカウントダウン形式', help: '「クォータ：リセットのカウントダウンを表示」がオンのときのみ適用されます。10進数（4.8h / 1.6d）、単位表示（4h 48m / 1d 14h）、またはお使いのコンピュータのローカル時刻／日付（18:20 / 2026-07-22）。' },
    'statusBarQuotaFormat': { label: 'クォータ：ステータスバーの書式', help: '空なら組み込みのレイアウト（5h 6% · wk 1%）。指定する場合は {5h.pct}、{wk.pct}（または {7d.pct}）、{model:Fable.pct}。いずれも .reset と .label を取れます — 例「{5h.pct} | {7d.pct} · {model:Fable.pct}」。プランが報告しないウィンドウは空になります。.reset には個別の形式を指定できます：{5h.reset:units}、:decimal、:clock、:at（時刻）。' },
    'workflowQuotaWarnPercent': { label: 'ワークフロークォータ警告 %', help: '残りの 5 時間クォータがこれを下回る場合、実行前に警告します。0 = オフ。' },
    'dataDirectory': { label: 'カスタムデータディレクトリ', help: 'Claude データディレクトリ。空 = 自動検出。' },
    'refreshInterval': { label: '更新間隔 (秒)', help: '' },
    'fileWatchSeconds': { label: 'ライブ更新の遅延', help: '最後のローカル JSONL 変更から更新まで待つ時間です（quiet debounce。新しいイベントごとに待ち時間をリセット）。API は呼び出さず、クォータ取得は別に抑制されます。Off で監視を無効化し、大きな履歴では 60～300 秒が最も CPU 負荷を抑えます。' },
    'showInsights': { label: '実験的インサイトを表示', help: '既定はオフ。Content タブに「実験的インサイト」セクションを追加します（キャッシュ損耗、モデル別キャッシュ有効時間、大きな単発ターン、活動時間帯、スキル ROI）。いずれもローカルログからのヒューリスティックな推定で、推定値として表示されます。' },
    'showConversationViewer': { label: '会話ビューアを有効化', help: '既定はオン。セッションタブに「表示」ボタンを追加し、過去の会話をモデルのコンテキストに読み込まずに読み取り専用で読み返せます。ローカルログのみを読み取ります。' },
    'dashboardAutoRefresh': { label: 'ダッシュボードの自動更新', help: '新しい使用があるとダッシュボードを自動更新します。オフ = 手動更新のみ（ステータスバーは更新を続行）。' },
    'enableContentAnalysis': { label: 'コンテンツ分析 (Content タブ)', help: 'CPU負荷の高いテキストスキャンをスキップするには無効にします。' },
    'analysis.calibrate': { label: 'コンテンツ数値を調整', help: '推定値を正確な課金トークン総数に合わせて拡大縮小します。' },
    'advice.effectiveness.enabled': { label: 'AI アドバイス有効性プレビューを有効化', help: 'デフォルトは無効です。ローカル根拠、正確な BYOK リクエストプレビュー、フィードバック、比較を表示し、別のクリック後にだけ送信します。' },
    'advice.apiKey': { label: 'API キー', help: 'api バックエンド用。VS Code SecretStorage のみに保存され、同期もダッシュボードへの送信も行いません。' },
    'advice.apiFormat': { label: 'API 形式', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API URL', help: 'api バックエンドのエンドポイント。' },
    'advice.model': { label: 'API モデル', help: '' },
    'advice.reasoningEffort': { label: '推論努力 (openai)', help: '' },
    'advice.promptWindowDays': { label: '根拠とプロンプトの期間 (日数)', help: '' },
    'advice.userContext': { label: '個人/プロジェクトのコンテキスト', help: '任意です。別のプロンプト個人化同意後だけ送信し、正確なプレビューに全文を表示します。' },
    'advice.optimizer.enabled': { label: 'Usage Optimizer を有効にする', help: '「Content」タブにオプトインの Optimizer カードを表示します。' },
  },
  'ko': {
    'language': { label: '표시 언어', help: 'UI 언어. "auto"는 VS Code를 따릅니다.' },
    'decimalPlaces': { label: '비용 소수점 자리수', help: '' },
    'displayCurrency': { label: '비용 표시 통화', help: '표시에만 사용됩니다. 2026-09-09 기준 내장 환율을 사용하며 수정하거나 가져오지 않습니다. 기본 추정치는 USD로 유지됩니다.' },
    'tokenDecimalPlaces': { label: '토큰 소수점 자리수', help: '간략한 토큰 표시(1.2M / 345.6K)의 소수 자리수. 전체 정수 값에는 영향을 주지 않습니다.' },
    'compactNumbers': { label: '간략한 토큰 수 표시', help: '전체 숫자 대신 1.2M / 345K로 표시합니다.' },
    'releaseAnnouncements': { label: '릴리스 알림', help: '확장 업그레이드 후 새 기능 알림을 한 번 표시합니다.' },
    'pricingBackend': { label: 'Claude 가격 출처', help: 'Claude Code가 Bedrock을 통해 라우팅될 때 AWS Bedrock 리전 내 가격을 선택합니다.' },
    'codex.enabled': { label: 'Codex Beta 사용', help: '로컬 Codex 세션 로그에서 개인정보 보호형 사용량 집계를 읽습니다.' },
    'codex.dataDirectory': { label: '사용자 지정 Codex 데이터 디렉터리', help: '비우면 CODEX_HOME, 그다음 ~/.codex를 사용하며 인증 파일은 읽지 않습니다.' },
    'codex.fileWatchSeconds': { label: 'Codex 실시간 새로고침 지연', help: '로컬 Codex JSONL 변경 후 조용한 디바운스입니다. 끄면 감시를 중지합니다.' },
    'codex.optimization.enabled': { label: 'Codex 행동 최적화 표시', help: '로컬의 결정론적 Codex 행동 지표와 권장 사항을 표시합니다.' },
    'statusBarProvider': { label: '상태 표시줄 공급자', help: '두 공급자 모두 데이터가 있으면 자동은 Claude를 우선합니다.' },
    'codex.statusMetric': { label: 'Codex 상태 지표', help: '오늘의 캐시되지 않은 사용량, 처리된 토큰 또는 출력 토큰.' },
    'timezone': { label: '날짜 시간대', help: '일반 지역 또는 UTC 오프셋(모든 오프셋 지원), 또는 시스템 기본값. 라벨에 현재 UTC 오프셋 표시.' },
    'showWeeklyEquivalentValue': { label: '주간 API 등가 가치 표시', help: '기본값 켜짐. 전체 및 비교 화면에 과거 주간 API 등가 가치를 표시합니다. 이는 추정치이며 청구서나 구독 할당량이 아닙니다.' },
    'showProjectUsageMatrix': { label: '프로젝트 사용량 매트릭스 표시', help: '기본값 켜짐. 프로젝트에 로컬 30/90일 토큰 히트맵과 누적 추세를 추가합니다. 기존 인덱스 집계를 재사용하며 구독 할당량을 프로젝트별로 배분하지 않습니다.' },
    'showHeatmap': { label: '토큰 히트맵 표시(전체 탭)', help: '기본 꺼짐. GitHub 스타일 연간 히트맵. SVG 내보내기 또는 GitHub 프로필에 게시 가능.' },
    'showEfficiency': { label: '효율 인사이트 표시', help: '기본 꺼짐. 메시지당 비용/토큰, 캐시 절감, 캐시 보온 추정치를 추가.' },
    'showCostliestMessages': { label: '“가장 비싼 메시지 Top 10” 표시', help: '기본 꺼짐. 가장 비싼 단일 턴을 순위화. 펼치면 프롬프트 표시(본인 텍스트).' },
    'enableShareCard': { label: '공유 작업 공간 사용', help: '기본 켜짐. 비교 공유 작업 공간과 공급자 공유 카드를 표시합니다. 끄면 공유 UI가 숨겨지며 내보내기는 계속 명시적 작업입니다.' },
    'enableSessionActions': { label: '세션 작업(재개 및 삭제)', help: '기본값 꺼짐. 세션 탭에 재개·삭제 버튼을 표시합니다. 둘 다 사용자의 Claude Code를 조작하므로(대화 다시 열기/로그를 휴지통으로) 읽기 전용인 이 확장과 맞지 않아 함께 옵트인으로 둡니다.' },
    'projectGroupingMode': { label: '프로젝트 그룹화', help: 'git = 저장소별 · folder = 최상위 · flat = 각 cwd.' },
    'showCost': { label: '오늘의 비용 / 토큰 표시', help: '' },
    'statusBarMetric': { label: '상태 표시줄 지표', help: '첫 번째 상태 표시줄 항목에 표시할 내용: 오늘의 비용 또는 오늘의 총 토큰 수 (k/M).' },
    'showContext': { label: '컨텍스트 창 채우기 표시 (experimental)', help: '기본값은 꺼짐. 최신 로그 레코드를 기반으로 /context와 유사하게 현재 세션의 컨텍스트 비율을 추정합니다. 입력 측 합계만 표시할 수 있으며 /context의 카테고리별 분석은 표시할 수 없습니다 (디스크에 기록되지 않는 Claude Code 내부 정보이므로). 따라서 근사치이며 "~"는 추측된 창 크기를 나타냅니다.' },
    'contextWindowOverride': { label: '컨텍스트 창 재정의 (토큰)', help: '0 = 모델에서 자동 감지. 자동 감지에서 인식할 수 없는 프록시/사용자 지정 모델에 실제 창(예: 1000000)을 설정하세요.' },
    'usageLimitTracking': { label: '5시간 / 주간 할당량 표시', help: '' },
    'showScopedWeekly': { label: '모델별 주간 제한 표시', help: '요금제가 모델별로 측정하는 주간 한도를 주간 수치에 함께 표시합니다(예: "wk 9% (fable 17%)"). 사용량이 생긴 뒤에 나타납니다. 이름은 Anthropic에서 제공하므로 실제로 제한되는 모델을 따릅니다. 꺼도 툴팁에서는 사라지지 않습니다.' },
    'quotaFiveHourOnly': { label: '할당량: 5시간 창만', help: '상태 표시줄에 5시간 할당량만 표시하고 주간 수치는 숨깁니다(초기화 세부정보는 tooltip에 유지).' },
    'showResetInStatusBar': { label: '할당량: 초기화 카운트다운 표시', help: '상태 표시줄에 간결한 초기화 카운트다운을 추가합니다(5h 6% ↻4.8h). 끄면 깔끔하게 유지(5h 6% · wk 1%); tooltip에는 항상 전체 초기화 시각이 표시됩니다.' },
    'resetCountdownFormat': { label: '할당량: 초기화 카운트다운 형식', help: '"할당량: 초기화 카운트다운 표시"가 켜져 있을 때만 적용됩니다. 소수(4.8h / 1.6d), 단위(4h 48m / 1d 14h), 또는 사용자 컴퓨터의 현지 시각/날짜(18:20 / 2026-07-22) 중 선택합니다.' },
    'statusBarQuotaFormat': { label: '할당량: 상태 표시줄 형식', help: '비워 두면 기본 레이아웃(5h 6% · wk 1%)을 사용합니다. 그 외에는 {5h.pct}, {wk.pct}(또는 {7d.pct}), {model:Fable.pct}. 각각 .reset과 .label도 쓸 수 있습니다 — 예: "{5h.pct} | {7d.pct} · {model:Fable.pct}". 요금제가 보고하지 않는 창은 비어 있게 표시됩니다. .reset에는 개별 형식을 지정할 수 있습니다: {5h.reset:units}, :decimal, :clock 또는 :at(시각).' },
    'workflowQuotaWarnPercent': { label: '워크플로우 할당량 경고 %', help: '남은 5시간 할당량이 이보다 낮을 때 실행 전에 경고합니다. 0 = 끄기.' },
    'dataDirectory': { label: '사용자 지정 데이터 디렉터리', help: 'Claude 데이터 디렉터리; 비워두면 자동 감지.' },
    'refreshInterval': { label: '새로 고침 간격 (초)', help: '' },
    'fileWatchSeconds': { label: '실시간 새로고침 지연', help: '마지막 로컬 JSONL 변경 후 새로 고침까지 기다리는 시간입니다(quiet debounce, 새 이벤트마다 대기 시간이 다시 시작됨). API를 호출하지 않으며 할당량 조회는 별도로 제한됩니다. 끄기는 감시를 비활성화하고, 큰 기록에서는 60~300초가 CPU 부담을 가장 줄입니다.' },
    'showInsights': { label: '실험적 인사이트 표시', help: '기본값 꺼짐. Content 탭에 "실험적 인사이트" 섹션을 추가합니다(캐시 소모 청구, 모델별 캐시 유지 시간, 대형 단일 턴, 활동 시간대, 스킬 ROI). 모두 로컬 로그 기반 추정치이며 추정값으로 표시됩니다.' },
    'showConversationViewer': { label: '대화 뷰어 사용', help: '기본값 켜짐. 세션 탭에 "보기" 버튼을 추가하여 이전 대화를 모델 컨텍스트에 불러오지 않고 읽기 전용으로 다시 읽을 수 있습니다. 로컬 로그만 읽습니다.' },
    'dashboardAutoRefresh': { label: '대시보드 자동 새로 고침', help: '새 사용량이 들어오면 대시보드를 자동 새로 고침. 끄면 수동 새로 고침만(상태 표시줄은 계속 업데이트).' },
    'enableContentAnalysis': { label: '콘텐츠 분석 (Content 탭)', help: 'CPU 사용이 많은 텍스트 검사를 건너뛰려면 비활성화하세요.' },
    'analysis.calibrate': { label: '콘텐츠 수치 보정', help: '예상치를 정확한 청구 토큰 총합에 맞게 조정합니다.' },
    'advice.effectiveness.enabled': { label: 'AI 조언 효과성 미리보기 활성화', help: '기본적으로 꺼져 있습니다. 로컬 근거, 정확한 BYOK 요청 미리보기, 피드백, 비교를 표시하며 별도 클릭 후에만 전송합니다.' },
    'advice.apiKey': { label: 'API 키', help: 'api 백엔드용. VS Code SecretStorage에만 저장되며 동기화되거나 대시보드로 전송되지 않습니다.' },
    'advice.apiFormat': { label: 'API 형식', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API URL', help: 'api 백엔드의 엔드포인트.' },
    'advice.model': { label: 'API 모델', help: '' },
    'advice.reasoningEffort': { label: '추론 노력 (openai)', help: '' },
    'advice.promptWindowDays': { label: '근거 및 프롬프트 기간 (일)', help: '' },
    'advice.userContext': { label: '개인/프로젝트 컨텍스트', help: '선택 사항이며 별도의 프롬프트 개인화 동의 후에만 전송되고 정확한 미리보기에 모두 표시됩니다.' },
    'advice.optimizer.enabled': { label: '사용량 최적화 도구 활성화', help: 'Content 탭에 옵트인 Optimizer 카드를 표시합니다.' },
  },
  'pt-BR': {
    'language': { label: 'Idioma de exibição', help: 'Idioma da interface. "auto" segue o VS Code.' },
    'decimalPlaces': { label: 'Casas decimais do custo', help: '' },
    'displayCurrency': { label: 'Moeda de exibição do custo', help: 'Somente exibição. Usa taxas de referência integradas de 09/09/2026; elas não são editáveis nem buscadas, e as estimativas continuam em USD.' },
    'tokenDecimalPlaces': { label: 'Casas decimais de tokens', help: 'Casas decimais para a exibição compacta de tokens (1.2M / 345.6K). As contagens inteiras completas não são afetadas.' },
    'compactNumbers': { label: 'Contagem de tokens compacta', help: 'Mostra 1.2M / 345K em vez dos números completos.' },
    'releaseAnnouncements': { label: 'Avisos de versão', help: 'Mostra uma vez as novidades após atualizar a extensão.' },
    'pricingBackend': { label: 'Fonte de preços do Claude', help: 'Selecione os preços regionais da AWS Bedrock quando o Claude Code for roteado pela Bedrock.' },
    'codex.enabled': { label: 'Ativar Codex Beta', help: 'Lê agregados de uso com privacidade a partir dos logs locais de sessão do Codex.' },
    'codex.dataDirectory': { label: 'Diretório de dados Codex personalizado', help: 'Vazio = CODEX_HOME, depois ~/.codex. Arquivos de autenticação nunca são lidos.' },
    'codex.fileWatchSeconds': { label: 'Atraso da atualização ao vivo do Codex', help: 'Debounce silencioso após mudanças locais em JSONL do Codex. Desligado desativa a observação.' },
    'codex.optimization.enabled': { label: 'Mostrar otimização de comportamento do Codex', help: 'Mostra métricas e recomendações locais e determinísticas de comportamento do Codex.' },
    'statusBarProvider': { label: 'Provedor da barra de status', help: 'Auto prioriza Claude quando ambos têm dados.' },
    'codex.statusMetric': { label: 'Métrica de status do Codex', help: 'Uso de hoje sem cache, tokens processados ou tokens de saída.' },
    'timezone': { label: 'Fuso horário das datas', help: 'Zona comum ou deslocamento UTC (todos cobertos), ou padrão do sistema. Os rótulos mostram o deslocamento UTC atual.' },
    'showWeeklyEquivalentValue': { label: 'Mostrar valor equivalente semanal da API', help: 'Ligado por padrão. Mostra o valor equivalente semanal histórico da API em Todo o período e Comparar. É uma estimativa, não uma fatura nem uma franquia de assinatura.' },
    'showProjectUsageMatrix': { label: 'Mostrar matriz de uso por projeto', help: 'Ligado por padrão. Adiciona a Projetos um heatmap local de tokens de 30/90 dias e uma tendência empilhada. Reutiliza agregados indexados e não distribui a franquia da assinatura por projeto.' },
    'showHeatmap': { label: 'Mostrar heatmap de tokens (aba Todo o período)', help: 'Desligado por padrão. Heatmap anual estilo GitHub; exporte SVG ou publique no seu perfil do GitHub.' },
    'showEfficiency': { label: 'Mostrar insights de eficiência', help: 'Desligado por padrão. Custo/mensagem, tokens/mensagem, economia de cache e a estimativa de aquecimento do cache.' },
    'showCostliestMessages': { label: 'Mostrar "10 mensagens mais caras"', help: 'Desligado por padrão. Ranqueia seus turnos mais caros; ao expandir mostra o prompt (seu próprio texto).' },
    'enableShareCard': { label: 'Ativar espaço de compartilhamento', help: 'Ligado por padrão. Mostra o espaço de compartilhamento em Comparar e o cartão do provedor. Desligar oculta a interface; exportar continua exigindo uma ação explícita.' },
    'enableSessionActions': { label: 'Ações de sessão (retomar e excluir)', help: 'Desligado por padrão. Mostra os botões Retomar e Excluir na aba Sessões. Ambos AGEM sobre o seu Claude Code (reabrir uma conversa / mover o log para a lixeira), ao contrário desta extensão somente leitura, então ficam opcionais juntos.' },
    'projectGroupingMode': { label: 'Agrupamento de projetos', help: 'git = por repositório · folder = nível superior · flat = cada cwd.' },
    'showCost': { label: 'Mostrar custo / tokens de hoje', help: '' },
    'statusBarMetric': { label: 'Métrica da barra de status', help: 'O que o primeiro item da barra de status mostra: o custo de hoje ou o total de tokens de hoje (k/M).' },
    'showContext': { label: 'Mostrar ocupação da janela de contexto (experimental)', help: 'Desativado por padrão. Estima a % do contexto da sessão atual a partir do registro de log mais recente, parecido com /context. Só mostra o total do lado da entrada, não a divisão por categoria do /context (são dados internos do Claude Code, não gravados em disco), então é uma aproximação — um "~" indica um tamanho de janela estimado.' },
    'contextWindowOverride': { label: 'Substituir janela de contexto (tokens)', help: '0 = detectar automaticamente pelo modelo. Defina sua janela real (ex.: 1000000) para modelos de proxy ou personalizados que a detecção automática não reconhece.' },
    'usageLimitTracking': { label: 'Mostrar cota de 5 horas / semanal', help: '' },
    'showScopedWeekly': { label: 'Mostrar limite semanal por modelo', help: 'Acrescenta ao valor semanal qualquer teto semanal específico de modelo que seu plano medir, por ex. "wk 9% (fable 17%)", assim que houver uso. O nome vem da Anthropic, então acompanha o modelo que estiver limitado. Desligar isto não o esconde da dica de contexto.' },
    'quotaFiveHourOnly': { label: 'Cota: apenas a janela de 5 horas', help: 'Mostra apenas a cota de 5 horas na barra de status, ocultando os valores semanais (os detalhes de reinício ficam na dica de contexto).' },
    'showResetInStatusBar': { label: 'Cota: mostrar contagem regressiva de reinício', help: 'Acrescenta uma contagem regressiva compacta na barra de status (5h 6% ↻4.8h). Desligado mantém tudo limpo (5h 6% · wk 1%); a dica de contexto sempre mostra os horários completos de reinício.' },
    'resetCountdownFormat': { label: 'Cota: formato da contagem regressiva de reset', help: 'Só se aplica quando "Cota: mostrar contagem regressiva de reset" está ativado. Decimal (4.8h / 1.6d), unidades inteiras (4h 48m / 1d 14h), ou o horário/data local do seu computador (18:20 / 2026-07-22).' },
    'statusBarQuotaFormat': { label: 'Cota: formato da barra de status', help: 'Vazio mantém o layout embutido (5h 6% · wk 1%). Caso contrário: {5h.pct}, {wk.pct} (ou {7d.pct}) e {model:Fable.pct}, cada uma aceitando também .reset e .label — ex.: "{5h.pct} | {7d.pct} · {model:Fable.pct}". Uma janela que seu plano não reporta fica vazia. .reset pode ter estilo próprio: {5h.reset:units}, :decimal, :clock ou :at (hora).' },
    'workflowQuotaWarnPercent': { label: 'Aviso de cota de workflow %', help: 'Avisa antes de uma execução quando a cota de 5h restante estiver abaixo disto. 0 = desligado.' },
    'dataDirectory': { label: 'Diretório de dados personalizado', help: 'Diretório de dados do Claude; vazio = detectar automaticamente.' },
    'refreshInterval': { label: 'Intervalo de atualização (s)', help: '' },
    'fileWatchSeconds': { label: 'Atraso da atualização em tempo real', help: 'Tempo de espera após a última alteração JSONL local antes de atualizar (quiet debounce; cada novo evento reinicia a espera). Nenhuma API é chamada; as consultas de cota são limitadas separadamente. “Desligado” desativa o monitoramento, e 60–300 s reduz mais a CPU em históricos grandes.' },
    'showInsights': { label: 'Mostrar insights experimentais', help: 'Desligado por padrão. Adiciona uma seção "Insights experimentais" na aba Content (conta de desgaste de cache, calor de cache por modelo, turnos únicos grandes, horas ativas, ROI de skills) — estimativas heurísticas dos seus logs locais, rotuladas como estimativas.' },
    'showConversationViewer': { label: 'Ativar visualizador de conversas', help: 'Ligado por padrão. Adiciona um botão de visualização na aba Sessões para reler uma conversa anterior somente leitura, sem carregá-la no contexto do modelo. Lê apenas logs locais.' },
    'dashboardAutoRefresh': { label: 'Atualização automática do painel', help: 'Atualiza o painel automaticamente conforme novo uso aparece. Desligado = apenas atualização manual (a barra de status continua atualizando).' },
    'pauseDashboardRefresh': { label: 'Pausar atualização do dashboard', help: 'A barra de status continua atualizando; o dashboard só atualiza manualmente.' },
    'enableContentAnalysis': { label: 'Análise de conteúdo (aba Content)', help: 'Desative para pular a varredura de texto, que usa muita CPU.' },
    'analysis.calibrate': { label: 'Calibrar números de conteúdo', help: 'Ajusta as estimativas aos totais exatos de tokens cobrados.' },
    'advice.effectiveness.enabled': { label: 'Ativar prévia de eficácia dos conselhos de IA', help: 'Desativado por padrão. Mostra evidências locais, prévia exata da solicitação BYOK, feedback e comparação; só envia após um clique separado.' },
    'advice.apiKey': { label: 'Chave de API', help: 'Para o backend api. Fica apenas no VS Code SecretStorage, sem sincronização nem envio ao painel.' },
    'advice.apiFormat': { label: 'Formato da API', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'URL da API', help: 'Endpoint do backend api.' },
    'advice.model': { label: 'Modelo da API', help: '' },
    'advice.reasoningEffort': { label: 'Esforço de raciocínio (openai)', help: '' },
    'advice.promptWindowDays': { label: 'Janela de evidências e prompts (dias)', help: '' },
    'advice.userContext': { label: 'Contexto pessoal/do projeto', help: 'Opcional; só é enviado após consentimento separado de personalização e aparece por inteiro na prévia exata.' },
    'advice.optimizer.enabled': { label: 'Ativar o Otimizador de uso', help: 'Mostra o cartão opt-in do Optimizer na aba Content.' },
  },
  'id': {
    'language': { label: 'Bahasa tampilan', help: 'Bahasa UI. "auto" mengikuti VS Code.' },
    'decimalPlaces': { label: 'Angka desimal biaya', help: '' },
    'displayCurrency': { label: 'Mata uang tampilan biaya', help: 'Hanya untuk tampilan. Menggunakan kurs referensi bawaan per 2026-09-09; kurs tidak dapat diedit atau diambil, dan estimasi dasar tetap USD.' },
    'tokenDecimalPlaces': { label: 'Angka desimal token', help: 'Angka desimal untuk tampilan token ringkas (1.2M / 345.6K). Jumlah bilangan bulat penuh tidak terpengaruh.' },
    'compactNumbers': { label: 'Jumlah token ringkas', help: 'Tampilkan 1.2M / 345K, bukan angka penuh.' },
    'releaseAnnouncements': { label: 'Pengumuman rilis', help: 'Tampilkan sekali hal baru setelah ekstensi ditingkatkan.' },
    'pricingBackend': { label: 'Sumber harga Claude', help: 'Pilih harga AWS Bedrock dalam-region saat Claude Code dirutekan melalui Bedrock.' },
    'codex.enabled': { label: 'Aktifkan Codex Beta', help: 'Baca agregat penggunaan yang aman untuk privasi dari log sesi Codex lokal.' },
    'codex.dataDirectory': { label: 'Direktori data Codex kustom', help: 'Kosong = CODEX_HOME, lalu ~/.codex. Berkas autentikasi tidak pernah dibaca.' },
    'codex.fileWatchSeconds': { label: 'Jeda penyegaran langsung Codex', help: 'Debounce tenang setelah perubahan JSONL Codex lokal. Mati menonaktifkan pemantauan.' },
    'codex.optimization.enabled': { label: 'Tampilkan optimasi perilaku Codex', help: 'Tampilkan metrik dan rekomendasi perilaku Codex yang lokal dan deterministik.' },
    'statusBarProvider': { label: 'Penyedia status bar', help: 'Otomatis memprioritaskan Claude saat keduanya memiliki data.' },
    'codex.statusMetric': { label: 'Metrik status Codex', help: 'Penggunaan hari ini tanpa cache, token diproses, atau token output.' },
    'timezone': { label: 'Zona waktu untuk tanggal', help: 'Pilih zona umum atau offset UTC (semua offset tersedia), atau default sistem. Label menampilkan offset UTC saat ini.' },
    'showWeeklyEquivalentValue': { label: 'Tampilkan nilai ekuivalen API mingguan', help: 'Aktif secara default. Tampilkan riwayat nilai ekuivalen API mingguan di Sepanjang Waktu dan Perbandingan. Ini perkiraan, bukan tagihan atau jatah langganan.' },
    'showProjectUsageMatrix': { label: 'Tampilkan matriks penggunaan proyek', help: 'Aktif secara default. Menambahkan heatmap Token lokal 30/90 hari dan tren bertumpuk ke Proyek. Menggunakan kembali agregat indeks dan tidak membagi jatah langganan per proyek.' },
    'showHeatmap': { label: 'Tampilkan heatmap token (tab Sepanjang Waktu)', help: 'Nonaktif secara default. Heatmap token tahunan bergaya GitHub di tab All; ekspor sebagai SVG atau publikasikan ke profil GitHub Anda.' },
    'showEfficiency': { label: 'Tampilkan wawasan efisiensi', help: 'Nonaktif secara default. Menambahkan biaya/pesan, token/pesan, penghematan cache, dan perkiraan cache warmth.' },
    'showCostliestMessages': { label: 'Tampilkan "10 pesan termahal"', help: 'Nonaktif secara default. Menampilkan giliran termahal; membuka detail menampilkan prompt-nya (teks Anda sendiri).' },
    'enableShareCard': { label: 'Aktifkan ruang kerja berbagi', help: 'Aktif secara default. Menampilkan ruang kerja berbagi Perbandingan dan kartu penyedia. Menonaktifkannya menyembunyikan UI; ekspor tetap memerlukan tindakan eksplisit.' },
    'enableSessionActions': { label: 'Aksi sesi (Lanjutkan & Hapus)', help: 'Nonaktif secara default. Menampilkan tombol Lanjutkan dan Hapus di tab Sesi. Keduanya BERTINDAK pada Claude Code Anda (membuka ulang percakapan / memindahkan log ke sampah) — bertentangan dengan sifat baca-saja extension ini, jadi tetap opsional bersama.' },
    'projectGroupingMode': { label: 'Pengelompokan proyek', help: 'git = per repo · folder = level teratas · flat = setiap cwd.' },
    'showCost': { label: 'Tampilkan biaya / token hari ini', help: '' },
    'statusBarMetric': { label: 'Metrik status bar', help: 'Apa yang ditampilkan item status bar pertama: biaya hari ini, biaya bulan ini, atau total token hari ini (k/M).' },
    'showContext': { label: 'Tampilkan pengisian jendela konteks (eksperimental)', help: 'Nonaktif secara default. Memperkirakan persentase konteks sesi saat ini, seperti /context, dari catatan log terbaru. Hanya bisa menampilkan total sisi masukan, bukan rincian kategori /context (itu internal Claude Code yang tidak ditulis ke disk), jadi ini perkiraan — tanda "~" menandai ukuran jendela yang ditebak.' },
    'contextWindowOverride': { label: 'Override jendela konteks (token)', help: '0 = deteksi otomatis dari model. Atur jendela sebenarnya (mis. 1000000) untuk model proxy/kustom yang tidak dikenali deteksi otomatis.' },
    'usageLimitTracking': { label: 'Tampilkan kuota 5 jam / mingguan', help: '' },
    'showScopedWeekly': { label: 'Tampilkan batas mingguan per model', help: 'Menambahkan batas mingguan khusus model yang diukur paket Anda ke angka mingguan, mis. "wk 9% (fable 17%)", setelah ada penggunaan. Namanya berasal dari Anthropic, sehingga mengikuti model mana pun yang dibatasi. Mematikan ini tidak menyembunyikannya dari tooltip.' },
    'quotaFiveHourOnly': { label: 'Kuota: hanya periode 5 jam', help: 'Hanya tampilkan kuota 5 jam di status bar, sembunyikan angka mingguan (detail reset tetap di tooltip).' },
    'showResetInStatusBar': { label: 'Kuota: tampilkan hitung mundur reset', help: 'Tambahkan hitung mundur reset ringkas di status bar (5h 6% ↻4.8h). Nonaktif membuatnya bersih (5h 6% · wk 1%); tooltip selalu menampilkan waktu reset lengkap.' },
    'resetCountdownFormat': { label: 'Kuota: format hitungan mundur reset', help: 'Hanya berlaku saat "Kuota: tampilkan hitungan mundur reset" aktif. Desimal (4.8h / 1.6d), satuan bulat (4h 48m / 1d 14h), atau waktu / tanggal jam lokal komputer Anda (18:20 / 2026-07-22).' },
    'statusBarQuotaFormat': { label: 'Kuota: format bilah status', help: 'Kosong mempertahankan tata letak bawaan (5h 6% · wk 1%). Jika tidak: {5h.pct}, {wk.pct} (atau {7d.pct}) dan {model:Fable.pct}, masing-masing juga menerima .reset dan .label — mis. "{5h.pct} | {7d.pct} · {model:Fable.pct}". Jendela yang tidak dilaporkan paket Anda akan kosong. .reset dapat memakai gaya sendiri: {5h.reset:units}, :decimal, :clock atau :at (jam).' },
    'workflowQuotaWarnPercent': { label: 'Peringatan kuota workflow %', help: 'Beri peringatan sebelum proses berjalan jika sisa kuota 5 jam di bawah ini. 0 = nonaktif.' },
    'dataDirectory': { label: 'Direktori data kustom', help: 'Direktori data Claude; kosong = deteksi otomatis.' },
    'refreshInterval': { label: 'Interval penyegaran (dtk)', help: '' },
    'fileWatchSeconds': { label: 'Jeda penyegaran live', help: 'Seberapa cepat dashboard menyegarkan setelah ada aktivitas baru. Ini hanya membaca ulang file log LOKAL Anda (tanpa panggilan API — pengambilan kuota dibatasi terpisah). "Off" menonaktifkan pemantauan live; jeda lebih lama lebih ringan untuk CPU.' },
    'showInsights': { label: 'Tampilkan wawasan eksperimental', help: 'Nonaktif secara default. Menambahkan bagian "Wawasan eksperimental" di tab Konten — perkiraan kami sendiri dari log lokal Anda (mis. tagihan cache-churn: $ yang dihabiskan menulis ulang cache setelah pergantian model / jeda idle). Ini adalah heuristik hasil perhitungan, bukan metrik standar, jadi tetap opsional dan diberi label sebagai perkiraan.' },
    'showConversationViewer': { label: 'Aktifkan penampil percakapan', help: 'Aktif secara default. Tab Sesi menampilkan tombol "lihat" yang membuka pembaca baca-saja untuk percakapan lampau — sehingga Anda bisa membaca ulang prompt dan jawaban model TANPA memuatnya kembali ke konteks model (berbeda dari resume). Hanya membaca file log lokal Anda (baca-saja), jadi aktif secara default; nonaktifkan untuk menyembunyikan tombolnya.' },
    'dashboardAutoRefresh': { label: 'Penyegaran otomatis dashboard', help: 'Segarkan dashboard secara otomatis saat ada penggunaan baru. Nonaktif = hanya penyegaran manual (status bar tetap diperbarui).' },
    'enableContentAnalysis': { label: 'Analisis konten (tab Konten)', help: 'Nonaktifkan untuk melewati pemindaian teks yang berat bagi CPU.' },
    'analysis.calibrate': { label: 'Kalibrasi angka konten', help: 'Skalakan perkiraan ke total token yang benar-benar ditagih.' },
    'advice.effectiveness.enabled': { label: 'Aktifkan pratinjau efektivitas saran AI', help: 'Nonaktif secara default. Menampilkan bukti lokal, pratinjau permintaan BYOK yang persis, umpan balik, dan perbandingan; hanya mengirim setelah klik terpisah.' },
    'advice.apiKey': { label: 'API key', help: 'Untuk backend api. Hanya disimpan di VS Code SecretStorage, tidak disinkronkan atau dikirim ke dashboard.' },
    'advice.apiFormat': { label: 'Format API', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'URL API', help: 'Endpoint untuk backend api.' },
    'advice.model': { label: 'Model API', help: '' },
    'advice.reasoningEffort': { label: 'Effort reasoning (openai)', help: '' },
    'advice.promptWindowDays': { label: 'Jendela bukti dan prompt (hari)', help: '' },
    'advice.userContext': { label: 'Konteks pribadi/proyek', help: 'Opsional; hanya dikirim setelah persetujuan personalisasi prompt terpisah dan ditampilkan penuh dalam pratinjau persis.' },
    'advice.optimizer.enabled': { label: 'Aktifkan Usage Optimizer', help: 'Tampilkan kartu Optimizer opsional di tab Konten.' },
  },
};

export class I18n {
  private static currentLanguage: SupportedLanguage = 'en';
  private static currentDecimalPlaces: number = 2;
  private static currencyDisplay = resolveCurrencyDisplay('USD');
  // Decimals for COMPACT token display only (1.2M / 345.6K) — separate from the
  // cost decimal places. Does not affect full integer token values.
  private static tokenDecimalPlaces: number = 1;
  private static compactNumbers: boolean = false;
  private static timezone: string = '';

  /** Locale string suitable for Intl APIs (toLocaleString, etc.). */
  static getLocale(): string {
    return this.currentLanguage;
  }

  /** IANA timezone (e.g. "Asia/Hong_Kong"), or '' to use the system zone. The
   * setting is a dropdown now, but an old synced config could still hold an
   * invalid hand-typed value — `Intl.DateTimeFormat` throws on a bad `timeZone`
   * and that crashed the whole dashboard (#51). Reject anything Intl won't
   * accept and fall back to the system zone. */
  static setTimezone(tz: string): void {
    const clean = typeof tz === 'string' ? tz.trim() : '';
    this.timezone = clean && I18n.isValidTimeZone(clean) ? clean : '';
  }

  static getTimezone(): string {
    return this.timezone;
  }

  /** True if `tz` is an IANA zone Intl accepts (so date formatting won't throw). */
  static isValidTimeZone(tz: string): boolean {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  /** Intl date-format options merged with the configured timezone (if any). */
  static dateFormatOptions(extra: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
    return this.timezone ? { ...extra, timeZone: this.timezone } : extra;
  }

  /** Set the number of decimal places used by formatCurrency (claudeCodeUsage.decimalPlaces). */
  static setDecimalPlaces(places: number): void {
    if (typeof places === 'number' && isFinite(places) && places >= 0 && places <= 4) {
      this.currentDecimalPlaces = Math.floor(places);
    }
  }

  static getDecimalPlaces(): number {
    return this.currentDecimalPlaces;
  }

  /** Set the local-only display preset; invalid values fail closed to USD. */
  static setCurrencyDisplay(currency: string): void {
    this.currencyDisplay = resolveCurrencyDisplay(currency);
  }

  static getCurrencyDisplay(): Readonly<{
    code: string;
    label: string;
    unitsPerUsd: number;
    converted: boolean;
    referenceDate: string;
  }> {
    return { ...this.currencyDisplay };
  }

  /** Decimals for compact token display, 0–2 (claudeCodeUsage.tokenDecimalPlaces). */
  static setTokenDecimalPlaces(places: number): void {
    if (typeof places === 'number' && isFinite(places) && places >= 0 && places <= 2) {
      this.tokenDecimalPlaces = Math.floor(places);
    }
  }

  /** Toggle compact number formatting, e.g. 1.2M / 345K (claudeCodeUsage.compactNumbers). */
  static setCompactNumbers(enabled: boolean): void {
    this.compactNumbers = !!enabled;
  }

  static setLanguage(lang: SupportedLanguage | 'auto'): void {
    if (lang === 'auto') {
      this.currentLanguage = this.detectLanguage();
    } else {
      this.currentLanguage = lang;
    }
  }

  static getCurrentLanguage(): SupportedLanguage {
    return this.currentLanguage;
  }

  /** Localised + English name of the current UI language, used to instruct LLMs. */
  static getLanguageName(): string {
    switch (this.currentLanguage) {
      case 'zh-CN':
        return '简体中文 (Simplified Chinese)';
      case 'zh-TW':
        return '繁體中文 (Traditional Chinese)';
      case 'ja':
        return '日本語 (Japanese)';
      case 'ko':
        return '한국어 (Korean)';
      case 'de-DE':
        return 'Deutsch (German)';
      case 'pt-BR':
        return 'Português Brasileiro (Brazilian Portuguese)';
      case 'id':
        return 'Bahasa Indonesia (Indonesian)';
      case 'en':
      default:
        return 'English';
    }
  }

  static get t(): Translations {
    return translations[this.currentLanguage];
  }

  /** Localised label / help for a settings-panel entry, for the current UI
   * language. Returns {} for English (the panel then falls back to the catalog
   * English in settings.ts). */
  static settingText(key: string): { label?: string; help?: string } {
    const m = SETTINGS_I18N[this.currentLanguage];
    return (m && m[key]) || {};
  }

  private static detectLanguage(): SupportedLanguage {
    const locale = process.env.LANG || process.env.LANGUAGE || 'en';

    if (locale.includes('zh')) {
      if (locale.includes('TW') || locale.includes('HK') || locale.includes('MO')) {
        return 'zh-TW';
      }
      return 'zh-CN';
    }

    if (locale.includes('ja')) return 'ja';
    if (locale.includes('ko')) return 'ko';
    if (locale.includes('pt')) return 'pt-BR';
    if (locale.includes('id')) return 'id';

    return 'en';
  }

  static formatCurrency(amount: number, decimalPlaces?: number): string {
    const places = decimalPlaces != null ? decimalPlaces : this.currentDecimalPlaces;
    return formatUsdForDisplay(amount, this.currencyDisplay.code, places);
  }

  /** Provider-native USD money (for example actual usage credits), never the
   * user's display conversion. */
  static formatUsdBaseline(amount: number, decimalPlaces = 2): string {
    return formatUsdBaselineValue(amount, decimalPlaces);
  }

  /** Always-compact token count (k / M / B) honouring the user's decimal
   * places — used by the status-bar "tokens" metric so it stays short. */
  static formatTokensCompact(num: number): string {
    const p = this.tokenDecimalPlaces;
    const abs = Math.abs(num);
    if (abs >= 1_000_000_000) {
      return (num / 1_000_000_000).toFixed(p) + 'B';
    }
    if (abs >= 1_000_000) {
      return (num / 1_000_000).toFixed(p) + 'M';
    }
    if (abs >= 1_000) {
      return (num / 1_000).toFixed(p) + 'k';
    }
    return num.toLocaleString(this.currentLanguage);
  }

  static formatNumber(num: number): string {
    if (this.compactNumbers) {
      // Compact token display honours tokenDecimalPlaces (0–2); parseFloat trims
      // trailing zeros so 1.20M reads as 1.2M.
      const p = this.tokenDecimalPlaces;
      const abs = Math.abs(num);
      if (abs >= 1_000_000_000) {
        return parseFloat((num / 1_000_000_000).toFixed(p)) + 'B';
      }
      if (abs >= 1_000_000) {
        return parseFloat((num / 1_000_000).toFixed(p)) + 'M';
      }
      if (abs >= 1_000) {
        return parseFloat((num / 1_000).toFixed(p)) + 'K';
      }
    }
    // Use the user's selected locale so the thousands separator etc. match
    // the UI language instead of the system default (addresses upstream PR #8).
    return num.toLocaleString(this.currentLanguage);
  }
}
