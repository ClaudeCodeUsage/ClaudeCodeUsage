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

const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
function effortTasks(processed: number, output: number, tasks: number, tiers: number): CodexFileAggregate[] {
  const share = (total: number, index: number) => Math.floor(total / tasks) + (index < total % tasks ? 1 : 0);
  return Array.from({ length: tasks }, (_, index) => {
    const input = share(processed - output, index), out = share(output, index);
    const row = aggregate(`task-${index}`, input * tiers, out * tiers);
    row.byEffort = Object.fromEntries(efforts.slice(0, tiers).map(effort => [effort,
      { inputTotal: input, outputTotal: out }]));
    return row;
  });
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

test('old input-only effort volume cannot prove joint effort breadth; qualified family volume remains independent', () => {
  const substantial = aggregate('large', 100_000_000, 1);
  substantial.byEffort = Object.fromEntries(efforts.map((effort) => [effort,
    { inputTotal: 10_000_000, outputTotal: 0 }]));
  const results = new Map(evaluateAchievements(facts([substantial])).map((row) => [row.id, row]));
  assert.equal(results.get('effort-spectrum')?.unlocked, false);
  assert.equal(results.get('effort-spectrum')?.progress, 0);
  assert.equal(results.get('model-rainbow-bronze')?.progress, 0, 'one output token is below the family output floor');
  const qualifiedFamily = evaluateAchievements(facts([aggregate('family', 9_980_000, 20_000)]))
    .find(row => row.id === 'model-rainbow-bronze')!;
  assert.equal(qualifiedFamily.progress, 1);
  assert.equal(qualifiedFamily.unlocked, false, 'bronze still requires two qualified families');
  const tiny = aggregate('tiny', 6, 0);
  tiny.byEffort = Object.fromEntries(efforts.map((effort) => [effort, { inputTotal: 1, outputTotal: 0 }]));
  assert.equal(evaluateAchievements(facts([tiny])).find((row) => row.id === 'effort-spectrum')?.unlocked, false);
});

test('effort tiers require their own processed, output and distinct-task floors at every level', () => {
  for (const [id, processed, output, tasks, tiers] of [
    ['effort-explorer', 100_000_000, 100_000, 5, 4],
    ['effort-breadth-silver', 500_000_000, 500_000, 10, 5],
    ['effort-spectrum', 2_000_000_000, 2_000_000, 30, 6],
  ] as const) {
    const read = (rows: CodexFileAggregate[]) => evaluateAchievements(facts(rows)).find(row => row.id === id)!;
    const exact = read(effortTasks(processed, output, tasks, tiers));
    assert.equal(exact.target, tiers, id);
    assert.equal(exact.progress, tiers, id);
    assert.equal(exact.unlocked, true, id);
    for (const [label, rows] of [
      ['processed', effortTasks(processed - 1, output, tasks, tiers)],
      ['output', effortTasks(processed, output - 1, tasks, tiers)],
      ['tasks', effortTasks(processed, output, tasks - 1, tiers)],
      ['breadth', effortTasks(processed, output, tasks, tiers - 1)],
    ] as const) assert.equal(read(rows).unlocked, false, `${id}: below ${label} floor`);

    const misaligned = effortTasks(processed, output, tasks, tiers);
    for (const row of misaligned) {
      const bucket = row.byEffort[efforts[tiers - 1]]!;
      row.total.inputTotal += bucket.outputTotal;
      row.total.cachedInput! += bucket.outputTotal;
      row.total.outputTotal -= bucket.outputTotal;
      row.total.reasoningOutput! -= bucket.outputTotal;
      row.byEffort[efforts[tiers - 1]] = { inputTotal: bucket.inputTotal + bucket.outputTotal, outputTotal: 0 };
    }
    assert.equal(read(misaligned).progress, tiers - 1, `${id}: peer output cannot qualify an input-only tier`);
  }
});

test('Codex rainbow families qualify only at both processed and output boundaries', () => {
  for (const [input, output, progress] of [
    [9_980_000, 20_000, 1], [9_979_999, 20_000, 0],
    [9_980_001, 19_999, 0], [10_000_000, 0, 0],
  ]) {
    const result = evaluateAchievements(facts([aggregate('family', input, output)]))
      .find(row => row.id === 'model-rainbow-bronze')!;
    assert.equal(result.progress, progress, `${input} input / ${output} output`);
    assert.equal(result.unlocked, false);
  }
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
