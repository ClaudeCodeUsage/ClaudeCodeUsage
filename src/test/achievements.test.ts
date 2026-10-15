import { test } from 'node:test';
import { LONG_TERM_ACHIEVEMENT_DEFINITIONS } from '../achievementLongTerm';
import * as assert from 'node:assert/strict';

import {
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_SERIES,
  achievementActiveDayKeys,
  claudeAchievementFamily,
  claudeSessionAchievementEvidence,
  codexModelSignals,
  evaluateAchievements,
  fableAchievementSignals,
  longestActiveDayStreak,
  notifiableAchievementIds,
  peakCalendarWeekProcessed,
  type AchievementFacts,
  type AchievementId,
} from '../achievements';
import { achievementCalendarSignals } from '../achievementCalendar';
import { codexCollaborationEvidence } from '../achievementCollaboration';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
import { emptyAchievementActivity, recordAchievementFeature, recordAchievementSettingChange } from '../achievementActivity';
import { API_ACHIEVEMENT_SERIES } from '../achievementMoneyCatalog';

const used = { inputTotal: 10, cachedInput: 3, outputTotal: 2 };
const empty = { inputTotal: 0, cachedInput: 0, outputTotal: 0 };

function currentTarget(id: AchievementId): number {
  const definition = ACHIEVEMENT_DEFINITIONS.find((row) => row.id === id);
  assert.ok(definition, `${id} must have a current rule`);
  return definition.target;
}

test('Claude session proof deduplicates IDs and requires evidenced output for Fable relay', () => {
  const row = (sessionId: string, model: string) => ({
    sessionId, data: { totalOutputTokens: 1, modelBreakdown: {
      [model]: { inputTokens: 0, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 },
    } },
  });
  assert.deepEqual(claudeSessionAchievementEvidence([
    row('same', 'claude-fable-5'), row('same', 'claude-sonnet-5'),
    row('other', 'claude-fable-5'), row('other', 'claude-fable-5'),
    row('proxy', 'proxy-fable-5'),
  ]), { outputSessions: 3, fableOutputSessions: 2, fableMixedFamilySession: true });
});

test('Claude output-session and cache-write series have rising, separately evidenced tiers', () => {
  assert.deepEqual(ACHIEVEMENT_SERIES['claude-output-sessions'].slice(0,3), [
    'claude-output-sessions-bronze', 'claude-output-sessions-silver', 'claude-output-sessions-gold',
  ]);
  assert.deepEqual(ACHIEVEMENT_SERIES['claude-cache-creation'].slice(0,3), [
    'claude-cache-creation-bronze', 'claude-cache-creation-silver', 'claude-cache-creation-gold',
  ]);
  const facts: AchievementFacts = {
    claudeTokens: 0, claudeOutputTokens: 0, claudeCacheReadTokens: 0,
    claudeCacheCreationTokens: currentTarget('claude-cache-creation-silver') - 1,
    claudeOutputSessions: currentTarget('claude-output-sessions-silver'),
    codexTokens: 0, activeDays: 0, claudeFamilies: [],
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  let results = new Map(evaluateAchievements(facts).map((row) => [row.id, row]));
  assert.equal(results.get('claude-output-sessions-silver')?.unlocked, true);
  assert.equal(results.get('claude-output-sessions-gold')?.unlocked, false);
  assert.equal(results.get('claude-cache-creation-silver')?.unlocked, false);
  facts.claudeCacheCreationTokens = currentTarget('claude-cache-creation-silver');
  results = new Map(evaluateAchievements(facts).map((row) => [row.id, row]));
  assert.equal(results.get('claude-cache-creation-silver')?.unlocked, true);
  assert.equal(results.get('claude-cache-creation-gold')?.unlocked, false);
  facts.claudeCacheCreationTokens = currentTarget('claude-cache-creation-gold') - 1;
  assert.equal(evaluateAchievements(facts).find((row) => row.id === 'claude-cache-creation-gold')?.unlocked, false);
  facts.claudeCacheCreationTokens++;
  assert.equal(evaluateAchievements(facts).find((row) => row.id === 'claude-cache-creation-gold')?.unlocked, true);
});

test('collaboration series retain their IDs but legacy maxima and marginal buckets cannot grant new tiers', () => {
  assert.deepEqual(ACHIEVEMENT_SERIES['agent-team'], ['agent-standup', 'tiny-ai-company', 'agent-team-gold']);
  assert.deepEqual(ACHIEVEMENT_SERIES['same-root-models'], ['multi-core-human', 'same-root-models-silver', 'same-root-models-gold']);
  assert.deepEqual(ACHIEVEMENT_SERIES['effort-breadth'], ['effort-explorer', 'effort-breadth-silver', 'effort-spectrum']);
  assert.deepEqual(ACHIEVEMENT_SERIES['model-rainbow'], ['model-rainbow-bronze', 'model-rainbow', 'model-rainbow-gold']);
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    claudeFamilyTokens: { sonnet: 500_000, opus: 500_000, haiku: 500_000 },
    codex: {
      modelCount: 4, efforts: [], familyRootCounts: { astra: 5, sol: 5, luna: 5 },
      familyProcessedTokens: { astra: 500_000, sol: 500_000, luna: 500_000 },
      effortProcessedTokens: { low: 10_000_000, medium: 10_000_000, high: 10_000_000, xhigh: 10_000_000, max: 10_000_000, ultra: 10_000_000 },
      maxVerifiedAgentsPerRoot: 10, maxRealModelsPerRoot: 4,
      effortRootCounts: { low: 3, medium: 3, high: 3, xhigh: 3, max: 3, ultra: 3 },
    },
  };
  const results = new Map(evaluateAchievements(facts).map((row) => [row.id, row]));
  for (const id of ['agent-team-gold', 'same-root-models-gold', 'effort-spectrum'] as const) {
    assert.equal(results.get(id)?.progress, 0, `${id}: legacy evidence is not a joint counter`);
    assert.equal(results.get(id)?.unlocked, false, id);
  }
  assert.equal(results.get('model-rainbow-gold')?.progress, 0);
  assert.equal(results.get('model-rainbow-gold')?.unlocked, false);
  facts.fable = { processedTokens: 500_000, activeDays: 0, mixedFamilySession: false,
    outputSessions: 0, allOutputSessions: 0 };
  const rainbow = evaluateAchievements(facts).find((row) => row.id === 'model-rainbow-gold');
  assert.equal(rainbow?.progress, 0, 'an old 500K Fable bucket has neither the new volume nor output proof');
  assert.equal(rainbow?.unlocked, false);
});

test('ambiguous or incomplete Codex day totals cannot grant activity streaks', () => {
  const claude = [{ day: '2026-09-01', processed: 1 }];
  const codex = Array.from({ length: 7 }, (_, index) => ({
    day: `2026-09-0${index + 1}`, processed: 500,
  }));
  assert.deepEqual([...achievementActiveDayKeys(claude, codex, false)], ['2026-09-01']);
  assert.equal(longestActiveDayStreak(achievementActiveDayKeys(claude, codex, false)), 1);
  assert.equal(longestActiveDayStreak(achievementActiveDayKeys(claude, codex, true)), 7);
});

test('every tiered family has unique known IDs, one evidence group, and rising thresholds', () => {
  const definitions = new Map(ACHIEVEMENT_DEFINITIONS.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  for (const [series, ids] of Object.entries(ACHIEVEMENT_SERIES)) {
    assert.equal(ids.length, series === 'cumulative-volume' || series === 'claude-api-week' || series === 'codex-api-week' || LONG_TERM_ACHIEVEMENT_DEFINITIONS.some(row=>row.series===series) ? 5 :
      series === 'claude-api-total' || series === 'codex-api-total' ? 4 : 3, series);
    const tiers = ids.map((id) => {
      assert.equal(seen.has(id), false, `${id} appears in two series`);
      seen.add(id);
      const tier = definitions.get(id);
      assert.ok(tier, `${id} must have a rule`);
      return tier;
    });
    assert.equal(new Set(tiers.map((tier) => tier.group)).size, 1, series);
    assert.ok(tiers.every((tier, index) => index === 0 || tiers[index - 1].target < tier.target), series);
  }
  assert.equal(Object.keys(API_ACHIEVEMENT_SERIES).length, 6);
  assert.equal(Object.keys(ACHIEVEMENT_SERIES).filter(key => !Object.hasOwnProperty.call(API_ACHIEVEMENT_SERIES, key)).length, 38);
  assert.deepEqual(Object.entries(ACHIEVEMENT_SERIES).filter(([, ids]) => ids.length === 4).map(([key]) => key).sort(),
    ['claude-api-total', 'codex-api-total']);
});

test('expanded model days, output, cache, weekly mean and single milestones have real rules', () => {
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  const available = new Map<string, number>(ACHIEVEMENT_DEFINITIONS.map(row => [row.id, row.target]));
  assert.equal(available.size, ACHIEVEMENT_DEFINITIONS.length);
  assert.equal(available.get('weekly-average-silver'), 2_000_000_000);
  assert.equal(available.get('astra-days-gold'), 120);
  const initial = new Map<string, { unlocked: boolean }>(evaluateAchievements(facts).map(row => [row.id, row]));
  assert.equal(initial.get('codex-output-bronze')?.unlocked, false);
  assert.equal(initial.get('dual-provider-day')?.unlocked, false);
});

function file(
  sessionKey: string,
  role: CodexFileAggregate['session']['role'],
  model: string,
  parentSessionKey?: string,
): CodexFileAggregate {
  return {
    total: used,
    byDay: {},
    byModel: { [model]: used },
    byEffort: { high: used },
    session: { sessionKey, role, ...(parentSessionKey ? { parentSessionKey } : {}) },
    structural: {} as CodexFileAggregate['structural'],
  };
}

/** Synthetic canonical file: the model and effort buckets agree with its total. */
function alignedFile(sessionKey: string, model: string, processed: number, output: number, effort?: string): CodexFileAggregate {
  assert.ok(Number.isSafeInteger(processed) && Number.isSafeInteger(output) && output >= 0 && processed >= output);
  const total = { inputTotal: processed - output, outputTotal: output };
  return {
    ...file(sessionKey, 'root', model), total,
    byModel: { [model]: { ...total } },
    byEffort: effort === undefined ? {} : { [effort]: { ...total } },
  };
}

/** Exact per-effort totals spread over distinct roots, every root with output. */
function effortTaskFiles(effort: string, processed: number, output: number, roots: number): CodexFileAggregate[] {
  assert.ok(roots > 0 && output >= roots);
  return Array.from({ length: roots }, (_, index) => alignedFile(
    `${effort}-task-${index}`, 'gpt-6-astra',
    index === 0 ? processed - roots + 1 : 1,
    index === 0 ? output - roots + 1 : 1, effort,
  ));
}

test('Codex model families count verified roots once, not children or orphan forks', () => {
  const files = [
    file('root-1', 'root', 'gpt-6-astra'),
    file('child-1', 'subagent', 'gpt-6-astra', 'root-1'),
    file('root-2', 'root', 'gpt-6-astra'),
    file('orphan', 'subagent', 'gpt-6-astra', 'missing'),
    file('auto', 'root', 'codex-auto-review'),
  ];
  const signals = codexModelSignals(files);
  assert.equal(signals.familyRootCounts.astra, 2);
  assert.equal(signals.modelCount, 1);
  assert.deepEqual(signals.efforts, ['high']);
  assert.equal(signals.effortRootCounts?.high, 2);
  assert.equal(signals.maxVerifiedAgentsPerRoot, 1);
});

test('Codex model signals reject cycles, zero usage, and invented family aliases', () => {
  const cycleA = file('a', 'subagent', 'gpt-6-sol', 'b');
  const cycleB = file('b', 'subagent', 'gpt-6-sol', 'a');
  const zero = file('z', 'root', 'gpt-6-luna');
  zero.byModel = { 'gpt-6-luna': empty };
  const fake = file('fake', 'root', 'custom-sol-proxy');
  const signals = codexModelSignals([cycleA, cycleB, zero, fake]);
  assert.deepEqual(signals.familyRootCounts, { astra: 0, sol: 0, luna: 0 });
  assert.equal(signals.modelCount, 0);
});

test('Codex cumulative lower bound takes one valid processed total per session', () => {
  const first = file('same', 'root', 'gpt-6-astra');
  first.total = { inputTotal: 600_000_000, outputTotal: 1 };
  const conflictingCopy = file('same', 'root', 'gpt-6-astra');
  conflictingCopy.total = { inputTotal: 400_000_000, outputTotal: 1 };
  const other = file('other', 'root', 'gpt-6-sol');
  other.total = { inputTotal: 500_000_000, outputTotal: 0 };
  const invalid = file('invalid', 'root', 'gpt-6-sol');
  invalid.total = { inputTotal: Number.NaN, outputTotal: 5 };
  assert.equal(codexModelSignals([first, conflictingCopy, other, invalid]).processedLowerBound,
    1_100_000_001);
});

test('conflicting copies of one Codex session cannot manufacture model or agent breadth', () => {
  const first = file('root', 'root', 'gpt-6-astra');
  const conflictingCopy = file('root', 'root', 'gpt-6-sol');
  const child = file('child', 'subagent', 'gpt-6-luna', 'root');
  const signals = codexModelSignals([first, conflictingCopy, child]);
  assert.equal(signals.verifiedRootCount, 0);
  assert.equal(signals.verifiedChildCount, 0);
  assert.equal(signals.multiModelRootCount, 0);
  assert.equal(signals.familyRootCounts.astra, 0);
  assert.equal(signals.familyRootCounts.sol, 0);
  assert.equal(signals.processedLowerBound, 24, 'cumulative lower bound still chooses one root copy');
});

test('achievement evaluation requires sustained usage, not first encounters', () => {
  const facts: AchievementFacts = {
    claudeTokens: 6_000_000, codexTokens: 5_000_000, activeDays: 8,
    longestStreak: 2,
    claudeFamilies: ['sonnet'], claudeFamilyTokens: { sonnet: 1_999_999, opus: 0, haiku: 0 },
    codex: {
      modelCount: 2,
      efforts: ['low', 'high'],
      effortRootCounts: { low: 1, high: 1 },
      maxVerifiedAgentsPerRoot: 2,
      familyRootCounts: { astra: 24, sol: 1, luna: 0 },
    },
  };
  const byId = new Map(evaluateAchievements(facts).map((result) => [result.id, result]));
  assert.equal(byId.get('astra-regular')?.unlocked, false);
  assert.equal(byId.get('sol-regular')?.unlocked, false);
  assert.equal(byId.get('sonnet-main')?.unlocked, false);
  assert.equal(byId.get('agent-standup')?.unlocked, false);
  assert.equal(byId.get('active-day-streak')?.unlocked, false);
  assert.equal(byId.get('effort-spectrum')?.unlocked, false);
  assert.equal(byId.get('billion-token-club')?.unlocked, false);
  assert.equal(byId.has('active-days-1' as never), false);
  facts.codex.familyRootCounts.astra = 25;
  assert.equal(evaluateAchievements(facts).find((result) => result.id === 'astra-regular')?.unlocked, false,
    'root counts alone cannot prove processed volume');
  facts.claudeFamilyTokens!.sonnet = currentTarget('sonnet-main') - 1;
  facts.codex.familyProcessedTokens = { astra: currentTarget('astra-regular') - 1, sol: 0, luna: 0 };
  const below = new Map(evaluateAchievements(facts).map((result) => [result.id, result]));
  assert.equal(below.get('sonnet-main')?.unlocked, false);
  assert.equal(below.get('astra-regular')?.unlocked, false);
  facts.claudeFamilyTokens!.sonnet++;
  facts.codex.familyProcessedTokens.astra++;
  assert.equal(new Map(evaluateAchievements(facts).map((result) => [result.id, result])).get('sonnet-main')?.unlocked, true);
  assert.equal(new Map(evaluateAchievements(facts).map((result) => [result.id, result])).get('astra-regular')?.unlocked, true);
});

test('model and cache series keep their IDs and require each calibrated Token boundary', () => {
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    claudeFamilyTokens: { sonnet: 0, opus: 0, haiku: 0 },
    claudeCacheReadTokens: 0,
    codex: {
      modelCount: 3, efforts: [],
      familyRootCounts: { astra: 25, sol: 25, luna: 25 },
      familyProcessedTokens: { astra: 0, sol: 0, luna: 0 },
    },
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  const series: Array<[string, (tokens: number) => void]> = [
    ['sonnet-main', (tokens) => { facts.claudeFamilyTokens!.sonnet = tokens; }],
    ['opus-cannon', (tokens) => { facts.claudeFamilyTokens!.opus = tokens; }],
    ['haiku-worker', (tokens) => { facts.claudeFamilyTokens!.haiku = tokens; }],
    ['cache-wizard', (tokens) => { facts.claudeCacheReadTokens = tokens; }],
    ['astra-regular', (tokens) => { facts.codex.familyProcessedTokens!.astra = tokens; }],
    ['sol-regular', (tokens) => { facts.codex.familyProcessedTokens!.sol = tokens; }],
    ['luna-regular', (tokens) => { facts.codex.familyProcessedTokens!.luna = tokens; }],
  ];
  for (const [prefix, setTokens] of series) {
    const ids = ACHIEVEMENT_SERIES[prefix];
    assert.deepEqual(ids.slice(0,3), [prefix, `${prefix}-silver`, `${prefix}-gold`]);
    for (const [index, id] of ids.entries()) {
      const target = currentTarget(id);
      setTokens(target - 1);
      assert.equal(get(id)?.progress, target - 1, `${id} counts its own Token evidence`);
      assert.equal(get(id)?.unlocked, false, `${id} immediately below target`);
      setTokens(target);
      assert.equal(get(id)?.unlocked, true, `${id} at target`);
      if (ids[index + 1]) assert.equal(get(ids[index + 1])?.unlocked, false, `${id} cannot grant the next tier`);
    }
    setTokens(0);
  }
});

test('a high-volume local sample still has meaningful gold goals ahead', () => {
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    claudeFamilyTokens: { sonnet: 100_000_000, opus: 5_900_000_000, haiku: 4_000_000 },
    claudeCacheReadTokens: 5_900_000_000,
    codex: { modelCount: 3, efforts: [], familyRootCounts: { astra: 500, sol: 500, luna: 10 },
      familyProcessedTokens: { astra: 5_000_000_000, sol: 5_000_000_000, luna: 10_000_000 } },
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  assert.equal(get('sonnet-main')?.unlocked, true);
  assert.equal(get('sonnet-main-silver')?.unlocked, false);
  assert.equal(get('sonnet-main-gold')?.unlocked, false);
  assert.equal(get('opus-cannon-silver')?.unlocked, true);
  assert.equal(get('opus-cannon-gold')?.unlocked, false);
  assert.equal(get('cache-wizard-silver')?.unlocked, true);
  assert.equal(get('cache-wizard-gold')?.unlocked, false);
  assert.equal(get('astra-regular-silver')?.unlocked, true);
  assert.equal(get('astra-regular-gold')?.unlocked, false);
  assert.equal(get('sol-regular')?.unlocked, true);
  assert.equal(get('sol-regular-silver')?.unlocked, false);
  assert.equal(get('haiku-worker')?.unlocked, false);
  assert.equal(get('luna-regular')?.unlocked, false);
});

test('long active-day streak adds later tiers without treating scattered days as consecutive', () => {
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 365, claudeFamilies: [],
    longestStreak: 14,
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  assert.equal(get('active-day-streak')?.unlocked, true);
  assert.equal(get('active-day-streak-silver')?.unlocked, false);
  facts.longestStreak = 100;
  assert.equal(get('active-day-streak-silver')?.unlocked, true);
  assert.equal(get('active-day-streak-gold')?.unlocked, true);
});

test('plugin achievements use deliberate local actions, not default settings or preview as export', () => {
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
    activity: emptyAchievementActivity(),
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  assert.equal(get('settings-explorer-bronze')?.unlocked, false);
  assert.equal(get('local-share-export')?.unlocked, false);
  for (const key of ['language', 'displayCurrency', 'timezone']) {
    facts.activity = recordAchievementSettingChange(facts.activity!, key, true);
  }
  assert.equal(get('settings-explorer-bronze')?.unlocked, true);
  facts.activity = recordAchievementFeature(facts.activity!, 'achievementGalleryViewed');
  facts.activity = recordAchievementFeature(facts.activity!, 'achievementSharePreview');
  assert.equal(get('safe-feature-explorer')?.unlocked, false);
  assert.equal(get('local-share-export')?.unlocked, false);
  facts.activity = recordAchievementFeature(facts.activity!, 'localShareExport');
  assert.equal(get('safe-feature-explorer')?.unlocked, true);
  assert.equal(get('local-share-export')?.unlocked, true);
  facts.activity = recordAchievementFeature(facts.activity!, 'localAdviceFeedback');
  assert.equal(get('local-advice-feedback')?.unlocked, true);
});

test('hourly output tiers use proven UTC streak length and night portrait needs its own evidence', () => {
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
    outputHourStreak: 23,
    nightOutputPeak: false,
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  assert.equal(get('output-hours-bronze')?.unlocked, true);
  assert.equal(get('output-hours-silver')?.unlocked, false);
  assert.equal(get('night-output-peak')?.unlocked, false);
  facts.outputHourStreak = 48;
  facts.nightOutputPeak = true;
  assert.equal(get('output-hours-gold')?.unlocked, true);
  assert.equal(get('night-output-peak')?.unlocked, true);
});

test('night and long-hour portraits never produce proactive unlock prompts', () => {
  assert.deepEqual(notifiableAchievementIds([
    'output-hours-bronze', 'output-hours-silver', 'output-hours-gold',
    'night-output-peak', 'fable-relay',
  ]), ['output-hours-bronze', 'fable-relay']);
});

test('all six effort tiers need their own 2B processed, 2M output and 30 output-bearing tasks', () => {
  const qualified = ['low', 'medium', 'high', 'xhigh', 'max'].flatMap(effort =>
    effortTaskFiles(effort, 2_000_000_000, 2_000_000, 30));
  const unknown = effortTaskFiles('unknown', 2_000_000_000, 2_000_000, 30);
  const base: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  const evaluateUltra = (processed: number, output: number, roots: number) => {
    base.codex.collaboration = codexCollaborationEvidence([
      ...qualified, ...unknown, ...effortTaskFiles('ultra', processed, output, roots),
    ]);
    return evaluateAchievements(base).find(result => result.id === 'effort-spectrum')!;
  };
  for (const [processed, output, roots] of [
    [1_999_999_999, 2_000_000, 30], [2_000_000_000, 1_999_999, 30], [2_000_000_000, 2_000_000, 29],
  ]) {
    const result = evaluateUltra(processed, output, roots);
    assert.equal(result.progress, 5, 'unknown effort cannot fill the sixth tier; other tiers cannot lend evidence to ultra');
    assert.equal(result.unlocked, false, 'all three ultra conditions are necessary');
  }
  const exact = evaluateUltra(2_000_000_000, 2_000_000, 30);
  assert.equal(exact.progress, 6);
  assert.equal(exact.unlocked, true);
});

test('streak means consecutive calendar dates, not cumulative days', () => {
  assert.equal(longestActiveDayStreak(['2026-09-01', '2026-09-03', '2026-09-04']), 2);
  assert.equal(longestActiveDayStreak(['2026-02-27', '2026-02-28', '2026-03-01']), 3);
  assert.equal(longestActiveDayStreak(['2026-09-01', '2026-09-01', 'invalid']), 1);
});

test('legacy breadth counts unique verified descendants but tiny output cannot qualify a team or model task', () => {
  const files = [
    file('root-1', 'root', 'gpt-6-astra'),
    file('child-1', 'subagent', 'gpt-6-sol', 'root-1'),
    file('child-2', 'subagent', 'gpt-6-sol', 'root-1'),
    file('child-3', 'subagent', 'gpt-6-sol', 'child-1'),
    file('orphan', 'subagent', 'gpt-6-sol', 'missing'),
  ];
  const signals = codexModelSignals(files);
  assert.equal(signals.maxVerifiedAgentsPerRoot, 3);
  assert.equal(signals.maxRealModelsPerRoot, 2);
  assert.deepEqual(signals.collaboration?.teamTaskCounts, [0, 0, 0]);
  assert.deepEqual(signals.collaboration?.modelTaskCounts, [0, 0, 0]);
  assert.equal(signals.collaboration?.qualifiedSubagentCount, 0);
});

test('one legacy multi-agent root with tiny child output is not a qualified orchestration task', () => {
  const files = [file('root', 'root', 'gpt-6-astra')];
  for (let index = 0; index < 3; index++) files.push(file(`child-${index}`, 'subagent', 'gpt-6-sol', 'root'));
  const signals = codexModelSignals(files);
  assert.equal(signals.multiAgentRootCount, 1);
  assert.equal(signals.collaboration?.orchestratedTasks, 0);
});

test('verified root portfolio keeps its count semantics while legacy orchestration counts cannot grant joint tiers', () => {
  const files = [file('root-1', 'root', 'gpt-6-astra'), file('root-2', 'root', 'gpt-6-sol')];
  for (let index = 0; index < 3; index++) files.push(file(`child-${index}`, 'subagent', 'gpt-6-sol', 'root-1'));
  files.push(file('orphan', 'subagent', 'gpt-6-sol', 'missing'));
  files.push(file('fake', 'root', 'custom-model'));
  const signals = codexModelSignals(files);
  assert.equal(signals.verifiedRootCount, 2);
  assert.equal(signals.multiAgentRootCount, 1);
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [], codex: signals,
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  assert.equal(get('root-portfolio-bronze')?.unlocked, false);
  assert.equal(get('agent-conductor')?.unlocked, false);
  facts.codex.verifiedRootCount = 250;
  facts.codex.multiAgentRootCount = currentTarget('agent-conductor-gold');
  assert.equal(get('root-portfolio-bronze')?.unlocked, true);
  assert.equal(get('root-portfolio-silver')?.unlocked, true);
  assert.equal(get('root-portfolio-gold')?.unlocked, false);
  assert.equal(get('agent-conductor')?.progress, 0, 'tiny child output does not establish a qualified team');
  assert.equal(get('agent-conductor')?.unlocked, false);
  assert.equal(get('agent-conductor-silver')?.unlocked, false, 'large legacy counts do not replace joint task proof');
  assert.equal(get('agent-conductor-gold')?.unlocked, false);
});

test('verified lineage counts without qualifying output cannot grant participation or multi-model tasks', () => {
  const files = [
    file('root-a', 'root', 'gpt-6-astra'),
    file('child-a', 'subagent', 'gpt-6-sol', 'root-a'),
    file('child-b', 'subagent', 'gpt-6-luna', 'root-a'),
    file('root-b', 'root', 'gpt-6-sol'),
    file('child-c', 'subagent', 'gpt-6-astra', 'root-b'),
    file('orphan', 'subagent', 'gpt-6-astra', 'missing'),
  ];
  const signals = codexModelSignals(files);
  assert.equal(signals.verifiedChildCount, 3);
  assert.equal(signals.multiModelRootCount, 2);
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [], codex: signals,
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  assert.equal(get('agent-participation-bronze')?.unlocked, false);
  assert.equal(get('model-relay-roots-bronze')?.unlocked, false);
  facts.codex.verifiedChildCount = currentTarget('agent-participation-gold');
  facts.codex.multiModelRootCount = currentTarget('model-relay-roots-gold');
  assert.equal(get('agent-participation-bronze')?.progress, 0);
  assert.equal(get('model-relay-roots-bronze')?.progress, 0);
  assert.equal(get('agent-participation-bronze')?.unlocked, false);
  assert.equal(get('model-relay-roots-bronze')?.unlocked, false);
  assert.equal(get('agent-participation-silver')?.unlocked, false, 'legacy child count does not prove 5K output per child');
  assert.equal(get('model-relay-roots-silver')?.unlocked, false, 'legacy model count does not prove 10K output per model');
  assert.equal(get('agent-participation-gold')?.unlocked, false);
  assert.equal(get('model-relay-roots-gold')?.unlocked, false);
});

test('Claude output and combined distinct-day accumulation have long goals', () => {
  const facts: AchievementFacts = {
    claudeTokens: 400_000_000, claudeOutputTokens: currentTarget('claude-output-bronze') - 1,
    codexTokens: 0, activeDays: 29, claudeFamilies: [],
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  assert.equal(get('claude-output-bronze')?.unlocked, false);
  assert.equal(get('active-days-bronze')?.unlocked, false);
  facts.claudeOutputTokens = currentTarget('claude-output-bronze');
  facts.activeDays = 30;
  assert.equal(get('claude-output-bronze')?.unlocked, true);
  assert.equal(get('active-days-bronze')?.unlocked, true);
  assert.equal(get('claude-output-silver')?.unlocked, false);
  for (const id of ['claude-output-silver', 'claude-output-gold'] as const) {
    facts.claudeOutputTokens = currentTarget(id) - 1;
    assert.equal(get(id)?.unlocked, false, `${id} immediately below target`);
    facts.claudeOutputTokens++;
    assert.equal(get(id)?.unlocked, true, `${id} at target`);
  }
  facts.activeDays = 365;
  assert.equal(get('claude-output-gold')?.unlocked, true);
  assert.equal(get('active-days-gold')?.unlocked, true);
});

test('cache uses actual Token volume and ordinary effort needs each tier volume, output and task breadth', () => {
  const qualified = ['low', 'medium', 'high'].flatMap(effort =>
    effortTaskFiles(effort, 100_000_000, 100_000, 5));
  const facts: AchievementFacts = {
    claudeTokens: 200_000_000, claudeCacheReadTokens: currentTarget('cache-wizard') - 1,
    codexTokens: 100_000_000, activeDays: 7, claudeFamilies: [],
    codex: {
      modelCount: 2, efforts: ['low', 'medium', 'high', 'xhigh'],
      effortRootCounts: { low: 3, medium: 3, high: 3, xhigh: 2 },
      effortProcessedTokens: { low: 10_000_000, medium: 10_000_000, high: 10_000_000, xhigh: 9_999_999 },
      familyRootCounts: { astra: 0, sol: 0, luna: 0 }, maxRealModelsPerRoot: 2,
      multiAgentRootCount: 1,
      collaboration: codexCollaborationEvidence([
        ...qualified, ...effortTaskFiles('xhigh', 99_999_999, 100_000, 5),
      ]),
    },
  };
  let results = new Map(evaluateAchievements(facts).map((result) => [result.id, result]));
  assert.equal(results.get('cache-wizard')?.unlocked, false);
  assert.equal(results.get('effort-explorer')?.progress, 3);
  assert.equal(results.get('effort-explorer')?.unlocked, false);
  assert.equal(results.get('multi-core-human')?.unlocked, false, 'old max-model count does not prove repeated model-qualified tasks');
  assert.equal(results.get('agent-conductor')?.unlocked, false);
  assert.equal(results.get('hundred-million-club')?.unlocked, true);
  facts.claudeCacheReadTokens = currentTarget('cache-wizard');
  for (const [processed, output, roots] of [[100_000_000, 99_999, 5], [100_000_000, 100_000, 4]]) {
    facts.codex.collaboration = codexCollaborationEvidence([
      ...qualified, ...effortTaskFiles('xhigh', processed, output, roots),
    ]);
    const below = evaluateAchievements(facts).find(result => result.id === 'effort-explorer')!;
    assert.equal(below.progress, 3);
    assert.equal(below.unlocked, false, 'processed volume alone cannot replace output or distinct output roots');
  }
  facts.codex.collaboration = codexCollaborationEvidence([
    ...qualified, ...effortTaskFiles('xhigh', 100_000_000, 100_000, 5),
  ]);
  results = new Map(evaluateAchievements(facts).map((result) => [result.id, result]));
  assert.equal(results.get('cache-wizard')?.unlocked, true);
  assert.equal(results.get('effort-explorer')?.progress, 4);
  assert.equal(results.get('effort-explorer')?.unlocked, true);
  assert.equal(results.get('effort-breadth-silver')?.unlocked, false);
  assert.equal(results.get('effort-spectrum')?.unlocked, false);
});

test('model rainbow requires each recognized family to have 10M processed and 20K output', () => {
  const qualified = [
    alignedFile('astra-root', 'gpt-6-astra', 10_000_000, 20_000),
    alignedFile('sol-root', 'gpt-6-sol', 10_000_000, 20_000),
  ];
  const facts: AchievementFacts = {
    claudeTokens: 20_000_001, codexTokens: 20_000_001, activeDays: 2,
    claudeFamilies: ['sonnet', 'opus', 'haiku'],
    claudeFamilyTokens: { sonnet: 10_000_000, opus: 10_000_000, haiku: 1 },
    claudeFamilyOutputTokens: { sonnet: 20_000, opus: 20_000, haiku: 1 },
    codex: {
      modelCount: 3, efforts: [],
      familyRootCounts: { astra: 5, sol: 5, luna: 1 },
      // Legacy marginals stay fixed: only the reducer's aligned joint proof
      // changes when luna crosses its processed/output conjunction below.
      familyProcessedTokens: { astra: 10_000_000, sol: 10_000_000, luna: 1 },
      collaboration: codexCollaborationEvidence([...qualified, alignedFile('luna-root', 'gpt-6-luna', 1, 1)]),
    },
  };
  const result = evaluateAchievements(facts).find((entry) => entry.id === 'model-rainbow');
  assert.equal(result?.progress, 4);
  assert.equal(result?.unlocked, false);
  for (const [processed, output] of [[9_999_999, 20_000], [10_000_000, 19_999]]) {
    facts.codex.collaboration = codexCollaborationEvidence([
      ...qualified, alignedFile('luna-root', 'gpt-6-luna', processed, output),
    ]);
    const below = evaluateAchievements(facts).find(entry => entry.id === 'model-rainbow')!;
    assert.equal(below.progress, 4);
    assert.equal(below.unlocked, false, 'other families cannot supply missing luna processed or output tokens');
  }
  facts.codex.collaboration = codexCollaborationEvidence([
    ...qualified, alignedFile('luna-root', 'gpt-6-luna', 10_000_000, 20_000),
  ]);
  assert.equal(evaluateAchievements(facts).find(entry => entry.id === 'model-rainbow')?.progress, 5);
  assert.equal(evaluateAchievements(facts).find((entry) => entry.id === 'model-rainbow')?.unlocked, true);
  for (const [processed, output] of [[9_999_999, 20_000], [10_000_000, 19_999]]) {
    facts.claudeFamilyTokens!.haiku = processed;
    facts.claudeFamilyOutputTokens!.haiku = output;
    assert.equal(evaluateAchievements(facts).find(entry => entry.id === 'model-rainbow-gold')?.progress, 5);
    assert.equal(evaluateAchievements(facts).find(entry => entry.id === 'model-rainbow-gold')?.unlocked, false);
  }
  facts.claudeFamilyTokens!.haiku = 10_000_000;
  facts.claudeFamilyOutputTokens!.haiku = 20_000;
  assert.equal(evaluateAchievements(facts).find(entry => entry.id === 'model-rainbow-gold')?.progress, 6);
  assert.equal(evaluateAchievements(facts).find((entry) => entry.id === 'model-rainbow-gold')?.unlocked, false,
    'six qualified families leave the seventh family ahead');
  facts.claudeFamilies.push('fable');
  assert.equal(evaluateAchievements(facts).find((entry) => entry.id === 'model-rainbow-gold')?.unlocked, false,
    'a family name without numeric proof cannot complete the rainbow');
  facts.fable = { processedTokens: 9_999_999, outputTokens: 20_000, activeDays: 0, mixedFamilySession: false,
    outputSessions: 0, allOutputSessions: 0 };
  assert.equal(evaluateAchievements(facts).find((entry) => entry.id === 'model-rainbow-gold')?.unlocked, false);
  facts.fable.processedTokens++;
  facts.fable.outputTokens = 19_999;
  assert.equal(evaluateAchievements(facts).find(entry => entry.id === 'model-rainbow-gold')?.progress, 6);
  assert.equal(evaluateAchievements(facts).find(entry => entry.id === 'model-rainbow-gold')?.unlocked, false,
    'Fable processed threshold alone is insufficient');
  facts.fable.outputTokens++;
  assert.equal(evaluateAchievements(facts).find(entry => entry.id === 'model-rainbow-gold')?.progress, 7);
  assert.equal(evaluateAchievements(facts).find((entry) => entry.id === 'model-rainbow-gold')?.unlocked, true);
});

test('Fable evidence requires exact model IDs, output for days, and two real families in one session', () => {
  const fable = { inputTokens: 3_000_000, outputTokens: 100, cacheCreationTokens: 1_000_000, cacheReadTokens: 6_000_000 };
  const inputOnly = { inputTokens: 10, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const other = { inputTokens: 5, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const signals = fableAchievementSignals({
    allTimeModels: {
      'claude-fable-5-1': fable,
      'claude-mythos-5-1[1m]': fable,
      'custom-fable-proxy': fable,
    },
    days: [
      { date: '2026-09-01', data: { modelBreakdown: { 'claude-fable-5-1': fable } } },
      { date: '2026-09-01', data: { modelBreakdown: { 'claude-mythos-5-1': fable } } },
      { date: '2026-09-02', data: { modelBreakdown: { 'claude-fable-5': inputOnly } } },
      { date: 'invalid', data: { modelBreakdown: { 'claude-fable-5-1': fable } } },
    ],
    sessions: [
      { data: { modelBreakdown: { 'claude-fable-5-1': fable, 'claude-sonnet-5': inputOnly } } },
      { data: { modelBreakdown: { 'claude-fable-5-1': fable, 'custom-opus-proxy': other,
        'claude-opus-5-proxy': other } } },
      { data: { modelBreakdown: { 'claude-fable-5-1': fable, 'claude-opus-5': other } } },
    ],
  });
  assert.deepEqual(signals, {
    processedTokens: 20_000_200,
    outputTokens: 200,
    activeDays: 1,
    mixedFamilySession: true,
    outputSessions: 3,
    allOutputSessions: 3,
  });
  const facts: AchievementFacts = {
    claudeTokens: 20_000_200, codexTokens: 0, activeDays: 1,
    claudeFamilies: ['fable'], claudeFamilyTokens: {},
    fable: signals,
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  const read = () => new Map(evaluateAchievements(facts).map((result) => [result.id, result]));
  const results = read();
  assert.equal(results.get('fable-volume-bronze')?.unlocked, false);
  assert.equal(results.get('fable-volume-silver')?.unlocked, false);
  assert.equal(results.get('fable-days-bronze')?.unlocked, false);
  assert.equal(results.get('fable-relay')?.unlocked, true);
  assert.equal(results.get('fable-sessions-bronze')?.unlocked, false);
  for (const id of ACHIEVEMENT_SERIES['fable-volume']) {
    facts.fable!.processedTokens = currentTarget(id) - 1;
    assert.equal(read().get(id)?.unlocked, false, `${id} immediately below target`);
    facts.fable!.processedTokens++;
    assert.equal(read().get(id)?.unlocked, true, `${id} at target`);
  }
  facts.fable!.activeDays = 120;
  assert.equal(read().get('fable-days-bronze')?.unlocked, false,
    'legacy output-only days cannot substitute current calendar proof');
  const days = Array.from({ length: currentTarget('fable-days-bronze') }, (_, index) => ({
    day: `2026-09-0${index + 1}`, processed: 1_000_000, output: 1,
    models: { 'claude-fable-5-1': { processed: 1_000_000, output: 1 } },
  }));
  const calendar = (count: number) => achievementCalendarSignals({
    claude: { complete: true, timeZone: 'UTC', days: days.slice(0, count) },
    codex: { complete: true, timeZone: 'UTC', days: [] }, asOfDay: '2026-09-28',
  });
  facts.calendar = calendar(days.length - 1);
  assert.equal(read().get('fable-days-bronze')?.progress, 6);
  assert.equal(read().get('fable-days-bronze')?.unlocked, false);
  facts.calendar = calendar(days.length);
  assert.equal(read().get('fable-days-bronze')?.progress, 7);
  assert.equal(read().get('fable-days-bronze')?.unlocked, true);
  assert.equal(fableAchievementSignals({
    allTimeModels: {}, days: [],
    sessions: [{ data: { modelBreakdown: {
      'claude-fable-5-1': fable, 'claude-opus-5-proxy': other,
    } } }],
  }).mixedFamilySession, false);
});

test('Fable session tiers count distinct output-bearing sessions only', () => {
  const fable = { inputTokens: 20, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const inputOnly = { ...fable, outputTokens: 0 };
  const signals = fableAchievementSignals({
    allTimeModels: {}, days: [],
    sessions: [
      { sessionId: 'one', data: { modelBreakdown: { 'claude-fable-5': fable } } },
      { sessionId: 'one', data: { modelBreakdown: { 'claude-fable-5-1': fable } } },
      { sessionId: 'two', data: { modelBreakdown: { 'claude-fable-5-1': inputOnly } } },
      { sessionId: 'three', data: { modelBreakdown: { 'custom-fable-proxy': fable } } },
    ],
  });
  assert.equal(signals.outputSessions, 1);
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [], fable: signals,
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  const get = (id: string) => new Map(evaluateAchievements(facts).map((row) => [row.id, row])).get(id as never);
  assert.equal(get('fable-sessions-bronze')?.unlocked, false);
  facts.fable!.outputSessions = 10;
  assert.equal(get('fable-sessions-bronze')?.unlocked, true);
  assert.equal(get('fable-sessions-silver')?.unlocked, false);
  facts.fable!.outputSessions = 1_000;
  assert.equal(get('fable-sessions-gold')?.unlocked, true);
});

test('Claude family awards accept exact known model IDs, not proxy substrings or invented Fable suffixes', () => {
  assert.equal(claudeAchievementFamily('claude-sonnet-5'), 'sonnet');
  assert.equal(claudeAchievementFamily('claude-opus-4-1'), 'opus');
  assert.equal(claudeAchievementFamily('claude-fable-5'), 'fable');
  assert.equal(claudeAchievementFamily('claude-fable-5-1'), 'fable');
  assert.equal(claudeAchievementFamily('us.anthropic.claude-fable-5'), 'fable');
  assert.equal(claudeAchievementFamily('global.anthropic.claude-fable-5-1'), 'fable');
  for (const model of ['custom-sonnet-proxy', 'claude-opus-5-proxy',
    'claude-fable-5-20990101-v99:99', 'claude-mythos-5-20301231',
    'xx.anthropic.claude-fable-5']) {
    assert.equal(claudeAchievementFamily(model), null, model);
  }
});

test('calendar-week peak combines provider days once and rejects incomplete coverage', () => {
  const rows = [
    { day: '2026-12-28', processed: 200_000_000 },
    { day: '2026-12-31', processed: 200_000_000 },
    { day: '2027-01-01', processed: 150_000_000 },
    { day: '2027-01-01', processed: 150_000_000 },
    { day: '2027-01-04', processed: 999_000_000 },
    { day: 'invalid', processed: 10_000_000_000 },
    { day: '2027-01-05', processed: -1 },
  ];
  assert.equal(peakCalendarWeekProcessed(rows, true), 999_000_000);
  assert.equal(peakCalendarWeekProcessed(rows, false), 0);
  const facts: AchievementFacts = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    weeklyPeakProcessed: peakCalendarWeekProcessed(rows, true),
    codex: { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 } },
  };
  const grants = new Map(evaluateAchievements(facts).map((result) => [result.id, result]));
  assert.equal(grants.get('weekly-volume-bronze')?.unlocked, true);
  assert.equal(grants.get('weekly-volume-silver')?.unlocked, false);
  assert.equal(grants.get('weekly-volume-gold')?.unlocked, false);
});
