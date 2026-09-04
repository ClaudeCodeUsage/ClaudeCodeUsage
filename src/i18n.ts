import { SupportedLanguage } from './types';
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
    settingsResetAll: string;
    settingsGroupGeneral: string;
    settingsGroupProviders: string;
    settingsGroupFeatures: string;
    settingsGroupStatusBar: string;
    settingsGroupData: string;
    settingsGroupAdvice: string;
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
    workflowsThisMonth: string;
    workflowCostShare: string;
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
  | 'insightEvidenceLabels';

type CodexCopyOverrides = Partial<Omit<CodexViewCopy, CodexCopyMapKey>> & {
  insightTitles?: Partial<CodexViewCopy['insightTitles']>;
  insightObservations?: Partial<CodexViewCopy['insightObservations']>;
  insightTips?: Partial<CodexViewCopy['insightTips']>;
  insightEvidenceLabels?: Partial<CodexViewCopy['insightEvidenceLabels']>;
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
    title: 'Weekly allowance value',
    description: 'Current official API prices applied to local tokens; full allowance is inferred from the last observed utilization in each reset window. Request-level surcharges absent from aggregate logs are excluded. Estimate, not a bill.',
    period: 'Period', currentPeriod: 'Current period', currentPeriodShort: 'Current', resetsAt: 'resets',
    usedValue: 'Used equivalent', fullValue: 'Full allowance est.', unusedValue: 'Unused est.',
    reset: 'Week / reset', utilization: 'End observed', confidence: 'Confidence', pricingCoverage: 'Priced coverage',
    current: 'In progress', high: 'High', medium: 'Medium', low: 'Low', usageOnly: 'Usage only',
    noData: 'No locally recorded weekly usage is available yet.',
    historyFromLogs: 'Historical used equivalents come directly from local token logs. Full and unused estimates appear only for windows with a real quota-utilization observation.',
    calendarFallback: 'No historical weekly reset was observed; usage-only history is grouped into Monday-to-Monday UTC calendar weeks.',
    multiAccount: 'Codex usage-only history combines all sign-ins in this Codex home. When usage cannot be reliably attributed to a single quota observation, only the used equivalent is shown; no account split or allowance estimate is invented.',
    boundaryApproximation: 'Codex usage is aggregated by day. If an official reset falls within a recorded day, the affected period keeps only its used equivalent; full and unused values are not inferred.',
    boundaryApproximate: 'Boundary approx.',
    indexedSubtotal: 'Indexing is incomplete; weekly values are conservative subtotals.',
  },
  'zh-CN': {
    title: '每周等效额度价值',
    description: '按当前官方 API 单价折算本地 Token；每个重置窗口的总额度由最后观测用量比例反推。聚合日志无法确认的请求级附加价格不计入。属于估算，并非账单。',
    period: '周期', currentPeriod: '当前周期', currentPeriodShort: '当前', resetsAt: '重置于',
    usedValue: '已用等价值', fullValue: '总额度估算', unusedValue: '未用估算',
    reset: '周期 / 重置', utilization: '末次观测', confidence: '可信度', pricingCoverage: '已定价覆盖',
    current: '进行中', high: '高', medium: '中', low: '低', usageOnly: '仅已用值',
    noData: '尚无可用于按周计算的本地用量记录。',
    historyFromLogs: '历史“已用等价值”直接由本地 Token 日志计算；只有某个窗口存在真实额度用量观测时，才显示总额度和未用额度估算。',
    calendarFallback: '未观测到可用于对齐历史的每周重置时间；仅已用历史按 UTC 周一至周一的自然周分组。',
    multiAccount: 'Codex 的仅已用历史会合并此 Codex home 中的全部登录。用量无法可靠归属到单一额度观测时，只显示已用等价值；不会虚构账号拆分或额度估算。',
    boundaryApproximation: 'Codex 用量按日汇总。如果官方重置发生在某个已记录日期内，受影响周期只保留已用等价值，不反推总额度或未用额度。',
    boundaryApproximate: '边界近似',
    indexedSubtotal: '索引尚未完成；每周价值目前是保守小计。',
  },
  'zh-TW': {
    title: '每週等效額度價值',
    description: '依目前官方 API 單價折算本機 Token；每個重設視窗的總額度由最後觀測用量比例反推。彙總日誌無法確認的請求級附加價格不計入。屬於估算，並非帳單。',
    period: '週期', currentPeriod: '目前週期', currentPeriodShort: '目前', resetsAt: '重設於',
    usedValue: '已用等價值', fullValue: '總額度估算', unusedValue: '未用估算',
    reset: '週期 / 重設', utilization: '末次觀測', confidence: '可信度', pricingCoverage: '已定價涵蓋',
    current: '進行中', high: '高', medium: '中', low: '低', usageOnly: '僅已用值',
    noData: '尚無可用於每週計算的本機用量記錄。',
    historyFromLogs: '歷史「已用等價值」直接由本機 Token 日誌計算；只有視窗存在真實額度用量觀測時，才顯示總額度與未用額度估算。',
    calendarFallback: '未觀測到可用於對齊歷史的每週重設時間；僅已用歷史依 UTC 週一至週一的自然週分組。',
    multiAccount: 'Codex 的僅已用歷史會合併此 Codex home 中的所有登入。用量無法可靠歸屬到單一額度觀測時，只顯示已用等價值；不會虛構帳號拆分或額度估算。',
    boundaryApproximation: 'Codex 用量按日彙總。如果官方重設發生在某個已記錄日期內，受影響週期只保留已用等價值，不反推總額度或未用額度。',
    boundaryApproximate: '邊界近似',
    indexedSubtotal: '索引尚未完成；每週價值目前是保守小計。',
  },
  ja: {
    title: '週間上限の等価価値',
    description: '現在の公式 API 単価をローカルトークンに適用し、各リセット枠の総上限を最終観測利用率から推定します。集計ログで確認できないリクエスト単位の追加料金は含みません。請求額ではありません。',
    period: '期間', currentPeriod: '現在の期間', currentPeriodShort: '現在', resetsAt: 'リセット',
    usedValue: '使用済み等価値', fullValue: '総上限の推定', unusedValue: '未使用の推定',
    reset: '期間 / リセット', utilization: '最終観測', confidence: '信頼度', pricingCoverage: '価格適用率',
    current: '進行中', high: '高', medium: '中', low: '低', usageOnly: '使用分のみ',
    noData: '週単位で計算できるローカル使用記録がまだありません。',
    historyFromLogs: '過去の使用済み等価値はローカルの Token ログから直接計算します。総上限と未使用分は、実際の上限利用率が観測された枠だけで推定します。',
    calendarFallback: '履歴を揃える週間リセットが観測されていないため、使用分のみの履歴は UTC の月曜から月曜の暦週で集計します。',
    multiAccount: 'Codex の使用分のみの履歴は、この Codex home の全ログインを合算します。使用量を単一の上限観測に確実に帰属できない場合は使用済み等価値だけを表示し、アカウント分割や上限推定を作りません。',
    boundaryApproximation: 'Codex の使用量は日単位で集計されます。公式リセットが記録日の途中にある場合、影響する期間は使用済み等価値だけを保持し、総上限や未使用分を推定しません。',
    boundaryApproximate: '境界近似',
    indexedSubtotal: '索引作成中のため、週間価値は保守的な小計です。',
  },
  ko: {
    title: '주간 한도 등가 가치',
    description: '현재 공식 API 단가를 로컬 토큰에 적용하고 각 재설정 창의 총한도를 마지막 관측 사용률로 추정합니다. 집계 로그에서 확인할 수 없는 요청 단위 추가 요금은 제외합니다. 청구 금액이 아닙니다.',
    period: '기간', currentPeriod: '현재 기간', currentPeriodShort: '현재', resetsAt: '재설정',
    usedValue: '사용 등가치', fullValue: '총한도 추정', unusedValue: '미사용 추정',
    reset: '주 / 재설정', utilization: '마지막 관측', confidence: '신뢰도', pricingCoverage: '가격 적용률',
    current: '진행 중', high: '높음', medium: '보통', low: '낮음', usageOnly: '사용분만',
    noData: '주간 계산에 사용할 로컬 사용 기록이 아직 없습니다.',
    historyFromLogs: '과거 사용 등가치는 로컬 Token 로그에서 직접 계산합니다. 실제 한도 사용률 관측이 있는 창에서만 총한도와 미사용분을 추정합니다.',
    calendarFallback: '과거를 정렬할 주간 재설정이 관측되지 않아 사용분 전용 기록은 UTC 월요일부터 월요일까지의 달력 주로 묶습니다.',
    multiAccount: 'Codex 사용분 전용 기록은 이 Codex home의 모든 로그인을 합산합니다. 사용량을 단일 할당량 관측에 안정적으로 귀속할 수 없으면 사용 등가치만 표시하며 계정 분리나 한도 추정을 만들어 내지 않습니다.',
    boundaryApproximation: 'Codex 사용량은 일별로 집계됩니다. 공식 재설정이 기록된 하루 중간에 발생하면 영향을 받는 기간에는 사용 등가치만 유지하고 총한도나 미사용분을 추정하지 않습니다.',
    boundaryApproximate: '경계 근사',
    indexedSubtotal: '인덱싱이 끝나지 않아 주간 가치는 보수적인 소계입니다.',
  },
  'pt-BR': {
    title: 'Valor equivalente semanal',
    description: 'Aplica os preços oficiais atuais da API aos tokens locais e infere o limite total pela última utilização observada em cada janela. Sobretaxas por solicitação ausentes dos logs agregados não são incluídas. É uma estimativa, não uma fatura.',
    period: 'Período', currentPeriod: 'Período atual', currentPeriodShort: 'Atual', resetsAt: 'reinicia em',
    usedValue: 'Equivalente usado', fullValue: 'Limite total est.', unusedValue: 'Não usado est.',
    reset: 'Semana / reset', utilization: 'Última observação', confidence: 'Confiança', pricingCoverage: 'Cobertura de preços',
    current: 'Em andamento', high: 'Alta', medium: 'Média', low: 'Baixa', usageOnly: 'Somente uso',
    noData: 'Ainda não há uso local registrado para o cálculo semanal.',
    historyFromLogs: 'Os equivalentes usados no histórico vêm diretamente dos logs locais de Token. O limite total e o não usado só são estimados quando há uma observação real da utilização da cota.',
    calendarFallback: 'Nenhuma redefinição semanal histórica foi observada; o histórico somente de uso é agrupado em semanas UTC de segunda a segunda.',
    multiAccount: 'O histórico somente de uso do Codex combina todos os logins deste Codex home. Quando o uso não pode ser atribuído com segurança a uma única observação de cota, só o equivalente usado é mostrado; nenhuma divisão por conta ou estimativa de limite é inventada.',
    boundaryApproximation: 'O uso do Codex é agregado por dia. Se uma redefinição oficial ocorrer dentro de um dia registrado, o período afetado mantém apenas o equivalente usado; o limite total e o não usado não são inferidos.',
    boundaryApproximate: 'Fronteira aprox.',
    indexedSubtotal: 'A indexação está incompleta; os valores semanais são subtotais conservadores.',
  },
  'de-DE': {
    title: 'Wöchentlicher Gegenwert',
    description: 'Aktuelle offizielle API-Preise werden auf lokale Token angewandt; das Gesamtlimit wird aus der letzten beobachteten Auslastung je Reset-Fenster geschätzt. Anfragebezogene Aufpreise, die in aggregierten Logs fehlen, sind ausgeschlossen. Keine Rechnung.',
    period: 'Zeitraum', currentPeriod: 'Aktueller Zeitraum', currentPeriodShort: 'Aktuell', resetsAt: 'Reset',
    usedValue: 'Genutzter Gegenwert', fullValue: 'Gesamtlimit geschätzt', unusedValue: 'Ungenutzt geschätzt',
    reset: 'Woche / Reset', utilization: 'Letzte Beobachtung', confidence: 'Vertrauen', pricingCoverage: 'Preisabdeckung',
    current: 'Laufend', high: 'Hoch', medium: 'Mittel', low: 'Niedrig', usageOnly: 'Nur Nutzung',
    noData: 'Noch keine lokal erfasste Nutzung für die Wochenberechnung verfügbar.',
    historyFromLogs: 'Historische genutzte Gegenwerte stammen direkt aus lokalen Token-Logs. Gesamtlimit und ungenutzter Anteil werden nur bei real beobachteter Quotenauslastung geschätzt.',
    calendarFallback: 'Kein historischer Wochen-Reset wurde beobachtet; reine Nutzungsverläufe werden in UTC-Kalenderwochen von Montag bis Montag gruppiert.',
    multiAccount: 'Der reine Codex-Nutzungsverlauf kombiniert alle Anmeldungen in diesem Codex home. Lässt sich die Nutzung nicht zuverlässig einer einzelnen Kontingentbeobachtung zuordnen, wird nur der genutzte Gegenwert angezeigt; weder Kontotrennung noch Limitschätzung werden erfunden.',
    boundaryApproximation: 'Die Codex-Nutzung wird tageweise aggregiert. Fällt ein offizieller Reset in einen erfassten Tag, behält der betroffene Zeitraum nur den genutzten Gegenwert; Gesamtlimit und ungenutzter Anteil werden nicht geschätzt.',
    boundaryApproximate: 'Grenznäherung',
    indexedSubtotal: 'Die Indizierung ist unvollständig; Wochenwerte sind konservative Zwischensummen.',
  },
  id: {
    title: 'Nilai ekuivalen mingguan',
    description: 'Harga API resmi saat ini diterapkan pada token lokal; total batas disimpulkan dari pemakaian terakhir yang diamati pada tiap jendela reset. Biaya tambahan per permintaan yang tidak ada dalam log agregat tidak dihitung. Ini perkiraan, bukan tagihan.',
    period: 'Periode', currentPeriod: 'Periode saat ini', currentPeriodShort: 'Saat ini', resetsAt: 'reset',
    usedValue: 'Ekuivalen terpakai', fullValue: 'Total batas estimasi', unusedValue: 'Tak terpakai estimasi',
    reset: 'Minggu / reset', utilization: 'Pengamatan akhir', confidence: 'Keyakinan', pricingCoverage: 'Cakupan harga',
    current: 'Berjalan', high: 'Tinggi', medium: 'Sedang', low: 'Rendah', usageOnly: 'Hanya pemakaian',
    noData: 'Belum ada penggunaan lokal yang tercatat untuk perhitungan mingguan.',
    historyFromLogs: 'Ekuivalen terpakai historis dihitung langsung dari log Token lokal. Total batas dan sisa hanya diestimasi jika ada pengamatan nyata atas persentase kuota.',
    calendarFallback: 'Tidak ada reset mingguan historis yang teramati; riwayat khusus pemakaian dikelompokkan dalam minggu UTC Senin-ke-Senin.',
    multiAccount: 'Riwayat khusus pemakaian Codex menggabungkan semua login di Codex home ini. Jika penggunaan tidak dapat dikaitkan secara andal ke satu pengamatan kuota, hanya ekuivalen terpakai yang ditampilkan; pemisahan akun atau perkiraan batas tidak direka.',
    boundaryApproximation: 'Penggunaan Codex diagregasi per hari. Jika reset resmi terjadi di tengah hari yang tercatat, periode yang terdampak hanya mempertahankan ekuivalen terpakai; total batas dan sisa tidak diperkirakan.',
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
        'Settings live here now. Only language, data directory and API key remain in VS Code Settings (so they sync). Changes apply immediately.',
      settingsResetAll: 'Reset all to defaults',
      settingsGroupGeneral: 'General',
      settingsGroupProviders: 'Providers',
      settingsGroupFeatures: 'Optional features',
      settingsGroupStatusBar: 'Status bar',
      settingsGroupData: 'Data & refresh',
      settingsGroupAdvice: 'AI advice & Optimizer',
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
      workflowsThisMonth: 'Workflows this month',
      workflowCostShare: "share of this month's cost",
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
        'Send your usage digest + a sample of your own prompts to your model and get concrete tips on writing clearer instructions and cutting waste.',
      optimizerTitle: 'Usage optimizer',
      optimizerDesc:
        'Turn a rough, half-formed request into a clean prompt you can paste straight into Claude Code — plus a suggested effort / thinking / model for the task.',
      optimizerHowto:
        'Type or paste your draft below, tick any of the optional tweaks, then click Optimise. Only the text you paste is sent to your model — never to Claude Code or your terminal.',
      optimizerConsent:
        'The Usage Optimizer sends the text you paste to your configured API model. Nothing is sent to Claude Code and nothing is typed into a terminal. Continue?',
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
        '1. Open Settings (`Ctrl+,` / `Cmd+,`)\n' +
        '2. Search for **`claudeCodeUsage.advice.apiKey`**\n' +
        '3. Paste an OpenAI-compatible API key — DeepSeek works out of the box\n' +
        '   ([deepseek.com](https://platform.deepseek.com))\n' +
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
        "Die Einstellungen sind jetzt hier. Nur Sprache, Datenverzeichnis und API-Schlüssel bleiben in den VS-Code-Einstellungen (damit sie synchronisiert werden). Änderungen wirken sofort.",
      settingsResetAll: "Alle zurücksetzen",
      settingsGroupGeneral: "Allgemein",
      settingsGroupProviders: "Anbieter",
      settingsGroupFeatures: "Optionale Funktionen",
      settingsGroupStatusBar: "Statusleiste",
      settingsGroupData: "Daten & Aktualisierung",
      settingsGroupAdvice: "KI-Beratung & Optimizer",
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
      workflowsThisMonth: "Workflows diesen Monat",
      workflowCostShare: "Anteil an den Monatskosten",
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
        "Sende deine Nutzungsübersicht + eine Auswahl deiner eigenen Prompts an dein Modell und erhalte konkrete Tipps für klarere Anweisungen und weniger Verschwendung.",
      optimizerTitle: "Nutzungs-Optimierer",
      optimizerDesc:
        "Mach aus einer groben, halbfertigen Anfrage einen sauberen Prompt, den du direkt in Claude Code einfügen kannst — plus empfohlenes Effort / Thinking / Modell für die Aufgabe.",
      optimizerHowto:
        "Tippe oder füge deinen Entwurf unten ein, aktiviere optionale Feineinstellungen und klicke Optimieren. Nur der eingefügte Text wird an dein Modell gesendet — nie an Claude Code oder dein Terminal.",
      optimizerConsent:
        "Der Nutzungs-Optimierer sendet den eingefügten Text an dein konfiguriertes API-Modell. Nichts geht an Claude Code, nichts wird ins Terminal getippt. Fortfahren?",
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
        '1. Einstellungen öffnen (`Ctrl+,` / `Cmd+,`)\n' +
        '2. Nach **`claudeCodeUsage.advice.apiKey`** suchen\n' +
        '3. Einen OpenAI-kompatiblen API-Key einfügen — DeepSeek funktioniert\n' +
        '   sofort ([deepseek.com](https://platform.deepseek.com))\n' +
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
        '設定現在都在這裡。只有語言、資料目錄與 API 金鑰仍留在 VS Code 設定中(以便同步)。變更會立即生效。',
      settingsResetAll: '全部還原為預設',
      settingsGroupGeneral: '一般',
      settingsGroupProviders: '供應商',
      settingsGroupFeatures: '選用功能',
      settingsGroupStatusBar: '狀態列',
      settingsGroupData: '資料與重新整理',
      settingsGroupAdvice: 'AI 建議與最佳化工具',
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
      workflowsThisMonth: '本月工作流',
      workflowCostShare: '佔本月成本',
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
        '將你的用量摘要 + 你自己的 prompt 樣本送給模型，取得寫出更清楚指令、減少浪費的具體建議。',
      optimizerTitle: '用量優化器',
      optimizerDesc:
        '把粗略、半成形的需求，變成可直接貼進 Claude Code 的乾淨 prompt，並附上這個任務建議的 effort / thinking / 模型。',
      optimizerHowto:
        '在下方輸入或貼上你的草稿，按需勾選可選的微調項，再按「優化」。只有你貼上的文字會送給模型——不會送給 Claude Code 或終端。',
      optimizerConsent:
        '用量優化器會把你貼上的文字送給你配置的 API 模型。不會送給 Claude Code，也不會注入終端。要繼續嗎？',
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
        '1. 開啟設定(`Ctrl+,` / `Cmd+,`)\n' +
        '2. 搜尋 **`claudeCodeUsage.advice.apiKey`**\n' +
        '3. 貼入 OpenAI-相容 API key —— DeepSeek 開箱即用\n' +
        '   ([deepseek.com](https://platform.deepseek.com))\n' +
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
        '设置现在都在这里。只有语言、数据目录和 API key 仍留在 VS Code 设置中(便于同步)。更改即时生效。',
      settingsResetAll: '全部恢复默认',
      settingsGroupGeneral: '常规',
      settingsGroupProviders: '供应商',
      settingsGroupFeatures: '可选功能',
      settingsGroupStatusBar: '状态栏',
      settingsGroupData: '数据与刷新',
      settingsGroupAdvice: 'AI 建议与优化器',
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
      workflowsThisMonth: '本月工作流',
      workflowCostShare: '占本月成本',
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
        '将你的用量摘要 + 你自己的 prompt 样本送给模型，获得写出更清晰指令、减少浪费的具体建议。',
      optimizerTitle: '用量优化器',
      optimizerDesc:
        '把粗略、没成形的需求，变成可以直接粘进 Claude Code 的干净 prompt，并附上这个任务建议的 effort / thinking / 模型。',
      optimizerHowto:
        '在下方输入或粘贴你的草稿，按需勾选下面的可选微调项，再点「优化」。只有你粘贴的文字会发给模型——不会发给 Claude Code，也不会注入终端。',
      optimizerConsent:
        '用量优化器会把你粘贴的文字发送给你配置的 API 模型。不会发送给 Claude Code，也不会注入终端。要继续吗？',
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
        '1. 打开设置(`Ctrl+,` / `Cmd+,`)\n' +
        '2. 搜索 **`claudeCodeUsage.advice.apiKey`**\n' +
        '3. 填入 OpenAI-兼容 API key —— DeepSeek 开箱即用\n' +
        '   ([deepseek.com](https://platform.deepseek.com))\n' +
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
        '設定はここにまとまりました。言語・データディレクトリ・API キーのみ VS Code 設定に残ります(同期のため)。変更は即時反映されます。',
      settingsResetAll: 'すべて既定値に戻す',
      settingsGroupGeneral: '一般',
      settingsGroupProviders: 'プロバイダー',
      settingsGroupFeatures: 'オプション機能',
      settingsGroupStatusBar: 'ステータスバー',
      settingsGroupData: 'データと更新',
      settingsGroupAdvice: 'AI アドバイス & オプティマイザー',
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
      workflowsThisMonth: '今月のワークフロー',
      workflowCostShare: '今月のコストに占める割合',
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
        '使用量サマリー + あなた自身のプロンプトのサンプルをモデルに送り、より明確な指示と無駄削減の具体的なヒントを得ます。',
      optimizerTitle: '使用量オプティマイザー',
      optimizerDesc:
        '雑で半端な依頼を、Claude Code にそのまま貼り付けられる整ったプロンプトに変換し、そのタスクに推奨の effort / thinking / モデルも返します。',
      optimizerHowto:
        '下に下書きを入力または貼り付け、必要に応じて任意の調整オプションを選び「最適化」を押します。送信されるのは貼り付けたテキストのみ——Claude Code やターミナルには送られません。',
      optimizerConsent:
        '使用量オプティマイザーは貼り付けたテキストを設定した API モデルに送信します。Claude Code には送られず、ターミナルにも入力されません。続行しますか？',
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
        '1. 設定を開く(`Ctrl+,` / `Cmd+,`)\n' +
        '2. **`claudeCodeUsage.advice.apiKey`** を検索\n' +
        '3. OpenAI 互換 API キーを貼り付け —— DeepSeek はすぐに使えます\n' +
        '   ([deepseek.com](https://platform.deepseek.com))\n' +
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
        '설정이 이제 여기로 모였습니다. 언어, 데이터 디렉터리, API 키만 VS Code 설정에 남습니다(동기화를 위해). 변경은 즉시 적용됩니다.',
      settingsResetAll: '모두 기본값으로',
      settingsGroupGeneral: '일반',
      settingsGroupProviders: '공급자',
      settingsGroupFeatures: '선택 기능',
      settingsGroupStatusBar: '상태 표시줄',
      settingsGroupData: '데이터 및 새로고침',
      settingsGroupAdvice: 'AI 조언 & 옵티마이저',
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
      workflowsThisMonth: '이번 달 워크플로',
      workflowCostShare: '이번 달 비용 중 비율',
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
        '사용량 요약 + 본인 프롬프트 샘플을 모델에 보내 더 명확한 지시와 낭비 줄이기에 대한 구체적 팁을 받습니다.',
      optimizerTitle: '사용량 옵티마이저',
      optimizerDesc:
        '대략적이고 정리되지 않은 요청을 Claude Code에 바로 붙여넣을 수 있는 깔끔한 프롬프트로 바꾸고, 그 작업에 추천하는 effort / thinking / 모델도 함께 제공합니다.',
      optimizerHowto:
        '아래에 초안을 입력하거나 붙여넣고, 필요하면 선택 옵션을 고른 뒤 「최적화」를 누르세요. 붙여넣은 텍스트만 모델로 전송됩니다 — Claude Code나 터미널로는 가지 않습니다.',
      optimizerConsent:
        '사용량 옵티마이저는 붙여넣은 텍스트를 설정한 API 모델로 보냅니다. Claude Code로는 전송되지 않고 터미널에도 입력되지 않습니다. 계속할까요?',
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
        '1. 설정 열기 (`Ctrl+,` / `Cmd+,`)\n' +
        '2. **`claudeCodeUsage.advice.apiKey`** 검색\n' +
        '3. OpenAI 호환 API 키 붙여넣기 — DeepSeek 즉시 사용 가능\n' +
        '   ([deepseek.com](https://platform.deepseek.com))\n' +
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
        'As configurações agora ficam aqui. Apenas idioma, diretório de dados e chave de API permanecem nas Configurações do VS Code (para sincronizar). As alterações são aplicadas imediatamente.',
      settingsResetAll: 'Restaurar tudo para os padrões',
      settingsGroupGeneral: 'Geral',
      settingsGroupProviders: 'Provedores',
      settingsGroupFeatures: 'Recursos opcionais',
      settingsGroupStatusBar: 'Barra de status',
      settingsGroupData: 'Dados e atualização',
      settingsGroupAdvice: 'Conselho de IA e Optimizer',
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
      workflowsThisMonth: 'Workflows neste mês',
      workflowCostShare: 'do custo deste mês',
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
        'Envie o resumo do seu uso + uma amostra dos seus próprios prompts ao seu modelo e receba dicas concretas para escrever instruções mais claras e reduzir desperdício.',
      optimizerTitle: 'Otimizador de uso',
      optimizerDesc:
        'Transforme um pedido rascunhado e malformado em um prompt limpo para colar direto no Claude Code — além de um esforço / raciocínio / modelo sugeridos para a tarefa.',
      optimizerHowto:
        'Digite ou cole seu rascunho abaixo, marque quaisquer ajustes opcionais e clique em Otimizar. Apenas o texto que você cola é enviado ao seu modelo — nunca ao Claude Code nem ao seu terminal.',
      optimizerConsent:
        'O Otimizador de Uso envia o texto que você cola ao modelo de API configurado. Nada é enviado ao Claude Code e nada é digitado em um terminal. Continuar?',
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
        '1. Abra as Configurações (`Ctrl+,` / `Cmd+,`)\n' +
        '2. Pesquise por **`claudeCodeUsage.advice.apiKey`**\n' +
        '3. Cole uma chave de API compatível com OpenAI — DeepSeek funciona direto\n' +
        '   ([deepseek.com](https://platform.deepseek.com))\n' +
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
        'Pengaturan sekarang ada di sini. Hanya bahasa, direktori data, dan API key yang tetap berada di Pengaturan VS Code (agar dapat disinkronkan). Perubahan langsung diterapkan.',
      settingsResetAll: 'Kembalikan semua ke default',
      settingsGroupGeneral: 'Umum',
      settingsGroupProviders: 'Penyedia',
      settingsGroupFeatures: 'Fitur opsional',
      settingsGroupStatusBar: 'Status bar',
      settingsGroupData: 'Data & penyegaran',
      settingsGroupAdvice: 'Saran AI & Optimizer',
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
      workflowsThisMonth: 'Workflow bulan ini',
      workflowCostShare: 'proporsi dari biaya bulan ini',
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
        'Kirim ringkasan penggunaan Anda + sampel prompt Anda sendiri ke model Anda dan dapatkan tips konkret untuk menulis instruksi yang lebih jelas dan mengurangi pemborosan.',
      optimizerTitle: 'Pengoptimal Penggunaan',
      optimizerDesc:
        'Ubah permintaan yang masih kasar dan belum rapi menjadi prompt bersih yang bisa langsung ditempel ke Claude Code — plus saran effort / thinking / model untuk tugas tersebut.',
      optimizerHowto:
        'Ketik atau tempel draf Anda di bawah, centang penyesuaian opsional yang diinginkan, lalu klik Optimalkan. Hanya teks yang Anda tempel yang dikirim ke model Anda — tidak pernah ke Claude Code atau terminal Anda.',
      optimizerConsent:
        'Usage Optimizer mengirim teks yang Anda tempel ke model API yang telah dikonfigurasi. Tidak ada yang dikirim ke Claude Code dan tidak ada yang diketik ke terminal. Lanjutkan?',
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
        '1. Buka Pengaturan (`Ctrl+,` / `Cmd+,`)\n' +
        '2. Cari **`claudeCodeUsage.advice.apiKey`**\n' +
        '3. Tempel API key yang kompatibel dengan OpenAI — DeepSeek langsung berfungsi\n' +
        '   ([deepseek.com](https://platform.deepseek.com))\n' +
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
    'tokenDecimalPlaces': { label: 'Token-Dezimalstellen', help: 'Dezimalstellen für kompakte Token-Anzeige (1.2M / 345.6K). Volle Ganzzahlen bleiben unberührt.' },
    'compactNumbers': { label: 'Kompakte Token-Zahlen', help: 'Zeige 1.2M / 345K statt voller Zahlen.' },
    'releaseAnnouncements': { label: 'Release-Hinweise', help: 'Nach einem Erweiterungs-Upgrade einmal die Neuerungen anzeigen.' },
    'pricingBackend': { label: 'Claude-Preisquelle', help: 'Wähle AWS-Bedrock-In-Region-Preise, wenn Claude Code über Bedrock geroutet wird.' },
    'codex.enabled': { label: 'Codex Beta aktivieren', help: 'Datenschutzfreundliche Nutzungsaggregate aus lokalen Codex-Sitzungslogs lesen.' },
    'codex.dataDirectory': { label: 'Benutzerdefiniertes Codex-Datenverzeichnis', help: 'Leer = CODEX_HOME, dann ~/.codex. Authentifizierungsdateien werden nie gelesen.' },
    'codex.fileWatchSeconds': { label: 'Codex-Live-Aktualisierungsverzögerung', help: 'Ruhe-Debounce nach lokalen Codex-JSONL-Änderungen. Aus deaktiviert die Überwachung.' },
    'codex.optimization.enabled': { label: 'Codex-Verhaltensoptimierung anzeigen', help: 'Lokale, deterministische Codex-Verhaltensmetriken und Empfehlungen anzeigen.' },
    'statusBarProvider': { label: 'Statusleisten-Anbieter', help: 'Auto bevorzugt Claude, wenn beide Anbieter Daten haben.' },
    'codex.statusMetric': { label: 'Codex-Statusmetrik', help: 'Nutzung ohne Cache, verarbeitete Token oder Ausgabe-Token.' },
    'timezone': { label: 'Zeitzone für Daten', help: 'Gängige Zone oder UTC-Offset (jeder Offset abgedeckt) oder Systemstandard. Labels zeigen den aktuellen UTC-Offset.' },
    'showWeeklyEquivalentValue': { label: 'Wöchentlichen API-Gegenwert anzeigen', help: 'Standardmäßig an. Zeigt den historischen wöchentlichen API-Gegenwert in „Seit Aufzeichnungsbeginn“ und „Vergleich“. Dies ist eine Schätzung, keine Rechnung und kein Abonnementkontingent.' },
    'showHeatmap': { label: 'Token-Heatmap zeigen (Tab „Seit Aufzeichnungsbeginn“)', help: 'Standardmäßig aus. GitHub-artige Jahres-Heatmap; als SVG exportieren oder auf dein GitHub-Profil veröffentlichen.' },
    'showEfficiency': { label: 'Effizienz-Einblicke zeigen', help: 'Standardmäßig aus. Kosten/Nachricht, Token/Nachricht, Cache-Ersparnis und die Cache-Warmzeit-Schätzung.' },
    'showCostliestMessages': { label: '„Top 10 teuerste Nachrichten“ zeigen', help: 'Standardmäßig aus. Reiht deine teuersten Einzel-Turns; das Aufklappen zeigt den Prompt (dein eigener Text).' },
    'enableShareCard': { label: 'Nutzungs-Sharecard aktivieren', help: 'Standardmäßig aus. Eine konfigurierbare einseitige SVG-Zusammenfassung zum Erzeugen und Teilen.' },
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
    'workflowQuotaWarnPercent': { label: 'Warnung bei Workflow-Kontingent %', help: 'Warnt vor einem Lauf, wenn das verbleibende 5h-Kontingent darunter liegt. 0 = aus.' },
    'dataDirectory': { label: 'Benutzerdefiniertes Datenverzeichnis', help: 'Claude-Datenverzeichnis; leer = automatisch erkennen.' },
    'refreshInterval': { label: 'Aktualisierungsintervall (s)', help: '' },
    'fileWatchSeconds': { label: 'Verzögerung der Live-Aktualisierung', help: 'Wartezeit nach der letzten lokalen JSONL-Änderung vor der Aktualisierung (Ruhe-Debounce; jedes neue Ereignis startet die Wartezeit neu). Es erfolgt kein API-Aufruf; Kontingent-Abfragen werden separat gedrosselt. „Aus“ deaktiviert die Überwachung, 60–300 s schont große Verläufe am stärksten.' },
    'showInsights': { label: 'Experimentelle Insights anzeigen', help: 'Standardmäßig aus. Fügt dem Content-Tab einen Abschnitt „Experimentelle Insights“ hinzu (Cache-Churn-Rechnung, Cache-Wärme pro Modell, große Einzelantworten, aktive Stunden, Skill-ROI) — heuristische Schätzungen aus deinen lokalen Logs, als Schätzungen gekennzeichnet.' },
    'showConversationViewer': { label: 'Gesprächs-Viewer aktivieren', help: 'Standardmäßig an. Fügt dem Sitzungen-Tab eine Ansicht-Schaltfläche hinzu, um ein früheres Gespräch schreibgeschützt erneut zu lesen, ohne es in den Modellkontext zu laden. Liest nur lokale Logs.' },
    'dashboardAutoRefresh': { label: 'Dashboard-Auto-Aktualisierung', help: 'Aktualisiert das Dashboard automatisch bei neuer Nutzung. Aus = nur manuelle Aktualisierung (die Statusleiste aktualisiert weiter).' },
    'enableContentAnalysis': { label: 'Inhaltsanalyse (Content-Registerkarte)', help: 'Deaktivieren, um die CPU-intensive Textprüfung zu überspringen.' },
    'analysis.calibrate': { label: 'Inhaltszahlen kalibrieren', help: 'Skalieren Sie Schätzungen auf die exakten abgerechneten Token-Gesamtzahlen.' },
    'advice.apiKey': { label: 'API-Schlüssel', help: 'Für das api-Backend. Bleibt in den VS Code-Einstellungen.' },
    'advice.apiFormat': { label: 'API-Format', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API-URL', help: 'Endpunkt für das api-Backend.' },
    'advice.model': { label: 'API-Modell', help: '' },
    'advice.reasoningEffort': { label: 'Reasoning-Aufwand (openai)', help: '' },
    'advice.promptWindowDays': { label: 'Prompt-Beispielfenster (Tage)', help: '' },
    'advice.userContext': { label: 'Persönlicher/Projektkontext', help: 'Optionale Hintergrundinfo; fügt einen Abschnitt "Personalisiert" hinzu.' },
    'advice.optimizer.enabled': { label: 'Usage Optimizer aktivieren', help: 'Zeigt die Opt-in-Optimizer-Karte auf der Registerkarte "Content" an.' },
  },
  'zh-TW': {
    'language': { label: '顯示語言', help: 'UI 語言。"auto" 會跟隨 VS Code。' },
    'decimalPlaces': { label: '費用小數位數', help: '' },
    'tokenDecimalPlaces': { label: 'Token 小數位數', help: '緊湊 token 顯示（1.2M / 345.6K）的小數位數。完整整數值不受影響。' },
    'compactNumbers': { label: '簡潔的 Token 計數', help: '顯示 1.2M / 345K 而非完整數字。' },
    'releaseAnnouncements': { label: '版本更新通知', help: '擴充套件升級後顯示一次「新功能」通知。' },
    'pricingBackend': { label: 'Claude 價格來源', help: '若 Claude Code 透過 Bedrock 路由，請選擇 AWS Bedrock 區域內價格。' },
    'codex.enabled': { label: '啟用 Codex Beta', help: '從本機 Codex 工作階段日誌讀取隱私安全的用量彙總。' },
    'codex.dataDirectory': { label: '自訂 Codex 資料目錄', help: '留空時使用 CODEX_HOME，再使用 ~/.codex；不會讀取認證檔案。' },
    'codex.fileWatchSeconds': { label: 'Codex 即時重新整理延遲', help: '本機 Codex JSONL 變更後的靜默防抖；關閉即停用監看。' },
    'codex.optimization.enabled': { label: '顯示 Codex 行為最佳化', help: '顯示本機、確定性的 Codex 行為指標與建議。' },
    'statusBarProvider': { label: '狀態列供應商', help: '兩個供應商都有資料時，自動模式優先顯示 Claude。' },
    'codex.statusMetric': { label: 'Codex 狀態列指標', help: '未快取用量、已處理 Token 或輸出 Token。' },
    'timezone': { label: '日期時區', help: '常用時區或 UTC 偏移（涵蓋所有偏移），或系統預設。標籤顯示目前的 UTC 偏移。' },
    'showWeeklyEquivalentValue': { label: '顯示每週 API 等效價值', help: '預設開啟。在「所有」與「比較」中顯示歷史每週 API 等效價值；屬於估算，不是帳單或訂閱額度。' },
    'showHeatmap': { label: '顯示 Token 熱力圖（「所有」分頁）', help: '預設關閉。全部分頁上的 GitHub 風格年度熱力圖；可匯出 SVG 或發佈到你的 GitHub 首頁。' },
    'showEfficiency': { label: '顯示效率洞察', help: '預設關閉。加入每則成本、每則 token、快取節省與快取保溫估計。' },
    'showCostliestMessages': { label: '顯示「最貴 10 則訊息」', help: '預設關閉。列出最貴的單則對話；展開會顯示 prompt（隱私：你自己的文字）。' },
    'enableShareCard': { label: '啟用用量分享卡', help: '預設關閉。可設定的一頁式 SVG 摘要，可產生並匯出分享。' },
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
    'workflowQuotaWarnPercent': { label: '工作流程配額警告 %', help: '當剩餘 5 小時配額低於此值時，在執行前發出警告。0 = 關閉。' },
    'dataDirectory': { label: '自訂資料目錄', help: 'Claude 資料目錄；空白 = 自動偵測。' },
    'refreshInterval': { label: '重新整理間隔 (秒)', help: '' },
    'fileWatchSeconds': { label: '即時重新整理延遲', help: '在最後一次本機 JSONL 變更後等待多久才重新整理（安靜期去抖；每個新事件都會重新計時）。不會呼叫 API；配額查詢另行節流。「關閉」會停用監控，60–300 秒最適合降低大量歷史資料的 CPU 負載。' },
    'showInsights': { label: '顯示實驗性洞察', help: '預設關閉。在 Content 分頁加入「實驗性洞察」區塊（快取損耗帳單、各模型快取有效時長、大型單輪、活躍時段、技能 ROI）——皆為本機紀錄的啟發式估算，已標註為估計值。' },
    'showConversationViewer': { label: '啟用對話檢視器', help: '預設開啟。在「會話」分頁加入「檢視」按鈕，可唯讀地重讀先前的對話，而不會載入模型上下文。只讀取本機紀錄。' },
    'dashboardAutoRefresh': { label: '儀表板自動重新整理', help: '有新用量時自動重新整理儀表板。關閉 = 僅手動重新整理（狀態列仍會更新）。' },
    'enableContentAnalysis': { label: '內容分析 (Content 分頁)', help: '停用以跳過 CPU 密集的文字掃描。' },
    'analysis.calibrate': { label: '校準內容數據', help: '將估計值縮放至確切的計費 Token 總數。' },
    'advice.apiKey': { label: 'API 金鑰', help: '用於 api 後端。保留在 VS Code 設定中。' },
    'advice.apiFormat': { label: 'API 格式', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API URL', help: 'api 後端的端點。' },
    'advice.model': { label: 'API 模型', help: '' },
    'advice.reasoningEffort': { label: '推論努力度 (openai)', help: '' },
    'advice.promptWindowDays': { label: '提示取樣視窗 (天數)', help: '' },
    'advice.userContext': { label: '個人/專案上下文', help: '可選的背景資訊；新增「Personalised」區段。' },
    'advice.optimizer.enabled': { label: '啟用使用情況優化器', help: '在 Content 分頁上顯示自願加入的 Optimizer 卡片。' },
  },
  'zh-CN': {
    'language': { label: '显示语言', help: 'UI 语言。"auto" 会跟随 VS Code。' },
    'decimalPlaces': { label: '费用小数位数', help: '' },
    'tokenDecimalPlaces': { label: 'Token 小数位数', help: '紧凑 token 显示（1.2M / 345.6K）的小数位数。完整整数值不受影响。' },
    'compactNumbers': { label: '简洁的 token 计数', help: '显示 1.2M / 345K 而非完整数字。' },
    'releaseAnnouncements': { label: '版本更新通知', help: '扩展升级后显示一次“新功能”通知。' },
    'pricingBackend': { label: 'Claude 价格来源', help: '如果 Claude Code 通过 Bedrock 路由，请选择 AWS Bedrock 区域内价格。' },
    'codex.enabled': { label: '启用 Codex Beta', help: '从本地 Codex 会话日志读取隐私安全的用量汇总。' },
    'codex.dataDirectory': { label: '自定义 Codex 数据目录', help: '留空时使用 CODEX_HOME，再使用 ~/.codex；不会读取认证文件。' },
    'codex.fileWatchSeconds': { label: 'Codex 实时刷新延迟', help: '本地 Codex JSONL 变更后的静默防抖；关闭即停用监视。' },
    'codex.optimization.enabled': { label: '显示 Codex 行为优化', help: '显示本地、确定性的 Codex 行为指标与建议。' },
    'statusBarProvider': { label: '状态栏供应商', help: '两个供应商都有数据时，自动模式优先显示 Claude。' },
    'codex.statusMetric': { label: 'Codex 状态栏指标', help: '未缓存用量、已处理 Token 或输出 Token。' },
    'timezone': { label: '日期时区', help: '常用时区或 UTC 偏移（涵盖所有偏移），或系统默认。标签显示当前的 UTC 偏移。' },
    'showWeeklyEquivalentValue': { label: '显示每周 API 等效价值', help: '默认开启。在“全部时间”和“对比”中显示历史每周 API 等效价值；属于估算，不是账单或订阅额度。' },
    'showHeatmap': { label: '显示 Token 热力图（“所有”选项卡）', help: '默认关闭。全部标签上的 GitHub 风格年度热力图；可导出 SVG 或发布到你的 GitHub 主页。' },
    'showEfficiency': { label: '显示效率洞察', help: '默认关闭。加入每条成本、每条 token、缓存节省与缓存保温估计。' },
    'showCostliestMessages': { label: '显示“最贵 10 条消息”', help: '默认关闭。列出最贵的单条对话；展开会显示 prompt（隐私：你自己的文字）。' },
    'enableShareCard': { label: '启用用量分享卡', help: '默认关闭。可配置的一页式 SVG 摘要，可生成并导出分享。' },
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
    'workflowQuotaWarnPercent': { label: '工作流配额警告 %', help: '当剩余 5 小时配额低于此值时，运行前发出警告。0 = 关闭。' },
    'dataDirectory': { label: '自定义数据目录', help: 'Claude 数据目录；空 = 自动检测。' },
    'refreshInterval': { label: '刷新间隔 (秒)', help: '' },
    'fileWatchSeconds': { label: '实时刷新延迟', help: '在最后一次本地 JSONL 变更后等待多久再刷新（静默期防抖；每个新事件都会重新计时）。不会调用 API；配额查询单独节流。“关闭”会停用监控，60–300 秒最适合降低大历史的 CPU 负载。' },
    'showInsights': { label: '显示实验性洞察', help: '默认关闭。在 Content 标签页加入「实验性洞察」区块（缓存损耗账单、各模型缓存有效时长、大单轮、活跃时段、技能 ROI）——皆为本地日志的启发式估算，已标注为估计值。' },
    'showConversationViewer': { label: '启用对话查看器', help: '默认开启。在「会话」标签页加入「查看」按钮，可只读地重读先前的对话，而不会载入模型上下文。只读取本地日志。' },
    'dashboardAutoRefresh': { label: '仪表板自动刷新', help: '有新用量时自动刷新仪表板。关闭 = 仅手动刷新（状态栏仍会更新）。' },
    'enableContentAnalysis': { label: '内容分析 (Content 选项卡)', help: '禁用以跳过 CPU 密集型文本扫描。' },
    'analysis.calibrate': { label: '校准内容数据', help: '将估计值缩放至确切的计费 token 总数。' },
    'advice.apiKey': { label: 'API 密钥', help: '用于 api 后端。保留在 VS Code 设置中。' },
    'advice.apiFormat': { label: 'API 格式', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API URL', help: 'api 后端的端点。' },
    'advice.model': { label: 'API 模型', help: '' },
    'advice.reasoningEffort': { label: '推理努力度 (openai)', help: '' },
    'advice.promptWindowDays': { label: '提示采样窗口 (天数)', help: '' },
    'advice.userContext': { label: '个人/项目上下文', help: '可选的背景信息；添加「Personalised」部分。' },
    'advice.optimizer.enabled': { label: '启用使用优化器', help: '在「Content」选项卡上显示自愿加入的 Optimizer 卡片。' },
  },
  'ja': {
    'language': { label: '表示言語', help: 'UI 言語。"auto" は VS Code に従います。' },
    'decimalPlaces': { label: 'コストの小数点以下桁数', help: '' },
    'tokenDecimalPlaces': { label: 'トークンの小数点以下桁数', help: 'トークンの短縮表示（1.2M / 345.6K）の小数桁数。完全な整数値には影響しません。' },
    'compactNumbers': { label: 'トークン数を短縮表記', help: '完全な数値の代わりに 1.2M / 345K と表示します。' },
    'releaseAnnouncements': { label: 'リリース通知', help: '拡張機能のアップグレード後に新機能を一度通知します。' },
    'pricingBackend': { label: 'Claude の価格ソース', help: 'Claude Code を Bedrock 経由でルーティングする場合は AWS Bedrock のリージョン内価格を選択します。' },
    'codex.enabled': { label: 'Codex Beta を有効化', help: 'ローカルの Codex セッションログからプライバシー安全な使用量集計を読み取ります。' },
    'codex.dataDirectory': { label: 'カスタム Codex データディレクトリ', help: '空欄の場合は CODEX_HOME、次に ~/.codex。認証ファイルは読みません。' },
    'codex.fileWatchSeconds': { label: 'Codex ライブ更新遅延', help: 'ローカル Codex JSONL 変更後の静かなデバウンス。オフで監視を無効化します。' },
    'codex.optimization.enabled': { label: 'Codex の行動最適化を表示', help: 'ローカルで決定論的な Codex の行動指標と提案を表示します。' },
    'statusBarProvider': { label: 'ステータスバーのプロバイダー', help: '両方にデータがある場合、自動は Claude を優先します。' },
    'codex.statusMetric': { label: 'Codex ステータスメトリック', help: '非キャッシュ使用量、処理済みトークン、または出力トークン。' },
    'timezone': { label: '日付のタイムゾーン', help: '一般的なゾーンまたは UTC オフセット（全オフセット対応）、あるいはシステム既定。ラベルは現在の UTC オフセットを表示。' },
    'showWeeklyEquivalentValue': { label: '週間 API 等価価値を表示', help: '既定でオン。「すべて」と「比較」に過去の週間 API 等価価値を表示します。これは推定値であり、請求額やサブスクリプション利用枠ではありません。' },
    'showHeatmap': { label: 'トークンヒートマップを表示（「すべて」タブ）', help: '既定でオフ。GitHub 風の年間ヒートマップ。SVG 書き出しや GitHub プロフィールへの公開が可能。' },
    'showEfficiency': { label: '効率インサイトを表示', help: '既定でオフ。メッセージ単価、メッセージ当たりトークン、キャッシュ節約、キャッシュ保温推定を追加。' },
    'showCostliestMessages': { label: '「最も高価なメッセージ Top 10」を表示', help: '既定でオフ。最も高価な単一ターンを順位付け。展開でプロンプト表示（自分の文章）。' },
    'enableShareCard': { label: '使用状況シェアカードを有効化', help: '既定でオフ。生成して共有できる、設定可能な 1 ページの SVG サマリー。' },
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
    'workflowQuotaWarnPercent': { label: 'ワークフロークォータ警告 %', help: '残りの 5 時間クォータがこれを下回る場合、実行前に警告します。0 = オフ。' },
    'dataDirectory': { label: 'カスタムデータディレクトリ', help: 'Claude データディレクトリ。空 = 自動検出。' },
    'refreshInterval': { label: '更新間隔 (秒)', help: '' },
    'fileWatchSeconds': { label: 'ライブ更新の遅延', help: '最後のローカル JSONL 変更から更新まで待つ時間です（quiet debounce。新しいイベントごとに待ち時間をリセット）。API は呼び出さず、クォータ取得は別に抑制されます。Off で監視を無効化し、大きな履歴では 60～300 秒が最も CPU 負荷を抑えます。' },
    'showInsights': { label: '実験的インサイトを表示', help: '既定はオフ。Content タブに「実験的インサイト」セクションを追加します（キャッシュ損耗、モデル別キャッシュ有効時間、大きな単発ターン、活動時間帯、スキル ROI）。いずれもローカルログからのヒューリスティックな推定で、推定値として表示されます。' },
    'showConversationViewer': { label: '会話ビューアを有効化', help: '既定はオン。セッションタブに「表示」ボタンを追加し、過去の会話をモデルのコンテキストに読み込まずに読み取り専用で読み返せます。ローカルログのみを読み取ります。' },
    'dashboardAutoRefresh': { label: 'ダッシュボードの自動更新', help: '新しい使用があるとダッシュボードを自動更新します。オフ = 手動更新のみ（ステータスバーは更新を続行）。' },
    'enableContentAnalysis': { label: 'コンテンツ分析 (Content タブ)', help: 'CPU負荷の高いテキストスキャンをスキップするには無効にします。' },
    'analysis.calibrate': { label: 'コンテンツ数値を調整', help: '推定値を正確な課金トークン総数に合わせて拡大縮小します。' },
    'advice.apiKey': { label: 'API キー', help: 'api バックエンド用。VS Code 設定に保存されます。' },
    'advice.apiFormat': { label: 'API 形式', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API URL', help: 'api バックエンドのエンドポイント。' },
    'advice.model': { label: 'API モデル', help: '' },
    'advice.reasoningEffort': { label: '推論努力 (openai)', help: '' },
    'advice.promptWindowDays': { label: 'プロンプトサンプルウィンドウ (日数)', help: '' },
    'advice.userContext': { label: '個人/プロジェクトのコンテキスト', help: 'オプションの背景情報。「Personalised」セクションが追加されます。' },
    'advice.optimizer.enabled': { label: 'Usage Optimizer を有効にする', help: '「Content」タブにオプトインの Optimizer カードを表示します。' },
  },
  'ko': {
    'language': { label: '표시 언어', help: 'UI 언어. "auto"는 VS Code를 따릅니다.' },
    'decimalPlaces': { label: '비용 소수점 자리수', help: '' },
    'tokenDecimalPlaces': { label: '토큰 소수점 자리수', help: '간략한 토큰 표시(1.2M / 345.6K)의 소수 자리수. 전체 정수 값에는 영향을 주지 않습니다.' },
    'compactNumbers': { label: '간략한 토큰 수 표시', help: '전체 숫자 대신 1.2M / 345K로 표시합니다.' },
    'releaseAnnouncements': { label: '릴리스 알림', help: '확장 업그레이드 후 새 기능 알림을 한 번 표시합니다.' },
    'pricingBackend': { label: 'Claude 가격 출처', help: 'Claude Code가 Bedrock을 통해 라우팅될 때 AWS Bedrock 리전 내 가격을 선택합니다.' },
    'codex.enabled': { label: 'Codex Beta 사용', help: '로컬 Codex 세션 로그에서 개인정보 보호형 사용량 집계를 읽습니다.' },
    'codex.dataDirectory': { label: '사용자 지정 Codex 데이터 디렉터리', help: '비우면 CODEX_HOME, 그다음 ~/.codex를 사용하며 인증 파일은 읽지 않습니다.' },
    'codex.fileWatchSeconds': { label: 'Codex 실시간 새로고침 지연', help: '로컬 Codex JSONL 변경 후 조용한 디바운스입니다. 끄면 감시를 중지합니다.' },
    'codex.optimization.enabled': { label: 'Codex 행동 최적화 표시', help: '로컬의 결정론적 Codex 행동 지표와 권장 사항을 표시합니다.' },
    'statusBarProvider': { label: '상태 표시줄 공급자', help: '두 공급자 모두 데이터가 있으면 자동은 Claude를 우선합니다.' },
    'codex.statusMetric': { label: 'Codex 상태 지표', help: '캐시되지 않은 사용량, 처리된 토큰 또는 출력 토큰.' },
    'timezone': { label: '날짜 시간대', help: '일반 지역 또는 UTC 오프셋(모든 오프셋 지원), 또는 시스템 기본값. 라벨에 현재 UTC 오프셋 표시.' },
    'showWeeklyEquivalentValue': { label: '주간 API 등가 가치 표시', help: '기본값 켜짐. 전체 및 비교 화면에 과거 주간 API 등가 가치를 표시합니다. 이는 추정치이며 청구서나 구독 할당량이 아닙니다.' },
    'showHeatmap': { label: '토큰 히트맵 표시(전체 탭)', help: '기본 꺼짐. GitHub 스타일 연간 히트맵. SVG 내보내기 또는 GitHub 프로필에 게시 가능.' },
    'showEfficiency': { label: '효율 인사이트 표시', help: '기본 꺼짐. 메시지당 비용/토큰, 캐시 절감, 캐시 보온 추정치를 추가.' },
    'showCostliestMessages': { label: '“가장 비싼 메시지 Top 10” 표시', help: '기본 꺼짐. 가장 비싼 단일 턴을 순위화. 펼치면 프롬프트 표시(본인 텍스트).' },
    'enableShareCard': { label: '사용량 공유 카드 사용', help: '기본 꺼짐. 생성·내보내 공유할 수 있는 구성 가능한 1페이지 SVG 요약.' },
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
    'workflowQuotaWarnPercent': { label: '워크플로우 할당량 경고 %', help: '남은 5시간 할당량이 이보다 낮을 때 실행 전에 경고합니다. 0 = 끄기.' },
    'dataDirectory': { label: '사용자 지정 데이터 디렉터리', help: 'Claude 데이터 디렉터리; 비워두면 자동 감지.' },
    'refreshInterval': { label: '새로 고침 간격 (초)', help: '' },
    'fileWatchSeconds': { label: '실시간 새로고침 지연', help: '마지막 로컬 JSONL 변경 후 새로 고침까지 기다리는 시간입니다(quiet debounce, 새 이벤트마다 대기 시간이 다시 시작됨). API를 호출하지 않으며 할당량 조회는 별도로 제한됩니다. 끄기는 감시를 비활성화하고, 큰 기록에서는 60~300초가 CPU 부담을 가장 줄입니다.' },
    'showInsights': { label: '실험적 인사이트 표시', help: '기본값 꺼짐. Content 탭에 "실험적 인사이트" 섹션을 추가합니다(캐시 소모 청구, 모델별 캐시 유지 시간, 대형 단일 턴, 활동 시간대, 스킬 ROI). 모두 로컬 로그 기반 추정치이며 추정값으로 표시됩니다.' },
    'showConversationViewer': { label: '대화 뷰어 사용', help: '기본값 켜짐. 세션 탭에 "보기" 버튼을 추가하여 이전 대화를 모델 컨텍스트에 불러오지 않고 읽기 전용으로 다시 읽을 수 있습니다. 로컬 로그만 읽습니다.' },
    'dashboardAutoRefresh': { label: '대시보드 자동 새로 고침', help: '새 사용량이 들어오면 대시보드를 자동 새로 고침. 끄면 수동 새로 고침만(상태 표시줄은 계속 업데이트).' },
    'enableContentAnalysis': { label: '콘텐츠 분석 (Content 탭)', help: 'CPU 사용이 많은 텍스트 검사를 건너뛰려면 비활성화하세요.' },
    'analysis.calibrate': { label: '콘텐츠 수치 보정', help: '예상치를 정확한 청구 토큰 총합에 맞게 조정합니다.' },
    'advice.apiKey': { label: 'API 키', help: 'api 백엔드용. VS Code 설정에 보관됩니다.' },
    'advice.apiFormat': { label: 'API 형식', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'API URL', help: 'api 백엔드의 엔드포인트.' },
    'advice.model': { label: 'API 모델', help: '' },
    'advice.reasoningEffort': { label: '추론 노력 (openai)', help: '' },
    'advice.promptWindowDays': { label: '프롬프트 샘플 창 (일)', help: '' },
    'advice.userContext': { label: '개인/프로젝트 컨텍스트', help: '선택적 배경 정보; "Personalised" 섹션을 추가합니다.' },
    'advice.optimizer.enabled': { label: '사용량 최적화 도구 활성화', help: 'Content 탭에 옵트인 Optimizer 카드를 표시합니다.' },
  },
  'pt-BR': {
    'language': { label: 'Idioma de exibição', help: 'Idioma da interface. "auto" segue o VS Code.' },
    'decimalPlaces': { label: 'Casas decimais do custo', help: '' },
    'tokenDecimalPlaces': { label: 'Casas decimais de tokens', help: 'Casas decimais para a exibição compacta de tokens (1.2M / 345.6K). As contagens inteiras completas não são afetadas.' },
    'compactNumbers': { label: 'Contagem de tokens compacta', help: 'Mostra 1.2M / 345K em vez dos números completos.' },
    'releaseAnnouncements': { label: 'Avisos de versão', help: 'Mostra uma vez as novidades após atualizar a extensão.' },
    'pricingBackend': { label: 'Fonte de preços do Claude', help: 'Selecione os preços regionais da AWS Bedrock quando o Claude Code for roteado pela Bedrock.' },
    'codex.enabled': { label: 'Ativar Codex Beta', help: 'Lê agregados de uso com privacidade a partir dos logs locais de sessão do Codex.' },
    'codex.dataDirectory': { label: 'Diretório de dados Codex personalizado', help: 'Vazio = CODEX_HOME, depois ~/.codex. Arquivos de autenticação nunca são lidos.' },
    'codex.fileWatchSeconds': { label: 'Atraso da atualização ao vivo do Codex', help: 'Debounce silencioso após mudanças locais em JSONL do Codex. Desligado desativa a observação.' },
    'codex.optimization.enabled': { label: 'Mostrar otimização de comportamento do Codex', help: 'Mostra métricas e recomendações locais e determinísticas de comportamento do Codex.' },
    'statusBarProvider': { label: 'Provedor da barra de status', help: 'Auto prioriza Claude quando ambos têm dados.' },
    'codex.statusMetric': { label: 'Métrica de status do Codex', help: 'Uso sem cache, tokens processados ou tokens de saída.' },
    'timezone': { label: 'Fuso horário das datas', help: 'Zona comum ou deslocamento UTC (todos cobertos), ou padrão do sistema. Os rótulos mostram o deslocamento UTC atual.' },
    'showWeeklyEquivalentValue': { label: 'Mostrar valor equivalente semanal da API', help: 'Ligado por padrão. Mostra o valor equivalente semanal histórico da API em Todo o período e Comparar. É uma estimativa, não uma fatura nem uma franquia de assinatura.' },
    'showHeatmap': { label: 'Mostrar heatmap de tokens (aba Todo o período)', help: 'Desligado por padrão. Heatmap anual estilo GitHub; exporte SVG ou publique no seu perfil do GitHub.' },
    'showEfficiency': { label: 'Mostrar insights de eficiência', help: 'Desligado por padrão. Custo/mensagem, tokens/mensagem, economia de cache e a estimativa de aquecimento do cache.' },
    'showCostliestMessages': { label: 'Mostrar "10 mensagens mais caras"', help: 'Desligado por padrão. Ranqueia seus turnos mais caros; ao expandir mostra o prompt (seu próprio texto).' },
    'enableShareCard': { label: 'Ativar cartão de compartilhamento de uso', help: 'Desligado por padrão. Um resumo SVG de uma página, configurável, para gerar e compartilhar.' },
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
    'advice.apiKey': { label: 'Chave de API', help: 'Para o backend api. Permanece nas Configurações do VS Code.' },
    'advice.apiFormat': { label: 'Formato da API', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'URL da API', help: 'Endpoint do backend api.' },
    'advice.model': { label: 'Modelo da API', help: '' },
    'advice.reasoningEffort': { label: 'Esforço de raciocínio (openai)', help: '' },
    'advice.promptWindowDays': { label: 'Janela de amostragem de prompts (dias)', help: '' },
    'advice.userContext': { label: 'Contexto pessoal/do projeto', help: 'Informação de fundo opcional; adiciona uma seção "Personalizado".' },
    'advice.optimizer.enabled': { label: 'Ativar o Otimizador de uso', help: 'Mostra o cartão opt-in do Optimizer na aba Content.' },
  },
  'id': {
    'language': { label: 'Bahasa tampilan', help: 'Bahasa UI. "auto" mengikuti VS Code.' },
    'decimalPlaces': { label: 'Angka desimal biaya', help: '' },
    'tokenDecimalPlaces': { label: 'Angka desimal token', help: 'Angka desimal untuk tampilan token ringkas (1.2M / 345.6K). Jumlah bilangan bulat penuh tidak terpengaruh.' },
    'compactNumbers': { label: 'Jumlah token ringkas', help: 'Tampilkan 1.2M / 345K, bukan angka penuh.' },
    'releaseAnnouncements': { label: 'Pengumuman rilis', help: 'Tampilkan sekali hal baru setelah ekstensi ditingkatkan.' },
    'pricingBackend': { label: 'Sumber harga Claude', help: 'Pilih harga AWS Bedrock dalam-region saat Claude Code dirutekan melalui Bedrock.' },
    'codex.enabled': { label: 'Aktifkan Codex Beta', help: 'Baca agregat penggunaan yang aman untuk privasi dari log sesi Codex lokal.' },
    'codex.dataDirectory': { label: 'Direktori data Codex kustom', help: 'Kosong = CODEX_HOME, lalu ~/.codex. Berkas autentikasi tidak pernah dibaca.' },
    'codex.fileWatchSeconds': { label: 'Jeda penyegaran langsung Codex', help: 'Debounce tenang setelah perubahan JSONL Codex lokal. Mati menonaktifkan pemantauan.' },
    'codex.optimization.enabled': { label: 'Tampilkan optimasi perilaku Codex', help: 'Tampilkan metrik dan rekomendasi perilaku Codex yang lokal dan deterministik.' },
    'statusBarProvider': { label: 'Penyedia status bar', help: 'Otomatis memprioritaskan Claude saat keduanya memiliki data.' },
    'codex.statusMetric': { label: 'Metrik status Codex', help: 'Penggunaan tanpa cache, token diproses, atau token output.' },
    'timezone': { label: 'Zona waktu untuk tanggal', help: 'Pilih zona umum atau offset UTC (semua offset tersedia), atau default sistem. Label menampilkan offset UTC saat ini.' },
    'showWeeklyEquivalentValue': { label: 'Tampilkan nilai ekuivalen API mingguan', help: 'Aktif secara default. Tampilkan riwayat nilai ekuivalen API mingguan di Sepanjang Waktu dan Perbandingan. Ini perkiraan, bukan tagihan atau jatah langganan.' },
    'showHeatmap': { label: 'Tampilkan heatmap token (tab Sepanjang Waktu)', help: 'Nonaktif secara default. Heatmap token tahunan bergaya GitHub di tab All; ekspor sebagai SVG atau publikasikan ke profil GitHub Anda.' },
    'showEfficiency': { label: 'Tampilkan wawasan efisiensi', help: 'Nonaktif secara default. Menambahkan biaya/pesan, token/pesan, penghematan cache, dan perkiraan cache warmth.' },
    'showCostliestMessages': { label: 'Tampilkan "10 pesan termahal"', help: 'Nonaktif secara default. Menampilkan giliran termahal; membuka detail menampilkan prompt-nya (teks Anda sendiri).' },
    'enableShareCard': { label: 'Aktifkan share card penggunaan', help: 'Nonaktif secara default. Ringkasan SVG satu halaman yang dapat dikonfigurasi untuk dibuat dan dibagikan.' },
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
    'workflowQuotaWarnPercent': { label: 'Peringatan kuota workflow %', help: 'Beri peringatan sebelum proses berjalan jika sisa kuota 5 jam di bawah ini. 0 = nonaktif.' },
    'dataDirectory': { label: 'Direktori data kustom', help: 'Direktori data Claude; kosong = deteksi otomatis.' },
    'refreshInterval': { label: 'Interval penyegaran (dtk)', help: '' },
    'fileWatchSeconds': { label: 'Jeda penyegaran live', help: 'Seberapa cepat dashboard menyegarkan setelah ada aktivitas baru. Ini hanya membaca ulang file log LOKAL Anda (tanpa panggilan API — pengambilan kuota dibatasi terpisah). "Off" menonaktifkan pemantauan live; jeda lebih lama lebih ringan untuk CPU.' },
    'showInsights': { label: 'Tampilkan wawasan eksperimental', help: 'Nonaktif secara default. Menambahkan bagian "Wawasan eksperimental" di tab Konten — perkiraan kami sendiri dari log lokal Anda (mis. tagihan cache-churn: $ yang dihabiskan menulis ulang cache setelah pergantian model / jeda idle). Ini adalah heuristik hasil perhitungan, bukan metrik standar, jadi tetap opsional dan diberi label sebagai perkiraan.' },
    'showConversationViewer': { label: 'Aktifkan penampil percakapan', help: 'Aktif secara default. Tab Sesi menampilkan tombol "lihat" yang membuka pembaca baca-saja untuk percakapan lampau — sehingga Anda bisa membaca ulang prompt dan jawaban model TANPA memuatnya kembali ke konteks model (berbeda dari resume). Hanya membaca file log lokal Anda (baca-saja), jadi aktif secara default; nonaktifkan untuk menyembunyikan tombolnya.' },
    'dashboardAutoRefresh': { label: 'Penyegaran otomatis dashboard', help: 'Segarkan dashboard secara otomatis saat ada penggunaan baru. Nonaktif = hanya penyegaran manual (status bar tetap diperbarui).' },
    'enableContentAnalysis': { label: 'Analisis konten (tab Konten)', help: 'Nonaktifkan untuk melewati pemindaian teks yang berat bagi CPU.' },
    'analysis.calibrate': { label: 'Kalibrasi angka konten', help: 'Skalakan perkiraan ke total token yang benar-benar ditagih.' },
    'advice.apiKey': { label: 'API key', help: 'Untuk backend api. Tetap berada di Pengaturan VS Code.' },
    'advice.apiFormat': { label: 'Format API', help: 'anthropic = /v1/messages · openai = chat-completions.' },
    'advice.apiUrl': { label: 'URL API', help: 'Endpoint untuk backend api.' },
    'advice.model': { label: 'Model API', help: '' },
    'advice.reasoningEffort': { label: 'Effort reasoning (openai)', help: '' },
    'advice.promptWindowDays': { label: 'Jendela sampel prompt (hari)', help: '' },
    'advice.userContext': { label: 'Konteks pribadi/proyek', help: 'Latar belakang opsional; menambahkan bagian "Personalisasi".' },
    'advice.optimizer.enabled': { label: 'Aktifkan Usage Optimizer', help: 'Tampilkan kartu Optimizer opsional di tab Konten.' },
  },
};

export class I18n {
  private static currentLanguage: SupportedLanguage = 'en';
  private static currentDecimalPlaces: number = 2;
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
    return `$${amount.toFixed(places)}`;
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
