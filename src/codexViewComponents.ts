import {
  CodexInsightEvidenceKey,
  CodexInsightKind,
} from './providers/codex/codexInsights';

/** Copy contract retained for provider-aware renderers in webview.ts. */
export const CODEX_QUALITY_FLAGS = [
  'invalid-turn-context',
  'invalid-session-meta',
  'missing-pseudonymizer',
  'missing-token-info',
  'invalid-token-count',
  'counter-regression',
  'missing-parent',
  'index-backfill-incomplete',
  'ambiguous-session-identity',
  'invalid-json',
  'invalid-event-payload',
  'unknown-event',
  'invalid-event-timestamp',
  'oversized-jsonl-line',
  'truncated-jsonl',
  'replaced-jsonl',
  'stale-file',
  'stale-reset-required',
] as const;

export type CodexQualityFlag = (typeof CODEX_QUALITY_FLAGS)[number];

export interface CodexViewCopy {
  title: string;
  beta: string;
  refresh: string;
  overview: string;
  explore: string;
  recommendations: string;
  usageTrend: string;
  daily: string;
  date: string;
  role: string;
  scope: string;
  threadLabel: string;
  unnamedSession: string;
  unidentifiedProject: string;
  parentThread: string;
  searchThreads: string;
  all: string;
  localDirectory: string;
  lastActive: string;
  expand: string;
  viewAllSessions: string;
  sortBy: string;
  rootRole: string;
  childRole: string;
  approvalReviewerRole: string;
  unknownRole: string;
  noDailyData: string;
  noMonthlyData: string;
  noThreadData: string;
  lastTask: string;
  last7Days: string;
  last30Days: string;
  allTime: string;
  behavior: string;
  settings: string;
  monthly: string;
  tokenComposition: string;
  freshInput: string;
  reasoningSubset: string;
  threadRoleComposition: string;
  childThreadsPerRootTask: string;
  childFreshShare: string;
  approvalFreshShare: string;
  highEffortFreshShare: string;
  processedToFreshRatio: string;
  reasoningOutputShare: string;
  postPatchToolCallsPerPatchCall: string;
  patchCalls: string;
  compactions: string;
  projects: string;
  projectLabel: string;
  processed: string;
  apiEquivalentCost: string;
  apiEquivalentCostHelp: string;
  fresh: string;
  input: string;
  cachedInput: string;
  output: string;
  reasoning: string;
  model: string;
  models: string;
  efforts: string;
  threads: string;
  rootTasks: string;
  childThreads: string;
  approvalReviewers: string;
  duration: string;
  cacheShare: string;
  coverage: string;
  quality: string;
  qualityFlagLabels: Record<CodexQualityFlag, string>;
  qualityFlagUnknown: string;
  complete: string;
  partial: string;
  lastObserved: string;
  usageLimits: string;
  resets: string;
  credits: string;
  unlimited: string;
  unavailable: string;
  optimization: string;
  structuralProxy: string;
  pasteConstraint: string;
  constraintNoAgents: string;
  constraintLowerEffort: string;
  constraintPostPatch: string;
  constraintCacheContext: string;
  constraintApprovalReviewer: string;
  constraintTests?: string;
  constraintStop?: string;
  recommendationComposition: string;
  recommendationProxyKpi: string;
  recommendationEmpty: string;
  recommendationPartial: string;
  insightObservation: string;
  insightEvidence: string;
  insightConditionalAction: string;
  insightObservations: Record<CodexInsightKind, string>;
  insightTips: Record<CodexInsightKind, string>;
  insightEvidenceLabels: Record<CodexInsightEvidenceKey, string>;
  compareTitle: string;
  noRecentTask: string;
  sessions: string;
  modelsEffort: string;
  clearFilters: string;
  activeFilters: string;
  parentTask: string;
  fiveHourWindow: string;
  weeklyWindow: string;
  used: string;
  remaining: string;
  localLogNotLive: string;
  accountSnapshotLastObserved: string;
  limitExpired: string;
  limitMissing: string;
  observedSessionDuration: string;
  indexedLogEntries: string;
  indexedStorage: string;
  indexedAllTime: string;
  indexedSubtotal: string;
  indexingInProgress: string;
  updatedAt: string;
  claudeTokenAccounting: string;
  codexTokenAccounting: string;
  insightTitles: Record<CodexInsightKind, string>;
}

export const CODEX_COPY_EN: CodexViewCopy = {
  title: 'Codex usage',
  beta: 'Beta',
  refresh: 'Refresh',
  overview: 'Overview',
  explore: 'Explore',
  recommendations: 'Recommendations',
  usageTrend: 'Usage trend',
  daily: 'Daily',
  date: 'Date',
  role: 'Role',
  scope: 'Scope',
  threadLabel: 'Thread',
  unnamedSession: 'Unnamed session',
  unidentifiedProject: 'Unidentified project',
  parentThread: 'Parent',
  searchThreads: 'Search sessions',
  all: 'All',
  localDirectory: 'Local folder',
  lastActive: 'Last active',
  expand: 'Expand',
  viewAllSessions: 'View all sessions',
  sortBy: 'Sort by',
  rootRole: 'Root',
  childRole: 'Subagent',
  approvalReviewerRole: 'Approval reviewer',
  unknownRole: 'Unknown',
  noDailyData: 'No daily Codex usage is indexed yet.',
  noMonthlyData: 'No monthly Codex usage is indexed yet.',
  noThreadData: 'No Codex threads are indexed yet.',
  lastTask: 'Recent task',
  last7Days: 'Last 7 days',
  last30Days: 'Last 30 days',
  allTime: 'All time',
  behavior: 'Behavior',
  settings: 'Settings',
  monthly: 'Monthly',
  tokenComposition: 'Token composition',
  freshInput: 'Uncached input',
  reasoningSubset: 'Included in Output',
  threadRoleComposition: 'Thread-role composition',
  childThreadsPerRootTask: 'Child threads / root task',
  childFreshShare: 'Child uncached share',
  approvalFreshShare: 'Approval uncached share',
  highEffortFreshShare: 'High-effort uncached share',
  processedToFreshRatio: 'Processed / uncached',
  reasoningOutputShare: 'Reasoning share of output',
  postPatchToolCallsPerPatchCall: 'Post-patch tool-call proxy / patch call',
  patchCalls: 'Patch calls',
  compactions: 'Compactions',
  projects: 'Projects',
  projectLabel: 'Project',
  processed: 'Processed',
  apiEquivalentCost: 'API-equivalent cost',
  apiEquivalentCostHelp: 'Estimated from currently indexed tokens at current official API rates; not a bill or subscription charge. Priced model coverage: {coverage}.',
  fresh: 'Uncached usage',
  input: 'Input',
  cachedInput: 'Cached input',
  output: 'Output',
  reasoning: 'Reasoning',
  model: 'Model',
  models: 'Models',
  efforts: 'Effort',
  threads: 'Threads',
  rootTasks: 'Root tasks',
  childThreads: 'Child threads',
  approvalReviewers: 'Approval reviewers',
  duration: 'Session span',
  cacheShare: 'Input cache share',
  coverage: 'Coverage',
  quality: 'Quality',
  qualityFlagLabels: {
    'invalid-turn-context': 'Invalid turn context',
    'invalid-session-meta': 'Invalid session metadata',
    'missing-pseudonymizer': 'Identity protection unavailable',
    'missing-token-info': 'Missing token information',
    'invalid-token-count': 'Invalid token count',
    'counter-regression': 'Usage counter moved backwards',
    'missing-parent': 'Parent session log missing; conservative usage retained',
    'index-backfill-incomplete': 'Usage index is still being built; current totals are incomplete and indexing will continue automatically',
    'ambiguous-session-identity': 'Duplicate session identity is ambiguous; both local copies are retained',
    'invalid-json': 'Unreadable JSON log entry',
    'invalid-event-payload': 'Invalid event payload',
    'unknown-event': 'Unrecognized log event',
    'invalid-event-timestamp': 'Invalid event timestamp',
    'oversized-jsonl-line': 'Oversized log entry',
    'truncated-jsonl': 'Log file was truncated',
    'replaced-jsonl': 'Log file was replaced',
    'stale-file': 'Using last verified file data',
    'stale-reset-required': 'Full file rescan required',
  },
  qualityFlagUnknown: 'Other data-quality issue',
  complete: 'Complete',
  partial: 'Partial',
  lastObserved: 'Last observed',
  usageLimits: 'Usage limits',
  resets: 'Resets',
  credits: 'Credits',
  unlimited: 'Unlimited',
  unavailable: 'Unavailable',
  optimization: 'Local optimization signals',
  structuralProxy: 'Structural proxy; tool-call details are not read.',
  pasteConstraint: 'Paste-ready constraint',
  constraintNoAgents: 'For comparable tasks, decide whether subagents are needed before spawning them.',
  constraintLowerEffort: 'On a representative task, A/B the observed high effort against one lower effort level.',
  constraintPostPatch: 'After the next patch, use the structural proxy to consider a shorter tool sequence.',
  constraintCacheContext: 'Keep the cache and context proxy in view when choosing the next task boundary.',
  constraintApprovalReviewer: 'Before adding approval reviewers, check whether that role is needed for this task.',
  recommendationComposition: 'Observed role, model, and effort composition',
  recommendationProxyKpi: 'Structural proxy KPI',
  recommendationEmpty: 'No evidence-based recommendations for this scope.',
  recommendationPartial: 'Some date ranges are unavailable while the daily index catches up.',
  insightObservation: 'Observation',
  insightEvidence: 'Evidence',
  insightConditionalAction: 'Conditional action',
  compareTitle: 'Provider comparison',
  noRecentTask: 'No recent Codex task is indexed yet.',
  sessions: 'Sessions',
  modelsEffort: 'Models & effort',
  clearFilters: 'Clear filters',
  activeFilters: 'Active filters',
  parentTask: 'Parent task',
  fiveHourWindow: '5-hour window',
  weeklyWindow: 'Weekly window',
  used: 'used',
  remaining: 'remaining',
  localLogNotLive: 'Local log · not live',
  accountSnapshotLastObserved:
    'Usage combines sign-ins in this Codex home · limits are last observed, not combined',
  limitExpired: 'Expired / stale last-observed limit',
  limitMissing: 'No locally observed usage limit',
  observedSessionDuration: 'Elapsed span between the first and last observed events; a proxy, not actual active time.',
  indexedSubtotal: 'Indexed subtotal',
  indexingInProgress: 'Indexing is still in progress; unverified legacy totals are excluded.',
  indexedLogEntries: 'Indexed log entries',
  indexedStorage: 'Indexed storage',
  indexedAllTime: 'Indexed all time',
  updatedAt: 'Updated at',
  claudeTokenAccounting: 'Claude tokens',
  codexTokenAccounting: 'Codex tokens',
  insightTitles: {
    'multi-agent-share': 'Subagent uncached-share proxy',
    'effort-comparison': 'Compare one lower effort level',
    'post-patch-tool-intensity': 'Post-patch tool intensity proxy',
    'cache-context': 'Cache and long-context context',
    'approval-reviewer-share': 'Approval-reviewer uncached-share proxy',
  },
  insightObservations: {
    'multi-agent-share': 'A substantial share of observed uncached usage is associated with subagent roles.',
    'effort-comparison': 'High effort appears in this structural proxy scope.',
    'post-patch-tool-intensity': 'Observed tool activity after patches is elevated in this structural proxy scope.',
    'cache-context': 'Processed activity is high relative to uncached usage; cache/context can affect this proxy.',
    'approval-reviewer-share': 'A material share of observed uncached usage is associated with approval-reviewer roles.',
  },
  insightTips: {
    'multi-agent-share': 'For comparable tasks, decide whether subagents are needed before spawning them.',
    'effort-comparison': 'On a representative task, A/B the observed high effort against one lower effort level.',
    'post-patch-tool-intensity': 'After the next patch, use this proxy to consider a shorter tool sequence.',
    'cache-context': 'Keep cache/context observations in view when choosing the next task boundary.',
    'approval-reviewer-share': 'Before adding approval reviewers, check whether that role is needed for this task.',
  },
  insightEvidenceLabels: {
    taskCount: 'Root tasks',
    rootSessionFresh: 'Root / unknown-role uncached usage',
    subagentFresh: 'Subagent uncached usage',
    approvalReviewerFresh: 'Approval-reviewer uncached usage',
    observedEffort: 'Observed effort',
    highEffortFresh: 'High-effort uncached usage',
    lowMediumEffortFresh: 'Lower-effort uncached usage',
    patchCalls: 'Patch calls (proxy)',
    toolCalls: 'Tool calls (proxy)',
    postPatchToolCalls: 'Post-patch tool calls (proxy)',
    compactCount: 'Context compactions (proxy)',
    taskCompleteCount: 'Task-complete events (proxy)',
    processedToFreshRatio: 'Processed / uncached proxy',
    cachedInputShare: 'Cached-input share',
    reasoningOutputShare: 'Reasoning share of output',
  },
};

export function defaultDashboardProvider(
  hasClaude: boolean,
  hasCodex: boolean,
): 'claude' | 'codex' {
  return hasClaude || !hasCodex ? 'claude' : 'codex';
}
