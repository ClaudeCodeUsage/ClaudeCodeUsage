import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { codexCollaborationEvidence } from '../achievementCollaboration';
import { priceAchievementModelBucket } from '../achievementMoney';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
import type { ProviderTokenCounts } from '../providers/providerTypes';

const tokens = (inputTotal = 0, outputTotal = 0): ProviderTokenCounts => ({ inputTotal, outputTotal });
const models = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'];
const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
function file(key: string, byModel: Record<string, ProviderTokenCounts> = { 'gpt-6.1-sol': tokens(0, 1) },
  parent?: string, role: CodexFileAggregate['session']['role'] = parent === undefined ? 'root' : 'subagent',
): CodexFileAggregate {
  const total = Object.values(byModel).reduce((sum, row) => tokens(
    sum.inputTotal + row.inputTotal, sum.outputTotal + row.outputTotal), tokens());
  return { session: { sessionKey: key, role, ...(parent === undefined ? {} : { parentSessionKey: parent }) },
    total, byModel, byEffort: {}, byDay: {},
    structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } };
}
function team(key: string, members: number, output: number): CodexFileAggregate[] {
  return [file(key), ...Array.from({ length: members }, (_, i) =>
    file(`${key}-child-${i}`, { 'gpt-6.1-sol': tokens(0, output) }, key))];
}
function modelTask(key: string, count: number, output: number): CodexFileAggregate[] {
  return [file(key, Object.fromEntries(models.slice(0, count).map(model => [model, tokens(0, output)])))];
}
function effortTasks(prefix: string, roots: number, processed: number, output: number): CodexFileAggregate[] {
  return Array.from({ length: roots }, (_, i) => {
    const bucket = i ? tokens(0, 1) : tokens(processed - output, output - roots + 1);
    const row = file(`${prefix}-${i}`, { 'gpt-6-astra': tokens(bucket.inputTotal * 6, bucket.outputTotal * 6) });
    row.byEffort = Object.fromEntries(efforts.map(effort => [effort, { ...bucket }]));
    return row;
  });
}

test('empty evidence has a fixed numeric DTO and no identity or labels', () => {
  assert.deepEqual(codexCollaborationEvidence([]), {
    teamTaskCounts: [0, 0, 0], orchestratedTasks: 0, qualifiedSubagentCount: 0,
    modelTaskCounts: [0, 0, 0], multiModelTasks: 0, effortQualifiedTierCounts: [0, 0, 0],
    rainbowFamilies: { astra: { processed: 0, output: 0 }, sol: { processed: 0, output: 0 },
      luna: { processed: 0, output: 0 } },
  });
});

test('one enormous tree is one task and cannot prove repeat-task gold', () => {
  const result = codexCollaborationEvidence(team('private-root', 100, 1_000_000));
  assert.deepEqual(result.teamTaskCounts, [1, 1, 1]);
  assert.equal(result.orchestratedTasks, 1);
  assert.equal(result.qualifiedSubagentCount, 100);
  assert.ok(result.teamTaskCounts[2] < 50);
  assert.ok(!JSON.stringify(result).includes('private-root'));
});

test('distinct eligible tasks preserve every repeated team threshold exactly', () => {
  for (const count of [4, 5, 19, 20, 49, 50, 199, 200]) {
    const result = codexCollaborationEvidence(Array.from({ length: count }, (_, i) => team(`root-${i}`, 8, 20_000)).flat());
    assert.deepEqual(result.teamTaskCounts, [count, count, count]);
    assert.equal(result.orchestratedTasks, count);
    assert.equal(result.qualifiedSubagentCount, count * 8);
  }
});

test('team member and output boundaries are inclusive at all three levels', () => {
  for (const [members, output, expected] of [
    [2, 5_000, [0, 0, 0]], [3, 4_999, [0, 0, 0]], [3, 5_000, [1, 0, 0]],
    [4, 10_000, [1, 0, 0]], [5, 9_999, [1, 0, 0]], [5, 10_000, [1, 1, 0]],
    [7, 20_000, [1, 1, 0]], [8, 19_999, [1, 1, 0]], [8, 20_000, [1, 1, 1]],
  ] as const) assert.deepEqual(codexCollaborationEvidence(team('root', members, output)).teamTaskCounts, expected);
});

test('member output cannot be borrowed from another member or an unknown model', () => {
  const rows = team('root', 3, 4_999);
  rows.push(file('huge', { 'gpt-6-astra': tokens(0, 1_000_000) }, 'root'));
  rows.push(file('unknown-output', { 'gpt-6-sol': tokens(100_000, 0), unknown: tokens(0, 50_000) }, 'root'));
  rows.push(file('input-only', { 'gpt-6-astra': tokens(1_000_000, 0) }, 'root'));
  const result = codexCollaborationEvidence(rows);
  assert.deepEqual(result.teamTaskCounts, [0, 0, 0]);
  assert.equal(result.qualifiedSubagentCount, 1);
});

test('teams require root output and deeply nested members still belong to one root', () => {
  const rows = team('root', 3, 5_000);
  rows[2].session.parentSessionKey = rows[1].session.sessionKey;
  rows[3].session.parentSessionKey = rows[2].session.sessionKey;
  assert.deepEqual(codexCollaborationEvidence(rows.reverse()).teamTaskCounts, [1, 0, 0]);
  const silent = file('root', { 'gpt-6-astra': tokens(1_000_000, 0) });
  const result = codexCollaborationEvidence([silent, ...rows.filter(row => row.session.role !== 'root')]);
  assert.deepEqual(result.teamTaskCounts, [0, 0, 0]);
  assert.equal(result.qualifiedSubagentCount, 3);
});

test('model task count and per-model output boundaries remain aligned', () => {
  for (const [count, output, expected] of [
    [1, 1_000_000, [0, 0, 0]], [2, 9_999, [0, 0, 0]], [2, 10_000, [1, 0, 0]],
    [2, 20_000, [1, 0, 0]], [3, 19_999, [1, 0, 0]], [3, 20_000, [1, 1, 0]],
    [3, 50_000, [1, 1, 0]], [4, 49_999, [1, 1, 0]], [4, 50_000, [1, 1, 1]],
  ] as const) {
    const result = codexCollaborationEvidence(modelTask('root', count, output));
    assert.deepEqual(result.modelTaskCounts, expected);
    assert.equal(result.multiModelTasks, expected[0]);
  }
  for (const count of [2, 3, 9, 10, 29, 30, 99, 100, 999, 1_000]) {
    assert.deepEqual(codexCollaborationEvidence(Array.from({ length: count }, (_, i) =>
      modelTask(`root-${i}`, 4, 50_000)).flat()).modelTaskCounts, [count, count, count]);
  }
});

test('model output pools across members of the same task but never across tasks or models', () => {
  const rows = [file('root', { 'gpt-6-astra': tokens(0, 9_999) }),
    file('child', { 'gpt-6-astra': tokens(0, 1), 'gpt-6-sol': tokens(0, 10_000) }, 'root')];
  assert.deepEqual(codexCollaborationEvidence(rows).modelTaskCounts, [1, 0, 0]);
  assert.equal(codexCollaborationEvidence([
    file('a', { 'gpt-6-astra': tokens(0, 1_000_000), 'gpt-6-sol': tokens(0, 9_999) }),
    file('b', { 'gpt-6-sol': tokens(0, 1_000_000), 'gpt-6-astra': tokens(0, 9_999) }),
  ]).multiModelTasks, 0);
});

test('explicit aliases merge outputs while genuine generations and o-series remain distinct', () => {
  const aliases = file('root', { 'gpt-6-sol': tokens(0, 5_000), 'openai/gpt-6-sol': tokens(0, 5_000) });
  assert.equal(codexCollaborationEvidence([aliases]).multiModelTasks, 0);
  const child = file('child', { 'gpt-6.1-sol': tokens(0, 10_000) }, 'root');
  assert.equal(codexCollaborationEvidence([aliases, child]).multiModelTasks, 1);
  assert.equal(codexCollaborationEvidence([file('o-series', { o3: tokens(0, 10_000),
    'openai/o4-mini': tokens(0, 10_000) })]).multiModelTasks, 1);
  const member = file('member', aliases.byModel, 'root');
  assert.equal(codexCollaborationEvidence([file('root'), member]).qualifiedSubagentCount, 1);
});

test('strict unpriced family labels still qualify team, model and rainbow output', () => {
  for (const model of ['gpt-6.2-sol', 'gpt-6.1-astra', 'gpt-6-luna-2026-09-01', 'gpt-6-sol-20260901']) {
    const rows = [file('root', { [model]: tokens(10_000, 10_000) }),
      ...Array.from({ length: 3 }, (_, i) => file(`child-${i}`, { [model]: tokens(0, 5_000) }, 'root'))];
    const result = codexCollaborationEvidence(rows);
    assert.deepEqual(result.teamTaskCounts, [1, 0, 0], model);
    assert.equal(result.qualifiedSubagentCount, 3, model);
    assert.deepEqual(result.modelTaskCounts, [0, 0, 0], 'one shared model is not two models');
    const family = model.includes('-astra') ? 'astra' : model.includes('-luna') ? 'luna' : 'sol';
    assert.deepEqual(result.rainbowFamilies[family], { processed: 35_000, output: 25_000 }, model);
    const money = priceAchievementModelBucket({ provider: 'codex', model, tokens: rows[0].total }, 'anthropic');
    assert.equal(money.pricedTokens, 0, model);
    assert.equal(money.microUsd, null, model);
  }
  const root = file('mixed', { 'gpt-6.2-sol': tokens(0, 10_000), 'gpt-6.1-astra': tokens(0, 10_000) });
  assert.deepEqual(codexCollaborationEvidence([root]).modelTaskCounts, [1, 0, 0]);
});

test('unpriced recognized labels retain inclusive per-member and per-model output thresholds', () => {
  for (const output of [4_999, 5_000]) {
    const rows = [file('root'), ...Array.from({ length: 3 }, (_, i) =>
      file(`child-${i}`, { 'gpt-6.2-sol': tokens(1_000_000, output) }, 'root'))];
    assert.equal(codexCollaborationEvidence(rows).qualifiedSubagentCount, output === 5_000 ? 3 : 0);
    assert.deepEqual(codexCollaborationEvidence(rows).teamTaskCounts, output === 5_000 ? [1, 0, 0] : [0, 0, 0]);
  }
  for (const output of [9_999, 10_000]) {
    const row = file('root', { 'gpt-6.2-sol': tokens(1_000_000, output), 'gpt-6.1-astra': tokens(0, 10_000) });
    assert.equal(codexCollaborationEvidence([row]).multiModelTasks, output === 10_000 ? 1 : 0);
  }
  const silent = file('root', { 'gpt-6.2-sol': tokens(10_000_000, 0) });
  assert.deepEqual(codexCollaborationEvidence([silent]).rainbowFamilies.sol, { processed: 10_000_000, output: 0 });
  assert.equal(codexCollaborationEvidence([silent]).multiModelTasks, 0);
});

test('unknown, custom and non-OpenAI labels cannot prove explicit models or rainbow', () => {
  const row = file('root', Object.fromEntries(['unknown', 'gpt-99-custom', 'my-gpt-6-astra',
    'gpt-6-sol-custom', ' GPT-6-SOL-CUSTOM ', 'claude-opus-5-5', 'anthropic/claude-fable-5',
    '__proto__', 'constructor'].map(model => [model, tokens(0, 100_000)])));
  assert.equal(codexCollaborationEvidence([row]).multiModelTasks, 0);
  assert.deepEqual(codexCollaborationEvidence([row]).rainbowFamilies,
    codexCollaborationEvidence([]).rainbowFamilies);
});

test('APR contributes to none of team, model, effort or rainbow proof', () => {
  const rows = team('root', 2, 5_000);
  const apr = file('apr', { 'gpt-6-astra': tokens(10_000_000_000, 20_000_000) }, 'root', 'approval-reviewer');
  apr.byEffort = { max: { ...apr.total } };
  const before = codexCollaborationEvidence(rows);
  assert.deepEqual(codexCollaborationEvidence([...rows, apr]), before);
  const effortRows = effortTasks('effort', 5, 100_000_000, 100_000);
  for (const row of effortRows) row.session = { ...row.session, role: 'approval-reviewer', parentSessionKey: 'root' };
  assert.deepEqual(codexCollaborationEvidence([...rows, ...effortRows]), before);
});

test('one high-volume effort task cannot establish task breadth', () => {
  const rows = effortTasks('root', 1, 20_000_000_000, 20_000_000);
  assert.deepEqual(codexCollaborationEvidence(rows).effortQualifiedTierCounts, [0, 0, 0]);
  for (let i = 0; i < 40; i++) {
    const child = file(`child-${i}`, { 'gpt-6-astra': tokens(0, 6) }, 'root-0');
    child.byEffort = Object.fromEntries(efforts.map(effort => [effort, tokens(0, 1)]));
    rows.push(child);
  }
  assert.deepEqual(codexCollaborationEvidence(rows).effortQualifiedTierCounts, [0, 0, 0]);
});

test('effort volume, own output and distinct output roots all meet inclusive thresholds', () => {
  const levels = [[5, 100_000_000, 100_000], [10, 500_000_000, 500_000], [30, 2_000_000_000, 2_000_000]];
  for (let level = 0; level < levels.length; level++) {
    const [roots, processed, output] = levels[level];
    const exact = codexCollaborationEvidence(effortTasks('exact', roots, processed, output));
    assert.deepEqual(exact.effortQualifiedTierCounts, levels.map((_, i) => i <= level ? 6 : 0));
    for (const [r, p, o] of [[roots - 1, processed, output], [roots, processed - 1, output], [roots, processed, output - 1]]) {
      assert.equal(codexCollaborationEvidence(effortTasks('below', r, p, o)).effortQualifiedTierCounts[level], 0);
    }
  }
});

test('effort buckets cannot borrow global output or another effort output/task count', () => {
  const rows = Array.from({ length: 5 }, (_, i) => {
    const row = file(`root-${i}`, { 'gpt-6-astra': tokens(100_000_000, 100_000) });
    row.byEffort = { low: tokens(50_000_000, 0), medium: tokens(0, 100_000),
      none: tokens(0, 0), minimal: tokens(0, 0), invented: tokens(0, 0) };
    return row;
  });
  assert.deepEqual(codexCollaborationEvidence(rows).effortQualifiedTierCounts, [0, 0, 0]);
  for (let i = 1; i < rows.length; i++) rows[i].byEffort = { low: tokens(50_000_000, 0) };
  rows[0].byEffort.low.outputTotal = 100_000;
  delete rows[0].byEffort.medium;
  assert.deepEqual(codexCollaborationEvidence(rows).effortQualifiedTierCounts, [0, 0, 0]);
});

test('effort proof pools the same root and tier before excluding input-only tasks', () => {
  const effortRow = (key: string, input: number, output: number, parent?: string, tier = 'low') => {
    const row = file(key, { 'gpt-6-astra': tokens(input, output) }, parent);
    row.byEffort = { [tier]: tokens(input, output) };
    return row;
  };
  const otherRoots = Array.from({ length: 4 }, (_, i) => effortRow(`other-${i}`, 0, 1));
  const combined = [effortRow('root', 99_900_000, 99_996), ...otherRoots];
  const split = [effortRow('root', 99_900_000, 0),
    effortRow('child', 0, 99_996, 'root'), ...otherRoots];
  assert.deepEqual(codexCollaborationEvidence(combined).effortQualifiedTierCounts, [1, 0, 0]);
  assert.deepEqual(codexCollaborationEvidence(split).effortQualifiedTierCounts, [1, 0, 0]);
  assert.deepEqual(codexCollaborationEvidence(split.reverse()).effortQualifiedTierCounts, [1, 0, 0]);
  // Neither an unrelated root nor a different tier may lend its input volume.
  assert.deepEqual(codexCollaborationEvidence([
    effortRow('silent', 99_900_000, 0), effortRow('root', 0, 99_996), ...otherRoots,
  ]).effortQualifiedTierCounts, [0, 0, 0]);
  assert.deepEqual(codexCollaborationEvidence([
    effortRow('root', 99_900_000, 0, undefined, 'high'),
    effortRow('child', 0, 99_996, 'root'), ...otherRoots,
  ]).effortQualifiedTierCounts, [0, 0, 0]);
  const apr = effortRow('apr', 99_900_000, 0, 'root');
  apr.session.role = 'approval-reviewer';
  assert.deepEqual(codexCollaborationEvidence([
    effortRow('root', 0, 99_996), apr, ...otherRoots,
  ]).effortQualifiedTierCounts, [0, 0, 0]);
});

test('effort DTO counts qualified tiers independently of the main 4/5/6 award targets', () => {
  for (const tierCount of [1, 3, 4, 5, 6]) {
    const rows = effortTasks('root', 30, 2_000_000_000, 2_000_000);
    for (const row of rows) for (const effort of efforts.slice(tierCount)) delete row.byEffort[effort];
    assert.deepEqual(codexCollaborationEvidence(rows).effortQualifiedTierCounts, [tierCount, tierCount, tierCount]);
  }
});

test('none, minimal and invented effort labels never enter the six-tier spectrum', () => {
  const rows = effortTasks('root', 30, 2_000_000_000, 2_000_000);
  for (const row of rows) {
    const bucket = row.byEffort.low;
    row.byEffort = { none: bucket, minimal: bucket, invented: bucket };
  }
  assert.deepEqual(codexCollaborationEvidence(rows).effortQualifiedTierCounts, [0, 0, 0]);
});

test('rainbow keeps family processed and output aligned without cache/reasoning duplication', () => {
  const astra = { inputTotal: 9_980_000, outputTotal: 20_000, cachedInput: 9_980_000, reasoningOutput: 20_000 };
  const root = file('root', { 'gpt-6-astra': astra, 'gpt-6.1-sol': tokens(30_000, 5_000),
    'gpt-6-luna': tokens(40_000, 0) });
  root.total.cachedInput = astra.cachedInput;
  root.total.reasoningOutput = astra.reasoningOutput;
  const child = file('child', { 'openai/gpt-6-sol': tokens(10_000, 15_000) }, 'root');
  assert.deepEqual(codexCollaborationEvidence([root, child]).rainbowFamilies, {
    astra: { processed: 10_000_000, output: 20_000 }, sol: { processed: 60_000, output: 20_000 },
    luna: { processed: 40_000, output: 0 },
  });
});

test('a family may accumulate input across observations but still needs its own output threshold', () => {
  const input = file('input', { 'gpt-6-luna': tokens(9_980_000,0) });
  const output = file('output', { 'gpt-6-luna': tokens(0,20_000) });
  const result = codexCollaborationEvidence([input,output]);
  assert.deepEqual(result.rainbowFamilies.luna,{processed:10_000_000,output:20_000});
  assert.deepEqual(result.teamTaskCounts,[0,0,0]);
  assert.equal(result.qualifiedSubagentCount,0);
});

test('canonical selection rejects copies and their ambiguous descendants, orphans, cycles and bad roles', () => {
  const sound = team('safe', 3, 5_000);
  const bad = team('duplicate', 8, 50_000);
  bad.push(file('duplicate'));
  const orphan = file('orphan', { 'gpt-6-astra': tokens(0, 50_000) }, 'missing');
  const cycleA = file('cycle-a', undefined, 'cycle-b');
  const cycleB = file('cycle-b', undefined, 'cycle-a');
  const unknown = file('role');
  unknown.session.role = 'unknown' as CodexFileAggregate['session']['role'];
  const rootWithParent = file('bad-root', undefined, 'safe', 'root');
  const badChild = file('bad-child', undefined, 'role');
  const combined = [...sound, ...bad, orphan, cycleA, cycleB, unknown, rootWithParent, badChild];
  assert.deepEqual(codexCollaborationEvidence(combined), codexCollaborationEvidence(sound));
  assert.deepEqual(codexCollaborationEvidence(combined.reverse()), codexCollaborationEvidence(sound));
});

test('invalid model vectors reject the branch; invalid effort rejects only effort proof', () => {
  const sound = team('safe', 3, 5_000);
  for (const mutate of [
    (row: CodexFileAggregate) => { row.total.outputTotal = NaN; },
    (row: CodexFileAggregate) => { row.total.cachedInput = 1; },
    (row: CodexFileAggregate) => { row.byModel['gpt-6.1-sol'].outputTotal = -1; },
    (row: CodexFileAggregate) => { row.byModel['gpt-6.1-sol'].reasoningOutput = 2; },
    (row: CodexFileAggregate) => { row.total.inputTotal = Number.MAX_SAFE_INTEGER; },
  ]) {
    const bad = team('invalid', 8, 20_000);
    mutate(bad[0]);
    assert.deepEqual(codexCollaborationEvidence([...sound, ...bad]), codexCollaborationEvidence(sound));
  }
  const rows = effortTasks('effort', 5, 100_000_000, 100_000);
  rows[0].byEffort.low.outputTotal = rows[0].total.outputTotal + 1;
  assert.deepEqual(codexCollaborationEvidence(rows).effortQualifiedTierCounts, [0, 0, 0]);
  assert.ok(codexCollaborationEvidence(rows).rainbowFamilies.astra.output > 0);
});

test('zeroed inherited prefixes and input-only subagents cannot create qualifying members', () => {
  const rows = [file('root')];
  for (let i = 0; i < 20; i++) rows.push(file(`prefix-${i}`, {
    'gpt-6-astra': tokens(i % 2 ? 1_000_000 : 0, 0),
  }, 'root'));
  assert.deepEqual(codexCollaborationEvidence(rows).teamTaskCounts, [0, 0, 0]);
  assert.equal(codexCollaborationEvidence(rows).qualifiedSubagentCount, 0);
});

test('10k reversed deep lineage is iterative, memoized and never mutates indexed data', () => {
  const size = 10_000;
  let reads = 0;
  const rows = Array.from({ length: size }, (_, i) => {
    const row = file(`session-${i}`, { 'gpt-6-astra': tokens(0, 5_000) }, i ? `session-${i - 1}` : undefined);
    Object.defineProperty(row.session, 'parentSessionKey', { enumerable: true, get: () => {
      assert.ok(++reads < size * 40, 'ancestry reads must be linear');
      return i ? `session-${i - 1}` : undefined;
    } });
    return row;
  }).reverse();
  const before = JSON.stringify(rows);
  const result = codexCollaborationEvidence(rows);
  assert.deepEqual(result.teamTaskCounts, [1, 0, 0]);
  assert.equal(result.qualifiedSubagentCount, size - 1);
  assert.deepEqual(result.rainbowFamilies.astra, { processed: size * 5_000, output: size * 5_000 });
  assert.equal(JSON.stringify(rows), before);
  rows.push(file('session-0'));
  assert.deepEqual(codexCollaborationEvidence(rows), codexCollaborationEvidence([]));
});

test('numeric aggregation saturates to a safe lower bound rather than rounding into unsafe DTO values', () => {
  const rows = [file('a', { 'gpt-6-astra': tokens(0, Number.MAX_SAFE_INTEGER) }),
    file('b', { 'gpt-6-astra': tokens(0, Number.MAX_SAFE_INTEGER) })];
  assert.deepEqual(codexCollaborationEvidence(rows).rainbowFamilies.astra,
    { processed: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER });
});
