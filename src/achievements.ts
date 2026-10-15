import type { CodexFileAggregate } from './providers/codex/codexIndex';
import { API_ACHIEVEMENT_DEFINITIONS, API_ACHIEVEMENT_SERIES, achievementMoneyProgress,
  type AchievementMoneyFacts } from './achievementMoneyCatalog';
import type {AchievementMoneyScopes} from './achievementMoneyScopes';
import type {AchievementEffortStatistics} from './achievementEffortStatistics';
import type {AchievementHistoryInput} from './achievementHistoryDates';
import type { ProviderTokenCounts } from './providers/providerTypes';
import type { AchievementActivity } from './achievementActivity';
import { SAFE_EXPLORATION_FEATURES } from './achievementActivity';
import { validAchievementBuckets, verifiedCodexAchievementFiles } from './codexAchievementProof';
import type { AchievementCalendarSignals, AchievementDayEvidence, AchievementTokenEvidence } from './achievementCalendar';
import { codexCollaborationEvidence, AchievementCollaborationEvidence } from './achievementCollaboration';
import { RECALIBRATED_ACHIEVEMENT_IDS_V2, isLegacyAchievementId } from './achievementRuleVersions';
import { LONG_TERM_ACHIEVEMENT_DEFINITIONS, type LongTermAchievementId } from './achievementLongTerm';

import { claudeAchievementFamily, codexModelFamily, normalizeCodexAchievementModel,
  type CodexModelFamily, type ClaudeModelFamily } from './achievementModels';
export { claudeAchievementFamily, codexModelFamily } from './achievementModels';
export type { CodexModelFamily, ClaudeModelFamily } from './achievementModels';
type EffortTier = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
const SPECTRUM_EFFORTS: readonly EffortTier[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export interface CodexAchievementSignals {
  /** Produced only from independently validated canonical lineages. */
  verifiedSubset?: true;
  modelCount: number;
  efforts: string[];
  familyRootCounts: Record<CodexModelFamily, number>;
  /** Reconciled input + output; cached input/reasoning are never added again. */
  familyProcessedTokens?: Record<CodexModelFamily, number>;
  effortProcessedTokens?: Partial<Record<EffortTier, number>>;
  /** One reconciled, nonnegative file total per session; cumulative only. */
  processedLowerBound?: number;
  dayEvidence?: AchievementDayEvidence;
  /** Runtime numeric dating proof; never an award or persisted index field. */
  historyDayEvidence?: AchievementHistoryInput['codex'];
  tokenEvidence?: AchievementTokenEvidence;
  /** Distinct, lineage-verified roots with actual usage at each effort tier. */
  effortRootCounts?: Partial<Record<EffortTier, number>>;
  /** Unique, evidenced child sessions under one verified root. */
  maxVerifiedAgentsPerRoot?: number;
  maxRealModelsPerRoot?: number;
  multiAgentRootCount?: number;
  /** Unique lineage-verified root tasks with a real model and positive usage. */
  verifiedRootCount?: number;
  verifiedChildCount?: number;
  multiModelRootCount?: number;
  /** Versioned joint counters, never inferred from old marginal maxima. */
  collaboration?: AchievementCollaborationEvidence;
  money?: AchievementMoneyScopes;
  /** Current complete-census statistics; informational, never another rule. */
  effortStatistics?: AchievementEffortStatistics;
}

export interface AchievementFacts {
  money?: AchievementMoneyFacts;
  /** Local recorded volume only; never a billing or productivity measure. */
  claudeTokens: number;
  claudeOutputTokens?: number;
  claudeCacheReadTokens?: number;
  claudeCacheCreationTokens?: number;
  claudeOutputSessions?: number;
  codexTokens: number;
  activeDays: number;
  claudeFamilies: string[];
  claudeFamilyTokens?: Partial<Record<ClaudeModelFamily, number>>;
  claudeFamilyOutputTokens?: Partial<Record<ClaudeModelFamily, number>>;
  fable?: FableAchievementSignals;
  weeklyPeakProcessed?: number;
  codexOutputTokens?: number;
  codexCachedInputTokens?: number;
  calendar?: AchievementCalendarSignals;
  outputHourStreak?: number;
  nightOutputPeak?: boolean;
  activity?: AchievementActivity;
  longestStreak?: number;
  codex: CodexAchievementSignals;
}

interface ClaudeModelTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

type ClaudeModelRows = Record<string, ClaudeModelTokens>;

export interface FableAchievementSignals {
  processedTokens: number;
  outputTokens?: number;
  activeDays: number;
  mixedFamilySession: boolean;
  outputSessions: number;
  allOutputSessions: number;
}

/** Only aggregate achievement proof crosses from the host into the Webview. */
export interface ClaudeSessionAchievementEvidence {
  outputSessions: number;
  fableOutputSessions: number;
  fableMixedFamilySession: boolean;
}

export function claudeSessionAchievementEvidence(sessions: Iterable<{
  sessionId?: string;
  data: { totalOutputTokens: number; modelBreakdown: ClaudeModelRows };
}>): ClaudeSessionAchievementEvidence {
  const bySession = new Map<string, { output: boolean; fable: boolean; other: boolean }>();
  let index = 0;
  for (const { sessionId, data } of sessions) {
    const key = sessionId ? `id:${sessionId}` : `row:${index}`;
    index++;
    const evidence = bySession.get(key) ?? { output: false, fable: false, other: false };
    evidence.output ||= Number.isSafeInteger(data.totalOutputTokens) && data.totalOutputTokens > 0;
    for (const [model, tokens] of Object.entries(data.modelBreakdown)) {
      if (!positiveOutput(tokens)) continue;
      const family = claudeAchievementFamily(model);
      evidence.fable ||= family === 'fable';
      evidence.other ||= family !== null && family !== 'fable';
    }
    bySession.set(key, evidence);
  }
  let outputSessions = 0;
  let fableOutputSessions = 0;
  let fableMixedFamilySession = false;
  for (const evidence of bySession.values()) {
    if (evidence.output) outputSessions++;
    if (evidence.fable) fableOutputSessions++;
    if (evidence.fable && evidence.other) fableMixedFamilySession = true;
  }
  return { outputSessions, fableOutputSessions, fableMixedFamilySession };
}

function positiveOutput(tokens: ClaudeModelTokens): boolean {
  return Number.isSafeInteger(tokens.outputTokens) && tokens.outputTokens > 0;
}

function processedClaudeTokens(tokens: ClaudeModelTokens): number {
  const parts = [tokens.inputTokens, tokens.outputTokens, tokens.cacheCreationTokens, tokens.cacheReadTokens];
  return parts.every((part) => Number.isSafeInteger(part) && part >= 0)
    ? parts.reduce((sum, part) => sum + part, 0) : 0;
}

function hasFableOutput(models: ClaudeModelRows): boolean {
  return Object.entries(models).some(([model, tokens]) =>
    claudeAchievementFamily(model) === 'fable' && positiveOutput(tokens));
}

/** Consumes already-materialized Claude aggregates; never opens a transcript. */
export function fableAchievementSignals(input: {
  allTimeModels: ClaudeModelRows;
  days: readonly { date: string; data: { modelBreakdown: ClaudeModelRows } }[];
  sessions: readonly { sessionId?: string; data: { modelBreakdown: ClaudeModelRows; totalOutputTokens?: number } }[];
  sessionEvidence?: ClaudeSessionAchievementEvidence;
}): FableAchievementSignals {
  const processedTokens = Object.entries(input.allTimeModels)
    .filter(([model]) => claudeAchievementFamily(model) === 'fable')
    .reduce((sum, [, tokens]) => sum + processedClaudeTokens(tokens), 0);
  const activeDays = new Set(input.days
    .filter(({ date, data }) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) &&
      new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date &&
      hasFableOutput(data.modelBreakdown))
    .map(({ date }) => date)).size;
  let mixedFamilySession = false;
  const outputSessionKeys = new Set<string>();
  const allOutputSessionKeys = new Set<string>();
  if (!input.sessionEvidence) input.sessions.forEach(({ sessionId, data }, index) => {
    if ((Number.isSafeInteger(data.totalOutputTokens) && (data.totalOutputTokens ?? 0) > 0) ||
        (data.totalOutputTokens === undefined && Object.values(data.modelBreakdown).some(positiveOutput))) {
      allOutputSessionKeys.add(sessionId ? `id:${sessionId}` : `row:${index}`);
    }
    if (!hasFableOutput(data.modelBreakdown)) return;
    outputSessionKeys.add(sessionId ? `id:${sessionId}` : `row:${index}`);
    if (!mixedFamilySession) mixedFamilySession = Object.entries(data.modelBreakdown)
      .some(([model, tokens]) => {
        const family = claudeAchievementFamily(model);
        return family !== null && family !== 'fable' && positiveOutput(tokens);
      });
  });
  return {
    processedTokens, activeDays,
    outputTokens: Object.entries(input.allTimeModels).filter(([model]) => claudeAchievementFamily(model) === 'fable')
      .reduce((sum,[,tokens]) => sum + (positiveOutput(tokens) ? tokens.outputTokens : 0),0),
    mixedFamilySession: input.sessionEvidence?.fableMixedFamilySession ?? mixedFamilySession,
    outputSessions: input.sessionEvidence?.fableOutputSessions ?? outputSessionKeys.size,
    allOutputSessions: input.sessionEvidence?.outputSessions ?? allOutputSessionKeys.size,
  };
}

/** Day keys are already civil dates in the configured timezone. Weeks start Monday. */
export function peakCalendarWeekProcessed(
  rows: Iterable<{ day: string; processed: number }>,
  coverageComplete: boolean,
): number {
  if (!coverageComplete) return 0;
  const weeks = new Map<string, number>();
  for (const { day, processed } of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isSafeInteger(processed) || processed < 0) continue;
    const timestamp = Date.parse(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) continue;
    const weekday = new Date(timestamp).getUTCDay();
    const monday = new Date(timestamp - ((weekday + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    weeks.set(monday, (weeks.get(monday) ?? 0) + processed);
  }
  let peak = 0;
  for (const value of weeks.values()) if (Number.isSafeInteger(value)) peak = Math.max(peak, value);
  return peak;
}

/** Do not turn ambiguous Codex day projections into activity milestones. */
export function achievementActiveDayKeys(
  claudeDays: Iterable<{ day: string; processed: number }>,
  codexDays: Iterable<{ day: string; processed: number }>,
  codexDaysTrusted: boolean,
): Set<string> {
  const days = new Set<string>();
  const add = (rows: Iterable<{ day: string; processed: number }>): void => {
    for (const { day, processed } of rows) {
      const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(day)
        ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
      if (Number.isSafeInteger(processed) && processed > 0 &&
          Number.isFinite(timestamp) &&
          new Date(timestamp).toISOString().slice(0, 10) === day) {
        days.add(day);
      }
    }
  };
  add(claudeDays);
  if (codexDaysTrusted) add(codexDays);
  return days;
}

export type AchievementGroup = 'claude' | 'codex' | 'combined' | 'plugin';

/** Auditable milestones: no badge is awarded just for opening a model once. */
export const ACHIEVEMENT_DEFINITIONS = [
  { id: 'sonnet-main', group: 'claude', target: 100_000_000 },
  { id: 'sonnet-main-silver', group: 'claude', target: 1_000_000_000 },
  { id: 'sonnet-main-gold', group: 'claude', target: 10_000_000_000 },
  { id: 'opus-cannon', group: 'claude', target: 100_000_000 },
  { id: 'opus-cannon-silver', group: 'claude', target: 1_000_000_000 },
  { id: 'opus-cannon-gold', group: 'claude', target: 10_000_000_000 },
  { id: 'haiku-worker', group: 'claude', target: 10_000_000 },
  { id: 'haiku-worker-silver', group: 'claude', target: 100_000_000 },
  { id: 'haiku-worker-gold', group: 'claude', target: 1_000_000_000 },
  { id: 'cache-wizard', group: 'claude', target: 100_000_000 },
  { id: 'cache-wizard-silver', group: 'claude', target: 1_000_000_000 },
  { id: 'cache-wizard-gold', group: 'claude', target: 10_000_000_000 },
  { id: 'claude-output-bronze', group: 'claude', target: 2_000_000 },
  { id: 'claude-output-silver', group: 'claude', target: 20_000_000 },
  { id: 'claude-output-gold', group: 'claude', target: 200_000_000 },
  { id: 'claude-output-sessions-bronze', group: 'claude', target: 10 },
  { id: 'claude-output-sessions-silver', group: 'claude', target: 100 },
  { id: 'claude-output-sessions-gold', group: 'claude', target: 1_000 },
  { id: 'claude-cache-creation-bronze', group: 'claude', target: 10_000_000 },
  { id: 'claude-cache-creation-silver', group: 'claude', target: 100_000_000 },
  { id: 'claude-cache-creation-gold', group: 'claude', target: 1_000_000_000 },
  { id: 'fable-volume-bronze', group: 'claude', target: 50_000_000 },
  { id: 'fable-volume-silver', group: 'claude', target: 500_000_000 },
  { id: 'fable-volume-gold', group: 'claude', target: 5_000_000_000 },
  { id: 'fable-days-bronze', group: 'claude', target: 7 },
  { id: 'fable-days-silver', group: 'claude', target: 30 },
  { id: 'fable-days-gold', group: 'claude', target: 120 },
  { id: 'fable-relay', group: 'claude', target: 1 },
  { id: 'fable-sessions-bronze', group: 'claude', target: 10 },
  { id: 'fable-sessions-silver', group: 'claude', target: 100 },
  { id: 'fable-sessions-gold', group: 'claude', target: 1_000 },
  { id: 'weekly-volume-bronze', group: 'combined', target: 500_000_000 },
  { id: 'weekly-volume-silver', group: 'combined', target: 2_000_000_000 },
  { id: 'weekly-volume-gold', group: 'combined', target: 10_000_000_000 },
  { id: 'output-hours-bronze', group: 'combined', target: 12 },
  { id: 'output-hours-silver', group: 'combined', target: 24 },
  { id: 'output-hours-gold', group: 'combined', target: 48 },
  { id: 'night-output-peak', group: 'combined', target: 1 },
  { id: 'settings-explorer-bronze', group: 'plugin', target: 3 },
  { id: 'settings-explorer-silver', group: 'plugin', target: 10 },
  { id: 'settings-explorer-gold', group: 'plugin', target: 20 },
  { id: 'safe-feature-explorer', group: 'plugin', target: SAFE_EXPLORATION_FEATURES.length },
  { id: 'local-share-export', group: 'plugin', target: 1 },
  { id: 'local-advice-feedback', group: 'plugin', target: 1 },
  { id: 'astra-regular', group: 'codex', target: 500_000_000 },
  { id: 'astra-regular-silver', group: 'codex', target: 5_000_000_000 },
  { id: 'astra-regular-gold', group: 'codex', target: 50_000_000_000 },
  { id: 'sol-regular', group: 'codex', target: 1_000_000_000 },
  { id: 'sol-regular-silver', group: 'codex', target: 10_000_000_000 },
  { id: 'sol-regular-gold', group: 'codex', target: 100_000_000_000 },
  { id: 'luna-regular', group: 'codex', target: 100_000_000 },
  { id: 'luna-regular-silver', group: 'codex', target: 1_000_000_000 },
  { id: 'luna-regular-gold', group: 'codex', target: 10_000_000_000 },
  { id: 'agent-standup', group: 'codex', target: 5 },
  { id: 'tiny-ai-company', group: 'codex', target: 20 },
  { id: 'agent-team-gold', group: 'codex', target: 50 },
  { id: 'agent-conductor', group: 'codex', target: 10 },
  { id: 'agent-conductor-silver', group: 'codex', target: 50 },
  { id: 'agent-conductor-gold', group: 'codex', target: 200 },
  { id: 'root-portfolio-bronze', group: 'codex', target: 25 },
  { id: 'root-portfolio-silver', group: 'codex', target: 250 },
  { id: 'root-portfolio-gold', group: 'codex', target: 2_000 },
  { id: 'agent-participation-bronze', group: 'codex', target: 25 },
  { id: 'agent-participation-silver', group: 'codex', target: 250 },
  { id: 'agent-participation-gold', group: 'codex', target: 2_500 },
  { id: 'model-relay-roots-bronze', group: 'codex', target: 10 },
  { id: 'model-relay-roots-silver', group: 'codex', target: 100 },
  { id: 'model-relay-roots-gold', group: 'codex', target: 1_000 },
  { id: 'multi-core-human', group: 'codex', target: 3 },
  { id: 'same-root-models-silver', group: 'codex', target: 10 },
  { id: 'same-root-models-gold', group: 'codex', target: 30 },
  { id: 'effort-explorer', group: 'codex', target: 4 },
  { id: 'effort-breadth-silver', group: 'codex', target: 5 },
  { id: 'effort-spectrum', group: 'codex', target: 6 },
  { id: 'active-day-streak', group: 'combined', target: 7 },
  { id: 'active-day-streak-silver', group: 'combined', target: 30 },
  { id: 'active-day-streak-gold', group: 'combined', target: 100 },
  { id: 'active-days-bronze', group: 'combined', target: 30 },
  { id: 'active-days-silver', group: 'combined', target: 180 },
  { id: 'active-days-gold', group: 'combined', target: 365 },
  { id: 'streak-machine', group: 'combined', target: 14 },
  { id: 'model-rainbow-bronze', group: 'combined', target: 2 },
  { id: 'model-rainbow', group: 'combined', target: 5 },
  { id: 'model-rainbow-gold', group: 'combined', target: 7 },
  { id: 'hundred-million-club', group: 'combined', target: 100_000_000 },
  { id: 'billion-token-club', group: 'combined', target: 1_000_000_000 },
  { id: 'ten-billion-token-club', group: 'combined', target: 10_000_000_000 },
  { id: 'hundred-billion-token-club', group: 'combined', target: 100_000_000_000 },
  { id: 'trillion-token-club', group: 'combined', target: 1_000_000_000_000 },
  { id: 'codex-output-bronze', group: 'codex', target: 5_000_000 },
  { id: 'codex-output-silver', group: 'codex', target: 50_000_000 },
  { id: 'codex-output-gold', group: 'codex', target: 500_000_000 },
  { id: 'codex-cache-read-bronze', group: 'codex', target: 1_000_000_000 },
  { id: 'codex-cache-read-silver', group: 'codex', target: 10_000_000_000 },
  { id: 'codex-cache-read-gold', group: 'codex', target: 100_000_000_000 },
  { id: 'astra-days-bronze', group: 'codex', target: 7 },
  { id: 'astra-days-silver', group: 'codex', target: 30 },
  { id: 'astra-days-gold', group: 'codex', target: 120 },
  { id: 'sol-days-bronze', group: 'codex', target: 7 },
  { id: 'sol-days-silver', group: 'codex', target: 30 },
  { id: 'sol-days-gold', group: 'codex', target: 120 },
  { id: 'luna-days-bronze', group: 'codex', target: 7 },
  { id: 'luna-days-silver', group: 'codex', target: 30 },
  { id: 'luna-days-gold', group: 'codex', target: 120 },
  { id: 'sonnet-days-bronze', group: 'claude', target: 7 },
  { id: 'sonnet-days-silver', group: 'claude', target: 30 },
  { id: 'sonnet-days-gold', group: 'claude', target: 120 },
  { id: 'opus-days-bronze', group: 'claude', target: 7 },
  { id: 'opus-days-silver', group: 'claude', target: 30 },
  { id: 'opus-days-gold', group: 'claude', target: 120 },
  { id: 'haiku-days-bronze', group: 'claude', target: 7 },
  { id: 'haiku-days-silver', group: 'claude', target: 30 },
  { id: 'haiku-days-gold', group: 'claude', target: 120 },
  { id: 'dual-provider-days-bronze', group: 'combined', target: 7 },
  { id: 'dual-provider-days-silver', group: 'combined', target: 30 },
  { id: 'dual-provider-days-gold', group: 'combined', target: 100 },
  { id: 'active-weeks-bronze', group: 'combined', target: 4 },
  { id: 'active-weeks-silver', group: 'combined', target: 12 },
  { id: 'active-weeks-gold', group: 'combined', target: 26 },
  { id: 'weekly-average-bronze', group: 'combined', target: 500_000_000 },
  { id: 'weekly-average-silver', group: 'combined', target: 2_000_000_000 },
  { id: 'weekly-average-gold', group: 'combined', target: 5_000_000_000 },
  { id: 'three-family-day', group: 'combined', target: 1 },
  { id: 'dual-provider-day', group: 'combined', target: 1 },
  ...LONG_TERM_ACHIEVEMENT_DEFINITIONS,
  ...API_ACHIEVEMENT_DEFINITIONS,
] as const;

export type AchievementId = typeof ACHIEVEMENT_DEFINITIONS[number]['id'];

/** Preserve existing tier IDs; migrations recheck grants whose evidence rules changed. */
export const ACHIEVEMENT_SERIES: Record<string, readonly AchievementId[]> = {
  'cumulative-volume': ['hundred-million-club', 'billion-token-club', 'ten-billion-token-club',
    'hundred-billion-token-club', 'trillion-token-club'],
  'sonnet-main': ['sonnet-main', 'sonnet-main-silver', 'sonnet-main-gold'],
  'opus-cannon': ['opus-cannon', 'opus-cannon-silver', 'opus-cannon-gold'],
  'haiku-worker': ['haiku-worker', 'haiku-worker-silver', 'haiku-worker-gold'],
  'cache-wizard': ['cache-wizard', 'cache-wizard-silver', 'cache-wizard-gold'],
  'claude-output': ['claude-output-bronze', 'claude-output-silver', 'claude-output-gold'],
  'claude-output-sessions': ['claude-output-sessions-bronze', 'claude-output-sessions-silver', 'claude-output-sessions-gold'],
  'claude-cache-creation': ['claude-cache-creation-bronze', 'claude-cache-creation-silver', 'claude-cache-creation-gold'],
  'fable-volume': ['fable-volume-bronze', 'fable-volume-silver', 'fable-volume-gold'],
  'fable-days': ['fable-days-bronze', 'fable-days-silver', 'fable-days-gold'],
  'fable-sessions': ['fable-sessions-bronze', 'fable-sessions-silver', 'fable-sessions-gold'],
  'weekly-volume': ['weekly-volume-bronze', 'weekly-volume-silver', 'weekly-volume-gold'],
  'output-hours': ['output-hours-bronze', 'output-hours-silver', 'output-hours-gold'],
  'settings-explorer': ['settings-explorer-bronze', 'settings-explorer-silver', 'settings-explorer-gold'],
  'astra-regular': ['astra-regular', 'astra-regular-silver', 'astra-regular-gold'],
  'sol-regular': ['sol-regular', 'sol-regular-silver', 'sol-regular-gold'],
  'luna-regular': ['luna-regular', 'luna-regular-silver', 'luna-regular-gold'],
  'agent-team': ['agent-standup', 'tiny-ai-company', 'agent-team-gold'],
  'same-root-models': ['multi-core-human', 'same-root-models-silver', 'same-root-models-gold'],
  'effort-breadth': ['effort-explorer', 'effort-breadth-silver', 'effort-spectrum'],
  'agent-conductor': ['agent-conductor', 'agent-conductor-silver', 'agent-conductor-gold'],
  'root-portfolio': ['root-portfolio-bronze', 'root-portfolio-silver', 'root-portfolio-gold'],
  'agent-participation': ['agent-participation-bronze', 'agent-participation-silver', 'agent-participation-gold'],
  'model-relay-roots': ['model-relay-roots-bronze', 'model-relay-roots-silver', 'model-relay-roots-gold'],
  'active-day-streak': ['active-day-streak', 'active-day-streak-silver', 'active-day-streak-gold'],
  'active-days': ['active-days-bronze', 'active-days-silver', 'active-days-gold'],
  'model-rainbow': ['model-rainbow-bronze', 'model-rainbow', 'model-rainbow-gold'],
  'codex-output': ['codex-output-bronze', 'codex-output-silver', 'codex-output-gold'],
  'codex-cache-read': ['codex-cache-read-bronze', 'codex-cache-read-silver', 'codex-cache-read-gold'],
  'astra-days': ['astra-days-bronze', 'astra-days-silver', 'astra-days-gold'],
  'sol-days': ['sol-days-bronze', 'sol-days-silver', 'sol-days-gold'],
  'luna-days': ['luna-days-bronze', 'luna-days-silver', 'luna-days-gold'],
  'sonnet-days': ['sonnet-days-bronze', 'sonnet-days-silver', 'sonnet-days-gold'],
  'opus-days': ['opus-days-bronze', 'opus-days-silver', 'opus-days-gold'],
  'haiku-days': ['haiku-days-bronze', 'haiku-days-silver', 'haiku-days-gold'],
  'dual-provider-days': ['dual-provider-days-bronze', 'dual-provider-days-silver', 'dual-provider-days-gold'],
  'active-weeks': ['active-weeks-bronze', 'active-weeks-silver', 'active-weeks-gold'],
  'weekly-average': ['weekly-average-bronze', 'weekly-average-silver', 'weekly-average-gold'],
  ...API_ACHIEVEMENT_SERIES,
};
for (const rule of LONG_TERM_ACHIEVEMENT_DEFINITIONS) {
  ACHIEVEMENT_SERIES[rule.series] = [...ACHIEVEMENT_SERIES[rule.series], rule.id];
}

const QUIET_ACHIEVEMENTS = new Set<AchievementId>([
  'night-output-peak', 'output-hours-silver', 'output-hours-gold',
]);

/** Frozen pre-release targets: retained IDs prove only their former floor. */
const PRE_CALIBRATION_LADDERS: Record<string, readonly number[]> = {
  'sonnet-main': [2e6, 1e8, 1e9], 'opus-cannon': [2e6, 5e8, 1e10],
  'haiku-worker': [5e5, 1e7, 1e8], 'cache-wizard': [1e7, 1e9, 1e10],
  'claude-output': [1e6, 5e7, 5e8], 'claude-cache-creation': [1e7, 1e9, 1e10],
  'fable-volume': [1e7, 1e8, 1e9], 'astra-regular': [1e8, 1e9, 1e10],
  'sol-regular': [1e8, 1e9, 1e10], 'codex-output': [1e6, 5e7, 5e8],
  'codex-cache-read': [1e8, 1e9, 1e10], 'weekly-average': [5e8, 2e9, 1e10],
  'model-rainbow': [2, 5, 6],
};
const CALIBRATION_RECHECK_ONLY: readonly AchievementId[] = [
  ...ACHIEVEMENT_SERIES['fable-days'].slice(0,3), ...ACHIEVEMENT_SERIES['active-weeks'].slice(0,3), 'three-family-day',
  ...RECALIBRATED_ACHIEVEMENT_IDS_V2,
];
export const CALIBRATED_ACHIEVEMENT_IDS: readonly AchievementId[] = [
  ...Object.entries(PRE_CALIBRATION_LADDERS).flatMap(([series, former]) => ACHIEVEMENT_SERIES[series].slice(0,former.length)),
  ...CALIBRATION_RECHECK_ONLY,
];

/** Keep unrelated awards; a changed condition cannot inherit numeric proof. */
export function migrateCalibratedAchievementGrants(value: unknown): AchievementId[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(ACHIEVEMENT_DEFINITIONS.map(rule => rule.id));
  const existing = new Set<AchievementId>(value.filter((id): id is AchievementId =>
    typeof id === 'string' && allowed.has(id) && isLegacyAchievementId(id)));
  const changed = new Set(CALIBRATED_ACHIEVEMENT_IDS);
  const retained = new Set([...existing].filter(id => !changed.has(id)));
  for (const [series, formerTargets] of Object.entries(PRE_CALIBRATION_LADDERS)) {
    const ids = ACHIEVEMENT_SERIES[series].slice(0,formerTargets.length);
    const provenFloor = ids.reduce((floor, id, index) => existing.has(id)
      ? Math.max(floor, formerTargets[index]) : floor, 0);
    for (const id of ids) {
      if (RECALIBRATED_ACHIEVEMENT_IDS_V2.includes(id)) continue;
      const target = ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === id)!.target;
      if (provenFloor >= target) retained.add(id);
    }
  }
  return [...retained].sort();
}

export function notifiableAchievementIds(ids: readonly AchievementId[]): AchievementId[] {
  return ids.filter((id) => !QUIET_ACHIEVEMENTS.has(id));
}
export interface AchievementResult {
  id: AchievementId;
  group: AchievementGroup;
  progress: number;
  target: number;
  unlocked: boolean;
}

function positiveUsage(tokens: ProviderTokenCounts | undefined): boolean {
  return !!tokens &&
    Number.isSafeInteger(tokens.inputTotal) && tokens.inputTotal >= 0 &&
    Number.isSafeInteger(tokens.outputTotal) && tokens.outputTotal >= 0 &&
    Number.isSafeInteger(tokens.inputTotal + tokens.outputTotal) &&
    tokens.inputTotal + tokens.outputTotal > 0;
}

/**
 * Uses already-reconciled per-file aggregates. Orphan/cyclic parent chains,
 * inherited fork prefixes, unknown models, and zero usage cannot award.
 */
export function codexModelSignals(files: readonly CodexFileAggregate[]): CodexAchievementSignals {
  const bySession = new Map<string, CodexFileAggregate>();
  const ambiguousSessions = new Set<string>();
  const processedBySession = new Map<string, number>();
  for (const file of files) {
    const key = file.session.sessionKey;
    if (!key) continue;
    if (bySession.has(key)) ambiguousSessions.add(key);
    bySession.set(key, file);
    const input = file.total.inputTotal;
    const output = file.total.outputTotal;
    if (!Number.isSafeInteger(input) || input < 0 ||
        !Number.isSafeInteger(output) || output < 0 ||
        !Number.isSafeInteger(input + output)) continue;
    processedBySession.set(key, Math.max(processedBySession.get(key) ?? 0, input + output));
  }
  const processedLowerBound = [...processedBySession.values()].reduce((sum, value) => sum + value, 0);
  const models = new Set<string>();
  const efforts = new Set<string>();
  const familyProcessedTokens: Record<CodexModelFamily, number> = { astra: 0, sol: 0, luna: 0 };
  const effortProcessedTokens: Partial<Record<EffortTier, number>> = {};
  const roots: Record<CodexModelFamily, Set<string>> = {
    astra: new Set(), sol: new Set(), luna: new Set(),
  };
  const effortRoots: Record<EffortTier, Set<string>> = {
    low: new Set(), medium: new Set(), high: new Set(),
    xhigh: new Set(), max: new Set(), ultra: new Set(),
  };
  const childrenByRoot = new Map<string, Set<string>>();
  const verifiedChildren = new Set<string>();
  const modelsByRoot = new Map<string, Set<string>>();
  const rootBySession = new Map<string, string | null>();
  const verifiedRoot = (file: CodexFileAggregate): string | null => {
    let current = file;
    const seen = new Set<string>();
    let root: string | null = null;
    while (true) {
      const key = current.session.sessionKey;
      if (!key || seen.has(key) || ambiguousSessions.has(key)) break;
      if (rootBySession.has(key)) { root = rootBySession.get(key)!; break; }
      seen.add(key);
      const parent = current.session.parentSessionKey;
      if (!parent) { root = current.session.role === 'root' ? key : null; break; }
      const next = bySession.get(parent);
      if (!next) break;
      current = next;
    }
    for (const key of seen) rootBySession.set(key, root);
    return root;
  };
  for (const file of verifiedCodexAchievementFiles(files)) {
    const root = verifiedRoot(file);
    if (!root) continue;
    // The subset selector has already verified the complete model vector,
    // including cached/reasoning counters, before admitting this lineage.
    let hasRealModelUsage = false;
    for (const [rawModel, tokens] of Object.entries(file.byModel)) {
      if (!positiveUsage(tokens)) continue;
      const model = normalizeCodexAchievementModel(rawModel);
      if (!model) continue;
      hasRealModelUsage = true;
      models.add(model);
      let rootModels = modelsByRoot.get(root);
      if (!rootModels) modelsByRoot.set(root, rootModels = new Set());
      rootModels.add(model);
      const family = codexModelFamily(model);
      if (family) roots[family].add(root);
      if (family) familyProcessedTokens[family] += tokens.inputTotal + tokens.outputTotal;
    }
    if (!hasRealModelUsage) continue;
    const key = file.session.sessionKey;
    if (key !== root && key && positiveUsage(file.total) && file.session.role === 'subagent') {
      let children = childrenByRoot.get(root);
      if (!children) childrenByRoot.set(root, children = new Set());
      children.add(key);
      verifiedChildren.add(key);
    }
    if (!validAchievementBuckets(file.byEffort, file.total)) continue;
    for (const [effort, tokens] of Object.entries(file.byEffort)) {
      if (!positiveUsage(tokens) || !['none', 'minimal', ...SPECTRUM_EFFORTS].includes(effort)) continue;
      efforts.add(effort);
      if (SPECTRUM_EFFORTS.includes(effort as EffortTier)) effortRoots[effort as EffortTier].add(root);
      if (SPECTRUM_EFFORTS.includes(effort as EffortTier)) {
        const tier = effort as EffortTier;
        effortProcessedTokens[tier] = (effortProcessedTokens[tier] ?? 0) + tokens.inputTotal + tokens.outputTotal;
      }
    }
  }
  return {
    verifiedSubset: true,
    modelCount: models.size,
    efforts: [...efforts].sort(),
    familyProcessedTokens,
    effortProcessedTokens,
    processedLowerBound: Number.isSafeInteger(processedLowerBound) ? processedLowerBound : 0,
    familyRootCounts: {
      astra: roots.astra.size, sol: roots.sol.size, luna: roots.luna.size,
    },
    effortRootCounts: Object.fromEntries(SPECTRUM_EFFORTS.map((tier) => [tier, effortRoots[tier].size])),
    maxVerifiedAgentsPerRoot: [...childrenByRoot.values()].reduce((max, children) => Math.max(max, children.size), 0),
    maxRealModelsPerRoot: [...modelsByRoot.values()].reduce((max, rootModels) => Math.max(max, rootModels.size), 0),
    multiAgentRootCount: [...childrenByRoot.values()].filter((children) => children.size >= 3).length,
    verifiedRootCount: modelsByRoot.size,
    verifiedChildCount: verifiedChildren.size,
    multiModelRootCount: [...modelsByRoot.values()].filter((rootModels) => rootModels.size >= 2).length,
    collaboration: codexCollaborationEvidence(files),
  };
}

/** Calendar dates are already in the dashboard's configured timezone. */
export function longestActiveDayStreak(days: Iterable<string>): number {
  const dates = new Set<number>();
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const timestamp = Date.parse(`${day}T00:00:00.000Z`);
    if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day) {
      dates.add(timestamp);
    }
  }
  let longest = 0;
  let current = 0;
  let previous = -Infinity;
  for (const date of [...dates].sort((a, b) => a - b)) {
    current = date - previous === 86_400_000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
}

function safeCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 0;
}

export function evaluateAchievements(facts: AchievementFacts): AchievementResult[] {
  const combined = safeCount(facts.claudeTokens) + safeCount(facts.codexTokens);
  const diverseFamilies = (['sonnet', 'opus', 'haiku'] as const)
    .filter((family) => safeCount(facts.claudeFamilyTokens?.[family]) >= 10_000_000 &&
      safeCount(facts.claudeFamilyOutputTokens?.[family]) >= 20_000).length +
    (['astra', 'sol', 'luna'] as const)
      .filter((family) => safeCount(facts.codex.collaboration?.rainbowFamilies[family].processed) >= 10_000_000 &&
        safeCount(facts.codex.collaboration?.rainbowFamilies[family].output) >= 20_000).length +
    (safeCount(facts.fable?.processedTokens) >= 10_000_000 && safeCount(facts.fable?.outputTokens) >= 20_000 ? 1 : 0);
  const values: Record<Exclude<AchievementId,LongTermAchievementId>, number> = {
    ...achievementMoneyProgress(facts.money),
    'sonnet-main': safeCount(facts.claudeFamilyTokens?.sonnet),
    'sonnet-main-silver': safeCount(facts.claudeFamilyTokens?.sonnet),
    'sonnet-main-gold': safeCount(facts.claudeFamilyTokens?.sonnet),
    'opus-cannon': safeCount(facts.claudeFamilyTokens?.opus),
    'opus-cannon-silver': safeCount(facts.claudeFamilyTokens?.opus),
    'opus-cannon-gold': safeCount(facts.claudeFamilyTokens?.opus),
    'haiku-worker': safeCount(facts.claudeFamilyTokens?.haiku),
    'haiku-worker-silver': safeCount(facts.claudeFamilyTokens?.haiku),
    'haiku-worker-gold': safeCount(facts.claudeFamilyTokens?.haiku),
    'cache-wizard': safeCount(facts.claudeCacheReadTokens),
    'cache-wizard-silver': safeCount(facts.claudeCacheReadTokens),
    'cache-wizard-gold': safeCount(facts.claudeCacheReadTokens),
    'claude-output-bronze': safeCount(facts.claudeOutputTokens),
    'claude-output-silver': safeCount(facts.claudeOutputTokens),
    'claude-output-gold': safeCount(facts.claudeOutputTokens),
    'claude-output-sessions-bronze': safeCount(facts.claudeOutputSessions),
    'claude-output-sessions-silver': safeCount(facts.claudeOutputSessions),
    'claude-output-sessions-gold': safeCount(facts.claudeOutputSessions),
    'claude-cache-creation-bronze': safeCount(facts.claudeCacheCreationTokens),
    'claude-cache-creation-silver': safeCount(facts.claudeCacheCreationTokens),
    'claude-cache-creation-gold': safeCount(facts.claudeCacheCreationTokens),
    'fable-volume-bronze': safeCount(facts.fable?.processedTokens),
    'fable-volume-silver': safeCount(facts.fable?.processedTokens),
    'fable-volume-gold': safeCount(facts.fable?.processedTokens),
    'fable-days-bronze': safeCount(facts.calendar?.familyDays.fable),
    'fable-days-silver': safeCount(facts.calendar?.familyDays.fable),
    'fable-days-gold': safeCount(facts.calendar?.familyDays.fable),
    'fable-relay': facts.fable?.mixedFamilySession ? 1 : 0,
    'fable-sessions-bronze': safeCount(facts.fable?.outputSessions),
    'fable-sessions-silver': safeCount(facts.fable?.outputSessions),
    'fable-sessions-gold': safeCount(facts.fable?.outputSessions),
    'weekly-volume-bronze': safeCount(facts.weeklyPeakProcessed),
    'weekly-volume-silver': safeCount(facts.weeklyPeakProcessed),
    'weekly-volume-gold': safeCount(facts.weeklyPeakProcessed),
    'output-hours-bronze': safeCount(facts.outputHourStreak),
    'output-hours-silver': safeCount(facts.outputHourStreak),
    'output-hours-gold': safeCount(facts.outputHourStreak),
    'night-output-peak': facts.nightOutputPeak ? 1 : 0,
    'settings-explorer-bronze': facts.activity?.settingKeys.length ?? 0,
    'settings-explorer-silver': facts.activity?.settingKeys.length ?? 0,
    'settings-explorer-gold': facts.activity?.settingKeys.length ?? 0,
    'safe-feature-explorer': SAFE_EXPLORATION_FEATURES
      .filter((feature) => facts.activity?.features.includes(feature)).length,
    'local-share-export': facts.activity?.features.includes('localShareExport') ? 1 : 0,
    'local-advice-feedback': facts.activity?.features.includes('localAdviceFeedback') ? 1 : 0,
    'astra-regular': safeCount(facts.codex.familyProcessedTokens?.astra),
    'astra-regular-silver': safeCount(facts.codex.familyProcessedTokens?.astra),
    'astra-regular-gold': safeCount(facts.codex.familyProcessedTokens?.astra),
    'sol-regular': safeCount(facts.codex.familyProcessedTokens?.sol),
    'sol-regular-silver': safeCount(facts.codex.familyProcessedTokens?.sol),
    'sol-regular-gold': safeCount(facts.codex.familyProcessedTokens?.sol),
    'luna-regular': safeCount(facts.codex.familyProcessedTokens?.luna),
    'luna-regular-silver': safeCount(facts.codex.familyProcessedTokens?.luna),
    'luna-regular-gold': safeCount(facts.codex.familyProcessedTokens?.luna),
    'agent-standup': safeCount(facts.codex.collaboration?.teamTaskCounts[0]),
    'tiny-ai-company': safeCount(facts.codex.collaboration?.teamTaskCounts[1]),
    'agent-team-gold': safeCount(facts.codex.collaboration?.teamTaskCounts[2]),
    'agent-conductor': safeCount(facts.codex.collaboration?.orchestratedTasks),
    'agent-conductor-silver': safeCount(facts.codex.collaboration?.orchestratedTasks),
    'agent-conductor-gold': safeCount(facts.codex.collaboration?.orchestratedTasks),
    'root-portfolio-bronze': safeCount(facts.codex.verifiedRootCount),
    'root-portfolio-silver': safeCount(facts.codex.verifiedRootCount),
    'root-portfolio-gold': safeCount(facts.codex.verifiedRootCount),
    'agent-participation-bronze': safeCount(facts.codex.collaboration?.qualifiedSubagentCount),
    'agent-participation-silver': safeCount(facts.codex.collaboration?.qualifiedSubagentCount),
    'agent-participation-gold': safeCount(facts.codex.collaboration?.qualifiedSubagentCount),
    'model-relay-roots-bronze': safeCount(facts.codex.collaboration?.multiModelTasks),
    'model-relay-roots-silver': safeCount(facts.codex.collaboration?.multiModelTasks),
    'model-relay-roots-gold': safeCount(facts.codex.collaboration?.multiModelTasks),
    'multi-core-human': safeCount(facts.codex.collaboration?.modelTaskCounts[0]),
    'same-root-models-silver': safeCount(facts.codex.collaboration?.modelTaskCounts[1]),
    'same-root-models-gold': safeCount(facts.codex.collaboration?.modelTaskCounts[2]),
    'effort-explorer': safeCount(facts.codex.collaboration?.effortQualifiedTierCounts[0]),
    'effort-breadth-silver': safeCount(facts.codex.collaboration?.effortQualifiedTierCounts[1]),
    'effort-spectrum': safeCount(facts.codex.collaboration?.effortQualifiedTierCounts[2]),
    'active-day-streak': safeCount(facts.longestStreak),
    'active-day-streak-silver': safeCount(facts.longestStreak),
    'active-day-streak-gold': safeCount(facts.longestStreak),
    'active-days-bronze': safeCount(facts.activeDays),
    'active-days-silver': safeCount(facts.activeDays),
    'active-days-gold': safeCount(facts.activeDays),
    'streak-machine': safeCount(facts.longestStreak),
    'model-rainbow-bronze': diverseFamilies,
    'model-rainbow': diverseFamilies,
    'model-rainbow-gold': diverseFamilies,
    'hundred-million-club': combined,
    'billion-token-club': combined,
    'ten-billion-token-club': combined,
    'hundred-billion-token-club': combined,
    'trillion-token-club': combined,
    'codex-output-bronze': safeCount(facts.codexOutputTokens),
    'codex-output-silver': safeCount(facts.codexOutputTokens),
    'codex-output-gold': safeCount(facts.codexOutputTokens),
    'codex-cache-read-bronze': safeCount(facts.codexCachedInputTokens),
    'codex-cache-read-silver': safeCount(facts.codexCachedInputTokens),
    'codex-cache-read-gold': safeCount(facts.codexCachedInputTokens),
    'astra-days-bronze': safeCount(facts.calendar?.familyDays.astra),
    'astra-days-silver': safeCount(facts.calendar?.familyDays.astra),
    'astra-days-gold': safeCount(facts.calendar?.familyDays.astra),
    'sol-days-bronze': safeCount(facts.calendar?.familyDays.sol),
    'sol-days-silver': safeCount(facts.calendar?.familyDays.sol),
    'sol-days-gold': safeCount(facts.calendar?.familyDays.sol),
    'luna-days-bronze': safeCount(facts.calendar?.familyDays.luna),
    'luna-days-silver': safeCount(facts.calendar?.familyDays.luna),
    'luna-days-gold': safeCount(facts.calendar?.familyDays.luna),
    'sonnet-days-bronze': safeCount(facts.calendar?.familyDays.sonnet),
    'sonnet-days-silver': safeCount(facts.calendar?.familyDays.sonnet),
    'sonnet-days-gold': safeCount(facts.calendar?.familyDays.sonnet),
    'opus-days-bronze': safeCount(facts.calendar?.familyDays.opus),
    'opus-days-silver': safeCount(facts.calendar?.familyDays.opus),
    'opus-days-gold': safeCount(facts.calendar?.familyDays.opus),
    'haiku-days-bronze': safeCount(facts.calendar?.familyDays.haiku),
    'haiku-days-silver': safeCount(facts.calendar?.familyDays.haiku),
    'haiku-days-gold': safeCount(facts.calendar?.familyDays.haiku),
    'dual-provider-days-bronze': safeCount(facts.calendar?.dualProviderDays),
    'dual-provider-days-silver': safeCount(facts.calendar?.dualProviderDays),
    'dual-provider-days-gold': safeCount(facts.calendar?.dualProviderDays),
    'active-weeks-bronze': safeCount(facts.calendar?.activeWeeks),
    'active-weeks-silver': safeCount(facts.calendar?.activeWeeks),
    'active-weeks-gold': safeCount(facts.calendar?.activeWeeks),
    'weekly-average-bronze': safeCount(facts.calendar?.peakFourWeekAverage),
    'weekly-average-silver': safeCount(facts.calendar?.peakFourWeekAverage),
    'weekly-average-gold': safeCount(facts.calendar?.peakFourWeekAverage),
    'three-family-day': facts.calendar?.threeFamilyDay ? 1 : 0,
    'dual-provider-day': facts.calendar?.dualProviderDay ? 1 : 0,
  };
  return ACHIEVEMENT_DEFINITIONS.map(rule => {
    const progress = safeCount(values['baseId' in rule ? rule.baseId : rule.id]);
    return { id:rule.id, group:rule.group, target:rule.target, progress, unlocked: progress >= rule.target };
  });
}

/** Only a committed local-action delta, never hydration, proves a new plugin unlock. */
export function newlyUnlockedPluginAchievements(
  before: AchievementActivity, after: AchievementActivity,
): AchievementId[] {
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  // Reuse the actual catalog/evaluator so provenance cannot drift from targets.
  const previous = new Set(evaluateAchievements({ ...facts, activity: before })
    .filter(result => result.group === 'plugin' && result.unlocked).map(result => result.id));
  return evaluateAchievements({ ...facts, activity: after })
    .filter(result => result.group === 'plugin' && result.unlocked && !previous.has(result.id))
    .map(result => result.id);
}
