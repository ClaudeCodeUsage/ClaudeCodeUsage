import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { claudeAchievementFamily, claudeSessionAchievementEvidence, codexModelSignals,
  evaluateAchievements } from '../achievements';
import { normalizeCodexAchievementModel } from '../achievementModels';
import { getAchievementMoneyPricebook, normalizeAchievementMoneyModel } from '../achievementMoney';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';

function modelFile(byModel: CodexFileAggregate['byModel']): CodexFileAggregate {
  const total = Object.values(byModel).reduce((sum, tokens) => ({
    inputTotal: sum.inputTotal + tokens.inputTotal, outputTotal: sum.outputTotal + tokens.outputTotal,
  }), { inputTotal: 0, outputTotal: 0 });
  return { session: { sessionKey: 'root', role: 'root' }, total, byModel, byEffort: {}, byDay: {},
    structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } };
}

test('family signals admit native OpenAI aliases and merge their model identity', () => {
  for (const [model, family] of [['gpt-6-sol', 'sol'], ['gpt-6.1-astra', 'astra'],
    ['gpt-6-luna-2026-09-01', 'luna']] as const) {
    const signals = codexModelSignals([modelFile({
      [model]: { inputTotal: 10_000, outputTotal: 5_000 },
      [`openai/${model}`]: { inputTotal: 20_000, outputTotal: 5_000 },
    })]);
    assert.equal(signals.modelCount, 1, model);
    assert.equal(signals.maxRealModelsPerRoot, 1, model);
    assert.equal(signals.familyRootCounts[family], 1, model);
    assert.equal(signals.familyProcessedTokens?.[family], 40_000, model);
    assert.deepEqual(signals.collaboration?.rainbowFamilies[family], { processed: 40_000, output: 10_000 });
  }
});

test('family signals reject custom and dangling named labels without discarding observed total volume', () => {
  for (const model of ['gpt-6-sol-custom', 'gpt-6-sol-', 'gpt-6-sol-2026-09-01-custom',
    'openai/gpt-6-sol-custom', 'proxy/gpt-6-sol', 'gpt-6-custom']) {
    const signals = codexModelSignals([modelFile({ [model]: { inputTotal: 10_000_000, outputTotal: 20_000 } })]);
    assert.equal(signals.modelCount, 0, model);
    assert.equal(signals.verifiedRootCount, 0, model);
    assert.deepEqual(signals.familyRootCounts, { astra: 0, sol: 0, luna: 0 }, model);
    assert.deepEqual(signals.familyProcessedTokens, { astra: 0, sol: 0, luna: 0 }, model);
    assert.equal(signals.processedLowerBound, 10_020_000, 'unclassified tokens still belong to total volume');
  }
});

test('all existing OpenAI money aliases retain their original collaboration identities', () => {
  const book = getAchievementMoneyPricebook('openai');
  for (const [alias, model] of Object.entries(book.aliases)) {
    if (!Object.prototype.hasOwnProperty.call(book.prices, model)) continue;
    assert.equal(normalizeCodexAchievementModel(alias), normalizeAchievementMoneyModel(alias), alias);
    assert.equal(codexModelSignals([modelFile({ [alias]: { inputTotal: 10, outputTotal: 1 } })]).modelCount, 1, alias);
  }
});

test('new named models retain exact generations/snapshots and reject arbitrary suffixes', () => {
  for (const model of ['gpt-6.2-sol', 'gpt-6.1-astra', 'gpt-99-luna', 'gpt-6.2-terra',
    'gpt-6-sol-2026-09-01', 'gpt-6-sol-20260901']) {
    assert.equal(normalizeCodexAchievementModel(model), model);
    assert.equal(normalizeCodexAchievementModel(`openai/${model}`), model);
  }
  for (const model of ['unknown', 'proxy/gpt-6.2-sol', 'openrouter/gpt-6-sol',
    'openai/openai/gpt-6-sol', 'gpt-6-sol-custom', 'gpt-6-sol-2026-09-01-proxy',
    'gpt-6-sol-2026-09', 'gpt-6-sol-2026090', 'gpt-6-newfamily',
    'gpt-6-sol[1m]', 'gpt-6.2', 'o99', '__proto__', 'constructor']) {
    assert.equal(normalizeCodexAchievementModel(model), null, model);
  }
  assert.equal(normalizeCodexAchievementModel(' GPT-6-SOL '), 'gpt-6-sol');
  assert.equal(normalizeCodexAchievementModel(' OpenAI/GPT-6.1-ASTRA '), 'gpt-6.1-astra');
});

test('unpriced named family evidence agrees with existing volume and rainbow qualifications', () => {
  const file = (sessionKey: string, model: string, inputTotal: number, outputTotal: number): CodexFileAggregate => ({
    session: { sessionKey, role: 'root' }, total: { inputTotal, outputTotal },
    byModel: { [model]: { inputTotal, outputTotal } }, byEffort: {}, byDay: {},
    structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 },
  });
  for (const output of [19_999, 20_000]) {
    const codex = codexModelSignals([
      file('astra', 'gpt-6.1-astra', 10_000_000 - output, output),
      file('sol', 'gpt-6.2-sol-2026-09-01', 9_980_000, 20_000),
    ]);
    assert.equal(codex.familyProcessedTokens?.astra, 10_000_000);
    assert.equal(codex.familyProcessedTokens?.sol, 10_000_000);
    assert.deepEqual(codex.collaboration?.rainbowFamilies.astra, { processed: 10_000_000, output });
    const result = evaluateAchievements({ claudeTokens: 0, codexTokens: 20_000_000,
      activeDays: 0, claudeFamilies: [], codex });
    assert.equal(result.find(row => row.id === 'model-rainbow-bronze')?.unlocked, output === 20_000);
  }
});

test('Claude families use the same explicit regional prefixes as Fable and existing pricing', () => {
  for (const prefix of ['', 'global', 'us', 'eu', 'jp', 'apac', 'in']) {
    const namespace = prefix ? `${prefix}.anthropic.` : '';
    for (const family of ['sonnet', 'opus', 'haiku'] as const) {
      assert.equal(claudeAchievementFamily(`${namespace}claude-${family}-4-5-20250929-v1:0`), family);
    }
    assert.equal(claudeAchievementFamily(`${namespace}claude-fable-5-1`), 'fable');
    assert.equal(claudeAchievementFamily(`${namespace}claude-mythos-5[1m]`), 'fable');
  }
  assert.equal(claudeAchievementFamily('apac.anthropic.claude-sonnet-4-20250514-v1:0'), 'sonnet');
  assert.equal(claudeAchievementFamily(' CLAUDE-OPUS-5-5 '), 'opus');
});

test('Claude family recognition rejects unknown prefixes and proxy/custom labels', () => {
  for (const label of ['xx', 'zz', 'custom', 'proxy', 'global.us']) {
    for (const family of ['sonnet-4-5', 'opus-5-5', 'haiku-4-5', 'fable-5', 'mythos-5']) {
      const model = `${label}.anthropic.claude-${family}`;
      assert.equal(claudeAchievementFamily(model), null, model);
    }
  }
  for (const model of ['proxy/claude-sonnet-5', 'claude-opus-5-proxy', 'claude-fable-5-custom',
    'claude-mythos-5-20301231', 'claude-fable-5-20990101-v99:99']) {
    assert.equal(claudeAchievementFamily(model), null, model);
  }
});

test('regional Claude labels retain output-qualified Fable relay evidence', () => {
  const row = (model: string, outputTokens: number) => ({ sessionId: 'same', data: {
    totalOutputTokens: outputTokens, modelBreakdown: { [model]: {
      inputTokens: 10_000, outputTokens, cacheCreationTokens: 0, cacheReadTokens: 0,
    } },
  } });
  const fable = row('global.anthropic.claude-fable-5-1', 1);
  const other = row('apac.anthropic.claude-sonnet-4-20250514-v1:0', 1);
  assert.deepEqual(claudeSessionAchievementEvidence([fable, other]), {
    outputSessions: 1, fableOutputSessions: 1, fableMixedFamilySession: true,
  });
  for (const invalid of [row('xx.anthropic.claude-sonnet-4-5', 100_000),
    row('apac.anthropic.claude-sonnet-4-5', 0)]) {
    assert.equal(claudeSessionAchievementEvidence([fable, invalid]).fableMixedFamilySession, false);
  }
});
