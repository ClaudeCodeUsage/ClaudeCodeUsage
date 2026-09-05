import { ClaudeDataLoader } from './dataLoader';
import { ClaudeUsageRecord, ContentAnalysis, UsageData } from './types';

// Builds the advice prompt for a scope: usage aggregates, the v2.1 structured
// signals (multi-agent runs, thinking share, usage attribution) and a sample
// of the developer's actual prompts so the model can critique instruction
// quality. Standalone module so it can be exercised outside VS Code.

const norm = (p: string): string => (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

function cacheHitPercent(d: UsageData): string {
  const inputSide = d.totalInputTokens + d.totalCacheCreationTokens + d.totalCacheReadTokens;
  return inputSide > 0 ? ((d.totalCacheReadTokens / inputSide) * 100).toFixed(0) + '%' : 'n/a';
}

/**
 * @param scope 'overall' or a project group path
 */
export function buildAdviceSummary(
  records: ClaudeUsageRecord[],
  analysis: ContentAnalysis,
  scope: string,
  scopeLabel: string,
  windowDays: number = 30
): string {
  // The content analysis (and its prompt sample) was computed over this window
  // upstream in the loader; we only echo the number in the prose so the model
  // knows the horizon. Keep the two in sync via advice.promptWindowDays.
  const windowLabel = `last ${Math.max(1, Math.round(windowDays))} days`;
  const isOverall = scope === 'overall';
  const scopedRecords = isOverall
    ? records
    : records.filter((r) => norm(r._projectPath || '').startsWith(norm(scope)));
  const usage = ClaudeDataLoader.getAllTimeData(scopedRecords);
  const prompts = isOverall
    ? analysis.recentPrompts
    : analysis.recentPrompts.filter((p) => norm(p.cwd).startsWith(norm(scope)));
  // Cap the payload: oversized request bodies are one suspected cause of the
  // intermittent "terminated" failures on flaky networks (v2.1.0 Phase 0).
  const promptSample = prompts.slice(-40).map((p) => ({ ...p, text: p.text.slice(0, 1500) }));

  const lines: string[] = [];
  lines.push(`Scope: ${isOverall ? 'overall (all projects)' : scopeLabel}`);
  lines.push(
    `Usage: cost $${usage.totalCost.toFixed(2)}, input ${usage.totalInputTokens}, ` +
      `output ${usage.totalOutputTokens}, cache-write ${usage.totalCacheCreationTokens}, ` +
      `cache-read ${usage.totalCacheReadTokens}, messages ${usage.messageCount}`
  );
  lines.push(`Models used: ${Object.keys(usage.modelBreakdown).join(', ') || 'n/a'}`);
  lines.push('');
  lines.push(`Content token breakdown, all projects, ${windowLabel} (estimated):`);
  for (const c of analysis.categories) {
    const pct =
      analysis.totalEstimatedTokens > 0
        ? ((c.estimatedTokens / analysis.totalEstimatedTokens) * 100).toFixed(1)
        : '0';
    lines.push(`- ${c.key}: ~${c.estimatedTokens} tokens (${pct}%)`);
  }

  // === v2.1 structured signals ===

  // Multi-agent runs: true wf_ workflows and ad-hoc sub-agent batches. The
  // cache hit rate is the per-provider diagnostic: native Claude reuses the
  // prompt cache across a run's agents, providers without cross-agent
  // caching show ~0% — the same run costs disproportionately more there.
  const workflows = ClaudeDataLoader.getWorkflowBreakdown(scopedRecords, 10);
  if (workflows.length > 0) {
    lines.push('');
    lines.push('=== Multi-agent runs (workflows + ad-hoc subagent batches), most recent first ===');
    for (const w of workflows) {
      const models = Object.keys(w.data.modelBreakdown).join('/') || 'n/a';
      const share =
        usage.totalCost > 0 ? ` (${((w.data.totalCost / usage.totalCost) * 100).toFixed(1)}% of scope cost)` : '';
      lines.push(
        `- ${w.isAdHoc ? '[batch]' : '[workflow]'} "${w.name.slice(0, 60)}": ${w.agentCount} agents, ` +
          `$${w.data.totalCost.toFixed(2)}${share}, cache hit ${cacheHitPercent(w.data)}, models: ${models}`
      );
    }
  }

  // Estimated thinking share of assistant output (30-day window).
  const thinkingTotals = Object.values(analysis.thinkingBySession).reduce(
    (acc, v) => ({ thinking: acc.thinking + v.thinking, total: acc.total + v.assistantTotal }),
    { thinking: 0, total: 0 }
  );
  if (thinkingTotals.total > 0) {
    lines.push('');
    lines.push(
      `Estimated thinking share of assistant output (${windowLabel}): ` +
        `${((thinkingTotals.thinking / thinkingTotals.total) * 100).toFixed(0)}%` +
        ' (above ~60% suggests /effort high instead of xhigh for such tasks)'
    );
  }

  // Usage attribution (the dashboard's "Usage tracking" panel, week scope —
  // independent overlapping signals weighted by estimated cost).
  const attr = ClaudeDataLoader.getUsageAttribution(
    records,
    analysis,
    isOverall ? { kind: 'week' } : { kind: 'project', projectPath: scope }
  );
  if (attr.totalCost > 0) {
    const pct = (x: number): string => (x * 100).toFixed(0) + '%';
    lines.push('');
    lines.push(
      `=== Usage attribution (${isOverall ? 'last 7 days' : 'this project'}, cost-weighted, overlapping signals) ===`
    );
    lines.push(`- share of usage at >150k context: ${pct(attr.characteristics.largeContext)}`);
    lines.push(`- share from sessions active 8+ hours: ${pct(attr.characteristics.longSessions)}`);
    lines.push(`- share from subagent-heavy sessions: ${pct(attr.characteristics.subagentHeavy)}`);
    lines.push(`- share from workflow runs: ${pct(attr.characteristics.workflows)}`);
    const top = (
      label: string,
      entries: { key: string; share: number; count: number }[]
    ): void => {
      if (entries.length > 0) {
        lines.push(
          `- top ${label}: ` +
            entries
              .slice(0, 5)
              .map((e) => `${e.key} ${pct(e.share)} (${e.count}x)`)
              .join(', ')
        );
      }
    };
    top('skills', attr.skills);
    top('subagent types', attr.subagents);
    top('plugins', attr.plugins);
    top('models', attr.models);
  }

  lines.push('');
  // Safety valve on top of the per-prompt caps: skip the prompts section
  // entirely if it would still exceed ~80 KB.
  const promptBlockChars = promptSample.reduce((sum, p) => sum + p.text.length, 0);
  if (promptSample.length === 0 || promptBlockChars > 80_000) {
    lines.push('=== No recent user prompts captured for this scope ===');
    lines.push(
      'No prompt samples are available. Base your advice on the aggregate usage above and ' +
        'on general Claude Code best practices for writing clearer, more complete and more ' +
        'effective instructions. Also note any easy token savings the aggregates suggest.'
    );
  } else {
    lines.push(`=== Sample of ${promptSample.length} recent user prompts (review these for instruction quality) ===`);
    promptSample.forEach((p, i) => {
      lines.push(`[Prompt ${i + 1}]`);
      lines.push(p.text);
      lines.push('');
    });
    lines.push('=== End of prompts ===');
    lines.push('');
    lines.push(
      'Based primarily on the prompts above, give specific advice on how to write clearer, ' +
        'more complete and more effective instructions for Claude Code, with concrete rewrite ' +
        'examples drawn from the samples. Secondarily, note any easy token savings. ' +
        'Where the structured signals above show notable patterns (large-context share, ' +
        'multi-agent runs, cache hit rates per provider, heavy skills/plugins), address them ' +
        'with specific, actionable recommendations.'
    );
  }
  return lines.join('\n');
}
