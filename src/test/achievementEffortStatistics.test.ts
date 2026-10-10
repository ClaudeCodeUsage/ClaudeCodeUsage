import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { codexAchievementEffortStatistics, CODEX_ACHIEVEMENT_EFFORTS,
  EFFORT_STATISTICS_PRICEBOOK_VERSION, EFFORT_STATISTICS_REFERENCE_DATE } from '../achievementEffortStatistics';
import { codexCollaborationEvidence } from '../achievementCollaboration';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
import type { ProviderTokenCounts } from '../providers/providerTypes';

const t = (inputTotal = 0, outputTotal = 0, cachedInput = 0): ProviderTokenCounts =>
  ({ inputTotal, outputTotal, cachedInput, cacheWriteInput: 0 });
function file(key: string, models: Record<string, ProviderTokenCounts>,
  efforts?: Record<string, ProviderTokenCounts>, parent?: string,
  role: CodexFileAggregate['session']['role'] = parent ? 'subagent' : 'root'): CodexFileAggregate {
  const total = Object.values(models).reduce((sum, tokens) => ({
    inputTotal: sum.inputTotal + tokens.inputTotal,
    outputTotal: sum.outputTotal + tokens.outputTotal,
    cachedInput: (sum.cachedInput ?? 0) + (tokens.cachedInput ?? 0),
    cacheWriteInput: (sum.cacheWriteInput ?? 0) + (tokens.cacheWriteInput ?? 0),
  }), t());
  return { total, byModel: models, byEffort: efforts ?? { low: { ...total } }, byDay: {},
    session: { sessionKey: key, role, ...(parent ? { parentSessionKey: parent } : {}) },
    structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } };
}
const row = (files: readonly CodexFileAggregate[], effort = 'low') =>
  codexAchievementEffortStatistics(files).rows.find(value => value.effort === effort)!;

test('six fixed empty rows are bounded JSON, without source identities or custom labels', () => {
  const result = codexAchievementEffortStatistics([]);
  assert.equal(result.pricingVersion, EFFORT_STATISTICS_PRICEBOOK_VERSION);
  assert.equal(result.referenceDate, EFFORT_STATISTICS_REFERENCE_DATE);
  assert.deepEqual(result.rows.map(value => value.effort), ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  for (const value of result.rows) assert.deepEqual(value, {
    effort: value.effort, processed: 0, output: 0, qualifyingRoots: 0, microUsd: null,
    amountPositive: false, pricedTokens: 0, unpricedTokens: 0, pricingCoverage: 0,
    status: 'empty', valid: true, boundState: 'unavailable',
  });
  const source = file('private-session-custom-label', { 'proxy-secret-model': t(10, 1) });
  const json = JSON.stringify(codexAchievementEffortStatistics([source]));
  assert.ok(Buffer.byteLength(json) < 16 * 1024);
  assert.ok(!json.includes('private-session') && !json.includes('secret-model'));
});

test('one full model prices multiple efforts with cache and reasoning counted once', () => {
  const source = file('root', { 'openai/gpt-6.1-sol': t(100, 10, 50) },
    { low: t(40, 4, 20), high: t(60, 6, 30) });
  source.total.reasoningOutput = 7;
  source.byModel['openai/gpt-6.1-sol'].reasoningOutput = 7;
  source.byEffort.low.reasoningOutput = 3;
  source.byEffort.high.reasoningOutput = 4;
  assert.equal(row([source]).processed, 44);
  assert.equal(row([source]).microUsd, 82);
  assert.equal(row([source], 'high').microUsd, 123);
  assert.equal(row([source]).status, 'complete');
  assert.equal(row([source]).pricingCoverage, 1);
  assert.equal(row([source]).boundState, 'exact');
});

test('explicit aliases of one complete model can price efforts; unknown lookalikes cannot', () => {
  const source = file('aliases', { 'gpt-6.1-sol': t(50, 1, 25), 'openai/gpt-6.1-sol': t(50, 1, 25) },
    { low: t(50, 1, 25), high: t(50, 1, 25) });
  assert.equal(row([source]).microUsd, 62);
  assert.equal(row([source]).pricedTokens, 51);
  assert.equal(row([source]).status, 'complete');
  source.byModel = { 'gpt-6.1-sol': t(50, 1, 25), 'proxy-gpt-6.1-sol': t(50, 1, 25) };
  assert.equal(row([source]).microUsd, null);
  assert.equal(row([source]).unpricedTokens, 51);
});

test('one full effort prices each model once, retaining unknown models and residuals as unpriced', () => {
  const source = file('root', { 'gpt-6.1-sol': t(10, 1), 'gpt-6-astra': t(10, 1),
    'proxy-gpt-6.1-sol': t(10, 1) });
  const value = row([source]);
  assert.equal(value.microUsd, 180);
  assert.equal(value.processed, 33);
  assert.equal(value.pricedTokens, 22);
  assert.equal(value.unpricedTokens, 11);
  assert.equal(value.status, 'partial');
  assert.equal(value.boundState, 'lower-bound');
  const residual = file('residual', { 'gpt-6.1-sol': t(10, 1) });
  residual.total.inputTotal += 5;
  residual.byEffort.low.inputTotal += 5;
  assert.equal(row([residual]).microUsd, 30);
  assert.equal(row([residual]).unpricedTokens, 5);
});

test('swapped model-effort assignments have identical marginals and cannot produce priced money', () => {
  // Output-only requests: swapping the actual assignments would make low cost
  // 10 or 50 microUSD, but neither assignment is retained in these marginals.
  const source = file('mixed', { 'gpt-6.1-sol': t(0, 1), 'gpt-6-astra': t(0, 1) },
    { low: t(0, 1), high: t(0, 1) });
  for (const effort of ['low', 'high']) {
    const value = row([source], effort);
    assert.equal(value.processed, 1);
    assert.equal(value.qualifyingRoots, 1);
    assert.equal(value.microUsd, null);
    assert.equal(value.pricedTokens, 0);
    assert.equal(value.unpricedTokens, 1);
    assert.equal(value.status, 'unpriced');
  }
});

test('singleton labels must cover input/output/cache components, including other effort residuals', () => {
  const missingModelCache = file('model-cache', { 'gpt-6.1-sol': t(100, 2, 50) },
    { low: t(50, 1, 25), high: t(50, 1, 25) });
  missingModelCache.byModel['gpt-6.1-sol'].cachedInput = 49;
  assert.equal(row([missingModelCache]).microUsd, null);
  const missingEffortCache = file('effort-cache', { 'gpt-6.1-sol': t(50, 1, 25),
    'gpt-6-astra': t(50, 1, 25) }, { low: t(100, 2, 49) });
  assert.equal(row([missingEffortCache]).microUsd, null);
  const otherEffort = file('other', { 'gpt-6.1-sol': t(10, 1), 'gpt-6-astra': t(10, 1) },
    { low: t(10, 2), unknown: t(10, 0) });
  assert.equal(row([otherEffort]).microUsd, null);
  const writes = file('write', { 'gpt-6.1-sol': { ...t(10, 1), cacheWriteInput: 1 } });
  assert.equal(row([writes]).microUsd, null);
  assert.equal(row([writes]).status, 'invalid');
  const incompleteModel = file('partial-model', { 'gpt-6.1-sol': t(100, 2) });
  incompleteModel.total.cachedInput = 50;
  incompleteModel.byEffort.low.cachedInput = 50;
  assert.equal(row([incompleteModel]).microUsd, null);
});

test('incomplete effort cache marginals cannot inflate fresh input despite a complete single model', () => {
  const source = file('effort-cache-residual', { 'gpt-6.1-sol': t(100, 2, 50) },
    { low: t(50, 1, 0), high: t(50, 1, 0) });
  // Both independent vectors fit input/cached totals, but their combined
  // fresh input is 100 while the file proves only 50 fresh input tokens.
  assert.equal(row([source]).processed, 51);
  assert.equal(row([source]).microUsd, null);
  assert.equal(row([source]).status, 'invalid');
  assert.equal(row([source]).unpricedTokens, 51);
  // A genuinely componentwise partial effort projection is a sound subset.
  source.byEffort = { low: t(50, 2, 0) };
  assert.equal(row([source]).microUsd, 120);
  assert.equal(row([source]).status, 'complete');
});

test('missing total cached input is zero and cannot admit positive model cache components', () => {
  const source = file('missing-total-model-cache', { 'gpt-6.1-sol': t(100, 2, 50) }, { low: t(100, 2) });
  delete source.total.cachedInput;
  const value = row([source]);
  assert.equal(value.processed, 102);
  assert.equal(value.output, 2);
  assert.equal(value.qualifyingRoots, 1);
  assert.equal(value.microUsd, null);
  assert.equal(value.status, 'invalid');
  assert.equal(value.valid, false);
  assert.equal(value.pricedTokens, 0);
  assert.equal(value.unpricedTokens, 102);
});

test('missing total cached input is zero and cannot admit positive effort cache components', () => {
  const source = file('missing-total-effort-cache', { 'gpt-6.1-sol': t(100, 2) }, { low: t(100, 2, 50) });
  delete source.total.cachedInput;
  const value = row([source]);
  assert.equal(value.processed, 102);
  assert.equal(value.microUsd, null);
  assert.equal(value.status, 'invalid');
  assert.equal(value.pricedTokens, 0);
  assert.equal(value.unpricedTokens, 102);
});

test('sound componentwise partial model partitions keep cached and fresh residuals unpriced', () => {
  const source = file('partial-cache-model', { 'gpt-6.1-sol': t(30, 1, 20) });
  source.total = t(100, 1, 50);
  source.byEffort.low = { ...source.total };
  const value = row([source]);
  assert.equal(value.microUsd, 32);
  assert.equal(value.pricedTokens, 31);
  assert.equal(value.unpricedTokens, 70);
  assert.equal(value.status, 'partial');
  assert.equal(value.boundState, 'lower-bound');
});

test('root-effort output admits input-only members, never another root or another effort', () => {
  const parent = file('root', { 'gpt-6.1-sol': t(100, 0) });
  const child = file('child', { 'gpt-6.1-sol': t(0, 1) }, undefined, 'root');
  const idle = file('idle', { 'gpt-6-astra': t(10000, 0) });
  const other = file('other', { 'gpt-6.1-sol': t(100, 1) }, { low: t(100, 0), high: t(0, 1) });
  assert.equal(row([parent]).processed, 0);
  const value = row([parent, child, idle, other]);
  assert.equal(value.processed, 101);
  assert.equal(value.output, 1);
  assert.equal(value.qualifyingRoots, 1);
  assert.equal(value.microUsd, 210);
  assert.equal(row([parent, child, idle, other], 'high').processed, 1);
});

test('APR supplies ancestry only and cannot supply volume or root-effort qualifying output', () => {
  const root = file('root', { 'gpt-6.1-sol': t(100, 0) });
  const apr = file('apr', { 'gpt-6-astra': t(10000, 10) }, undefined, 'root', 'approval-reviewer');
  assert.equal(row([root, apr]).processed, 0);
  const child = file('child', { 'gpt-6.1-sol': t(0, 1) }, undefined, 'apr');
  assert.equal(row([root, apr, child]).processed, 101);
  assert.equal(row([root, apr, child]).microUsd, 210);
});

test('orphans, conflicts and descendants, cycles, unknown roles and malformed vectors fail closed', () => {
  const good = file('good', { 'gpt-6.1-sol': t(0, 1) });
  const conflict = file('duplicate', { 'gpt-6.1-sol': t(10, 1) });
  const badEffort = file('bad-effort', { 'gpt-6.1-sol': t(10, 1) });
  badEffort.byEffort.low.cachedInput = 11;
  const badModel = file('bad-model', { 'gpt-6.1-sol': t(10, 1) });
  badModel.byModel['gpt-6.1-sol'].outputTotal = NaN;
  const sources = [good, conflict, structuredClone(conflict),
    file('descendant', { 'gpt-6.1-sol': t(10, 1) }, undefined, 'duplicate'),
    file('orphan', { 'gpt-6.1-sol': t(10, 1) }, undefined, 'missing'),
    file('cycle-a', { 'gpt-6.1-sol': t(10, 1) }, undefined, 'cycle-b'),
    file('cycle-b', { 'gpt-6.1-sol': t(10, 1) }, undefined, 'cycle-a'),
    file('unknown-role', { 'gpt-6.1-sol': t(10, 1) }, undefined, undefined, 'unknown'), badEffort, badModel];
  assert.deepEqual(row(sources), row([good]));
});

test('none/minimal/unknown and invented labels never become one of the six tiers', () => {
  const sources = ['none', 'minimal', 'unknown', 'HIGH', 'custom-private-label'].map((effort, i) =>
    file(String(i), { 'gpt-6.1-sol': t(10, 1) }, { [effort]: t(10, 1) }));
  assert.deepEqual(codexAchievementEffortStatistics(sources), codexAchievementEffortStatistics([]));
});

test('money floors after summing files and preserves positive submicro amounts', () => {
  const first = file('one', { 'gpt-6-luna': t(0, 1) });
  const second = file('two', { 'gpt-6-luna': t(0, 1) });
  assert.equal(row([first]).microUsd, 0);
  assert.equal(row([first]).amountPositive, true);
  assert.equal(row([first, second]).microUsd, 1);
  const unknown = file('unknown', { 'invented': t(0, 1) });
  assert.equal(row([unknown]).microUsd, null);
  assert.equal(row([unknown]).amountPositive, false);
  assert.equal(row([first, unknown]).microUsd, 0);
  assert.equal(row([first, unknown]).status, 'partial');
});

test('unsafe amount and summed token overflow withhold money and keep saturated token lower bounds', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const moneyOverflow = file('money-overflow', { 'gpt-6-astra': t(0, max) });
  const first = row([moneyOverflow]);
  assert.equal(first.status, 'overflow');
  assert.equal(first.valid, false);
  assert.equal(first.microUsd, null);
  const one = file('one', { 'gpt-6-luna': t(max - 1, 1) });
  const two = file('two', { 'gpt-6-luna': t(max - 1, 1) });
  const value = row([one, two]);
  assert.equal(value.processed, max);
  assert.equal(value.output, 2);
  assert.equal(value.qualifyingRoots, 2);
  assert.equal(value.status, 'overflow');
  assert.equal(value.microUsd, null);
  assert.ok(Number.isSafeInteger(value.unpricedTokens));
  // Every file amount is safe; the combined amount alone exceeds the limit.
  const half = Math.floor(max / 60);
  const amountOnly = row([file('amount-one', { 'gpt-6-astra': t(0, half) }),
    file('amount-two', { 'gpt-6-astra': t(0, half) })]);
  assert.ok(amountOnly.processed < max);
  assert.equal(amountOnly.status, 'overflow');
  assert.equal(amountOnly.microUsd, null);
});

test('row conjunctions reproduce existing effort qualification at exact and just-below boundaries', () => {
  const levels = [[5, 100_000_000, 100_000], [10, 500_000_000, 500_000], [30, 2_000_000_000, 2_000_000]];
  for (const [roots, processed, output] of levels) {
    for (const [r, p, o] of [[roots, processed, output], [roots - 1, processed, output],
      [roots, processed - 1, output], [roots, processed, output - 1]]) {
      const sources = Array.from({ length: r }, (_, i) => {
        const bucket = i ? t(0, 1) : t(p - o, o - r + 1);
        return file(`private-${i}`, { 'gpt-6-astra': t(bucket.inputTotal * 6, bucket.outputTotal * 6) },
          Object.fromEntries(CODEX_ACHIEVEMENT_EFFORTS.map(effort => [effort, { ...bucket }])));
      });
      const counts = levels.map(([requiredRoots, requiredProcessed, requiredOutput]) =>
        codexAchievementEffortStatistics(sources).rows.filter(value => value.qualifyingRoots >= requiredRoots &&
          value.processed >= requiredProcessed && value.output >= requiredOutput).length);
      assert.deepEqual(counts, codexCollaborationEvidence(sources).effortQualifiedTierCounts);
    }
  }
});

test('frozen inputs remain untouched and deep reverse-order ancestry resolves iteratively', () => {
  const sources = Array.from({ length: 3000 }, (_, i) =>
    file(`private-${i}`, { 'gpt-6.1-sol': t(1, 1) }, undefined, i ? `private-${i - 1}` : undefined)).reverse();
  const before = JSON.stringify(sources);
  for (const source of sources) {
    Object.freeze(source.total);
    Object.values(source.byModel).forEach(Object.freeze);
    Object.values(source.byEffort).forEach(Object.freeze);
    Object.freeze(source.session);
    Object.freeze(source);
  }
  const value = row(Object.freeze(sources));
  assert.equal(value.processed, 6000);
  assert.equal(value.qualifyingRoots, 1);
  assert.equal(value.microUsd, 36000);
  assert.equal(JSON.stringify(sources), before);
});
