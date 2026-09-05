import { CodexScope } from '../../types';
import type { CodexUsageScopeView, CodexUsageView } from './codexUsage';

export type CodexInsightKind =
  | 'multi-agent-share'
  | 'effort-comparison'
  | 'post-patch-tool-intensity'
  | 'cache-context'
  | 'approval-reviewer-share';

export type CodexInsightEvidenceKey =
  | 'taskCount'
  | 'rootSessionFresh'
  | 'subagentFresh'
  | 'approvalReviewerFresh'
  | 'observedEffort'
  | 'highEffortFresh'
  | 'lowMediumEffortFresh'
  | 'patchCalls'
  | 'toolCalls'
  | 'postPatchToolCalls'
  | 'compactCount'
  | 'taskCompleteCount'
  | 'processedToFreshRatio'
  | 'cachedInputShare'
  | 'reasoningOutputShare';

export interface CodexInsight {
  kind: CodexInsightKind;
  severity: 'info' | 'normal' | 'strong';
  scope: CodexScope;
  evidence: Partial<Record<CodexInsightEvidenceKey, number | string>>;
  proxy: true;
}

/** Shared host-to-renderer contract for all recommendation ranges. */
export interface CodexScopedInsights {
  recent: CodexInsight[];
  last7Days: CodexInsight[];
  last30Days: CodexInsight[];
  allTime: CodexInsight[];
}

export function emptyCodexScopedInsights(): CodexScopedInsights {
  return { recent: [], last7Days: [], last30Days: [], allTime: [] };
}

/** Production-safe scope wiring; every rolling range is labelled explicitly. */
export function buildScopedCodexInsights(view: CodexUsageView): CodexScopedInsights {
  return {
    recent: view.lastTask ? buildCodexInsights(view.lastTask, 'recent') : [],
    last7Days: buildCodexInsights(view.last7Days, '7d'),
    last30Days: buildCodexInsights(view.last30Days, '30d'),
    allTime: buildCodexInsights(view.allTime, 'all'),
  };
}

const HIGH_EFFORTS = new Set(['high', 'xhigh', 'max', 'ultra']);

function positive(value: number): number {
  return Math.max(0, value);
}

function isSmallChange(scope: CodexUsageScopeView): boolean {
  const { patchCalls, toolCalls, postPatchToolCalls, compactCount, taskCompleteCount } = scope.structural;
  return patchCalls >= 1 && patchCalls <= 2 && toolCalls >= 0 && postPatchToolCalls >= 0 && compactCount >= 0 && taskCompleteCount >= 0;
}

function effortEvidence(scope: CodexUsageScopeView): {
  observedEffort: string;
  highEffortFresh: number;
  lowMediumEffortFresh: number;
} | undefined {
  let highEffortFresh = 0;
  let lowMediumEffortFresh = 0;
  let observedEffort: string | undefined;
  for (const effort of scope.efforts) {
    const fresh = positive(effort.totals.fresh);
    if (HIGH_EFFORTS.has(effort.key.toLowerCase())) {
      highEffortFresh += fresh;
      observedEffort ??= effort.key;
    } else {
      lowMediumEffortFresh += fresh;
    }
  }
  return observedEffort
    ? { observedEffort, highEffortFresh, lowMediumEffortFresh }
    : undefined;
}

function hasUsableEvidence(scope: CodexUsageScopeView): boolean {
  return scope.total.fresh > 0 || Object.values(scope.structural).some((value) => value > 0);
}

/**
 * Builds local, numeric-only signals. It deliberately consumes no conversation
 * content, command bodies, tool arguments, paths, IDs, cost, or file counts.
 */
export function buildCodexInsights(
  scope: CodexUsageScopeView,
  scopeKey?: CodexScope,
): CodexInsight[] {
  // A period-bearing object without an explicit range is ambiguous. Fail
  // closed; only the narrow non-period legacy entry point maps to recent.
  if (scopeKey === undefined && scope.periodCoverage) return [];
  const resolvedScope = scopeKey ?? 'recent';
  if (!hasUsableEvidence(scope)) return [];
  const needsCompletePeriod = resolvedScope === '7d' || resolvedScope === '30d';
  if (needsCompletePeriod && !scope.periodCoverage?.complete) {
    return [];
  }

  const insights: CodexInsight[] = [];
  const fresh = positive(scope.total.fresh);
  const subagentFresh = fresh * Math.max(0, Math.min(1, scope.childFreshShare));
  const approvalReviewerFresh = fresh * Math.max(0, Math.min(1, scope.approvalReviewerFreshShare));
  const rootSessionFresh = Math.max(0, fresh - subagentFresh - approvalReviewerFresh);

  if (scope.childThreads >= 3 && scope.childFreshShare >= 0.4) {
    insights.push({
      kind: 'multi-agent-share',
      severity: scope.childFreshShare >= 0.7 ? 'strong' : 'normal',
      scope: resolvedScope,
      evidence: {
        taskCount: positive(scope.rootTasks),
        rootSessionFresh,
        subagentFresh,
      },
      proxy: true,
    });
  }

  const effort = effortEvidence(scope);
  if (effort && isSmallChange(scope) && !(scope.childThreads >= 3 && scope.childFreshShare >= 0.4)) {
    insights.push({
      kind: 'effort-comparison',
      severity: 'normal',
      scope: resolvedScope,
      evidence: effort,
      proxy: true,
    });
  }

  const { patchCalls, toolCalls, postPatchToolCalls, compactCount, taskCompleteCount } = scope.structural;
  const toolCallsPerPatch = patchCalls > 0 ? toolCalls / patchCalls : 0;
  if (isSmallChange(scope) && (postPatchToolCalls >= 5 || toolCallsPerPatch >= 3)) {
    insights.push({
      kind: 'post-patch-tool-intensity',
      severity: postPatchToolCalls >= 8 || toolCallsPerPatch >= 5 ? 'strong' : 'normal',
      scope: resolvedScope,
      evidence: {
        patchCalls: positive(patchCalls),
        toolCalls: positive(toolCalls),
        postPatchToolCalls: positive(postPatchToolCalls),
      },
      proxy: true,
    });
  }

  const processedToFreshRatio = fresh > 0 ? positive(scope.total.processed) / fresh : 0;
  if (processedToFreshRatio >= 2.5) {
    insights.push({
      kind: 'cache-context',
      severity: 'info',
      scope: resolvedScope,
      evidence: {
        processedToFreshRatio,
        cachedInputShare: Math.max(0, Math.min(1, scope.cacheShare)),
        compactCount: positive(compactCount),
      },
      proxy: true,
    });
  }

  if (scope.approvalReviewerThreads > 0 && scope.approvalReviewerFreshShare >= 0.2) {
    insights.push({
      kind: 'approval-reviewer-share',
      severity: scope.approvalReviewerFreshShare >= 0.4 ? 'strong' : 'normal',
      scope: resolvedScope,
      evidence: {
        taskCount: positive(scope.rootTasks),
        rootSessionFresh,
        approvalReviewerFresh,
      },
      proxy: true,
    });
  }

  return insights;
}

/** Build only kind-specific local guidance; empty evidence intentionally means no text. */
export function pasteReadyConstraint(insights: CodexInsight[]): string {
  const kinds = new Set(insights.map((insight) => insight.kind));
  const sentences: string[] = [];
  if (kinds.has('multi-agent-share')) {
    sentences.push('For comparable tasks, decide whether subagents are needed before spawning them.');
  }
  if (kinds.has('effort-comparison')) {
    sentences.push('On a representative task, A/B the observed high effort against one lower effort level.');
  }
  if (kinds.has('post-patch-tool-intensity')) {
    sentences.push('After the next patch, use the structural proxy to consider a shorter tool sequence.');
  }
  if (kinds.has('cache-context')) {
    sentences.push('Keep the cache and context proxy in view when choosing the next task boundary.');
  }
  if (kinds.has('approval-reviewer-share')) {
    sentences.push('Before adding approval reviewers, check whether that role is needed for this task.');
  }
  return sentences.join(' ');
}
