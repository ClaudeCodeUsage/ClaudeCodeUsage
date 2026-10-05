import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, codexModelSignals, evaluateAchievements,
  type AchievementFacts,
} from '../achievements';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';

function aggregate(key: string, input: number, output: number): CodexFileAggregate {
  const tokens = { inputTotal: input, cachedInput: input, outputTotal: output, reasoningOutput: output };
  return {
    session: { sessionKey: key, role: 'root' }, total: tokens,
    byModel: { 'gpt-6-astra': tokens }, byEffort: { high: tokens }, byDay: {},
    structural: {} as CodexFileAggregate['structural'],
  };
}

function facts(files: CodexFileAggregate[]): AchievementFacts {
  return { claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [], codex: codexModelSignals(files) };
}

test('Codex family progress is processed Token volume, not roots or cached/reasoning subsets', () => {
  const result = evaluateAchievements(facts([aggregate('one', 499_000_000, 1_000_000)]))
    .find((row) => row.id === 'astra-regular')!;
  assert.equal(result.target, 500_000_000);
  assert.equal(result.progress, 500_000_000);
  assert.equal(result.unlocked, true, 'one substantial session is sufficient for Token proof');
  assert.equal(evaluateAchievements(facts([aggregate('below', 498_999_999, 1_000_000)]))
    .find(row => row.id === 'astra-regular')?.unlocked, false);
  const manyTinyRoots = evaluateAchievements(facts(Array.from({ length: 250 }, (_, i) => aggregate(`r${i}`, 1, 1))))
    .find((row) => row.id === 'astra-regular')!;
  assert.equal(manyTinyRoots.progress, 500);
  assert.equal(manyTinyRoots.unlocked, false);
});

test('Codex effort breadth and model rainbow require substantive Tokens, not root counts', () => {
  const substantial = aggregate('large', 100_000_000, 1);
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  substantial.byEffort = Object.fromEntries(efforts.map((effort) => [effort,
    { inputTotal: 10_000_000, outputTotal: 0 }]));
  const results = new Map(evaluateAchievements(facts([substantial])).map((row) => [row.id, row]));
  assert.equal(results.get('effort-spectrum')?.unlocked, true);
  assert.equal(results.get('model-rainbow-bronze')?.progress, 1);
  const tiny = aggregate('tiny', 6, 0);
  tiny.byEffort = Object.fromEntries(efforts.map((effort) => [effort, { inputTotal: 1, outputTotal: 0 }]));
  assert.equal(evaluateAchievements(facts([tiny])).find((row) => row.id === 'effort-spectrum')?.unlocked, false);
});

test('duplicate session identities and invalid bucket totals do not manufacture family Token progress', () => {
  const first = aggregate('same', 100_000_000, 0);
  const copy = aggregate('same', 200_000_000, 0);
  const corrupt = aggregate('bad', 1, 0);
  corrupt.byModel = { 'gpt-6-astra': { inputTotal: 10_000_000_000, outputTotal: 0 } };
  const result = evaluateAchievements(facts([first, copy, corrupt])).find((row) => row.id === 'astra-regular')!;
  assert.equal(result.progress, 0);
});

test('cumulative Token gallery is one five-level series beginning at 100M', () => {
  assert.deepEqual(ACHIEVEMENT_SERIES['cumulative-volume'], [
    'hundred-million-club', 'billion-token-club', 'ten-billion-token-club',
    'hundred-billion-token-club', 'trillion-token-club',
  ]);
  assert.equal(ACHIEVEMENT_DEFINITIONS.some((row) => String(row.id) === 'ten-million-club'), false);
  const series = ACHIEVEMENT_SERIES['cumulative-volume'];
  assert.deepEqual(series.map((id) => ACHIEVEMENT_DEFINITIONS.find((row) => row.id === id)?.target),
    [100_000_000, 1_000_000_000, 10_000_000_000, 100_000_000_000, 1_000_000_000_000]);
});

test('invalid model buckets cannot prove structural awards even with valid session ancestry', () => {
  for (const input of [-1, 0.5, 1_000_000_000]) {
    const root = aggregate('root', 100, 100);
    root.byModel = {
      'gpt-6-astra': { inputTotal: input, outputTotal: 2 },
      'gpt-6-sol': { inputTotal: 0, outputTotal: 1 },
    };
    const child = aggregate('child', 100, 100);
    child.session = { sessionKey: 'child', role: 'subagent', parentSessionKey: 'root' };
    child.byModel = root.byModel;
    const signals = codexModelSignals([root, child]);
    assert.equal(signals.modelCount, 0, `invalid input ${input}`);
    assert.equal(signals.verifiedRootCount, 0);
    assert.equal(signals.verifiedChildCount, 0);
    assert.equal(signals.maxVerifiedAgentsPerRoot, 0);
    assert.equal(signals.maxRealModelsPerRoot, 0);
    assert.equal(signals.multiModelRootCount, 0);
    assert.deepEqual(signals.efforts, []);
  }
});

test('invalid effort buckets cannot prove effort history while valid model evidence survives', () => {
  for (const input of [-1, 0.5, 1_000_000_000]) {
    const root = aggregate('root', 100_000_000, 100);
    root.byEffort = { high: { inputTotal: input, outputTotal: 2 } };
    const signals = codexModelSignals([root]);
    assert.equal(signals.familyProcessedTokens?.astra, 100_000_100);
    assert.equal(signals.verifiedRootCount, 1);
    assert.deepEqual(signals.efforts, [], `invalid input ${input}`);
    assert.equal(signals.effortRootCounts?.high, 0);
    assert.equal(signals.effortProcessedTokens?.high ?? 0, 0);
  }
});
