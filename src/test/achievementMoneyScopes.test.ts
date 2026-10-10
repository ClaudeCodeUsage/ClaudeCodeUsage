import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  claudeMoneyEvidenceFromModels, codexMoneyEvidenceFromModels,
  claudeAchievementMoneyScopes, codexAchievementMoneyScopes,
  type ClaudeMoneyModels,
} from '../achievementMoneyScopes';
import { getAchievementMoneyPricebook } from '../achievementMoney';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
import type { AchievementDayEvidence } from '../achievementCalendar';

const backend = 'anthropic' as const;
const asOfDay = '2026-10-12'; // Monday: Sunday Oct 11 has ended.
function cm(input = 100, model = 'claude-opus-5-5'): ClaudeMoneyModels {
  return { [model]: { inputTokens: input, outputTokens: 0, cacheCreationTokens: 0,
    cacheReadTokens: 0, referenceUsage: { inputTokens: input, outputTokens: 0,
      cacheReadTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 } } };
}
function file(key: string, input = 100, parent?: string,
  role: 'root' | 'subagent' | 'approval-reviewer' = parent ? 'subagent' : 'root',
  model = 'gpt-6.1-sol'): CodexFileAggregate {
  return { total: { inputTotal: input, outputTotal: 0 }, byModel: {
    [model]: { inputTotal: input, outputTotal: 0 } }, byDay: {}, byEffort: {},
    session: { sessionKey: key, parentSessionKey: parent, role },
    structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 },
    period: { timeZone: 'UTC', indexedThrough: 1, lineageVersion: 1, lineagePrefixEvents: 0,
      days: { '2026-10-05': { total: { inputTotal: input, outputTotal: 0 },
        byModel: { [model]: { inputTotal: input, outputTotal: 0 } }, byEffort: {},
        structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } } } } };
}
function proof(files: CodexFileAggregate[]): AchievementDayEvidence {
  const days = new Map<string, AchievementDayEvidence['days'][number]>();
  for (const f of files) for (const [day, slice] of Object.entries(f.period?.days ?? {})) {
    const row = days.get(day) ?? { day, processed: 0, output: 0, models: {} };
    row.processed += slice.total.inputTotal + slice.total.outputTotal;
    row.output += slice.total.outputTotal;
    for (const [m, t] of Object.entries(slice.byModel)) {
      const old = row.models[m] ?? { processed: 0, output: 0 };
      row.models[m] = { processed: old.processed + t.inputTotal + t.outputTotal, output: old.output + t.outputTotal };
    }
    days.set(day, row);
  }
  return { complete: true, timeZone: 'UTC', days: [...days.values()] };
}
test('Claude shadow prices its known TTL subset and preserves all primary tokens without mutation', () => {
  const models = cm();
  const row = models['claude-opus-5-5'];
  row.inputTokens = 200;
  row.cacheCreationTokens = 50;
  row.referenceUsage!.cacheCreation5mTokens = 10;
  const before = JSON.stringify(models);
  const result = claudeMoneyEvidenceFromModels(models, backend);
  assert.equal(result.status, 'partial');
  assert.equal(result.microUsd, 450);
  assert.equal(result.totalTokens, 250);
  assert.equal(result.pricedTokens, 110);
  assert.equal(result.unpricedTokens, 140);
  assert.equal(result.pricingCoverage, 110 / 250);
  assert.equal(JSON.stringify(models), before);
  delete row.referenceUsage;
  assert.equal(claudeMoneyEvidenceFromModels(models, backend).status, 'unpriced');
});
test('empty, unknown model, missing price and invalid aggregates remain distinguishable', () => {
  assert.equal(claudeMoneyEvidenceFromModels({}, backend).status, 'empty');
  assert.equal(claudeMoneyEvidenceFromModels(cm(100, 'unknown'), backend).status, 'unpriced');
  assert.equal(claudeMoneyEvidenceFromModels(cm(100, 'claude-fable-5-1'), 'aws-bedrock-in-region').status, 'unpriced');
  for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = cm(); bad['claude-opus-5-5'].inputTokens = value;
    assert.deepEqual(claudeMoneyEvidenceFromModels(bad, backend), { status: 'invalid' });
  }
  const bad = cm(); bad['claude-opus-5-5'].referenceUsage!.inputTokens = 101;
  assert.deepEqual(claudeMoneyEvidenceFromModels(bad, backend), { status: 'invalid' });
});
test('Claude scopes use completed Monday weeks, actual model/day prices and all session Iterable', () => {
  const rows = [{ date: '2026-10-11', models: cm(100, 'claude-sonnet-5-5') },
    { date: '2026-10-05', models: cm(100) }, { date: '2026-10-12', models: cm(10000) }];
  function* sessions() { for (let i = 0; i < 1000; i++) yield cm(1); yield cm(5000); }
  const result = claudeAchievementMoneyScopes({ allTimeModels: cm(999999), backend, asOfDay,
    days: { complete: true, rows }, allSessionModels: sessions(), sessionsComplete: true });
  assert.equal(result.cumulative?.microUsd, 3999996);
  assert.equal(result.completedMondayWeekPeak, 600);
  assert.equal(result.maxSessionTask, 20000);
  assert.equal(result.pricebookVersion, getAchievementMoneyPricebook(backend).version);
  assert.equal(claudeAchievementMoneyScopes({ allTimeModels: cm(), backend, asOfDay: '2026-10-11',
    days: { complete: true, rows: rows.slice(0, 2) } }).completedMondayWeekPeak, undefined);
});
test('identical daily projections dedup regardless of model order; TTL conflicts invalidate only week', () => {
  const models = { ...cm(), ...cm(10, 'claude-sonnet-5-5') };
  const reversed = Object.fromEntries(Object.entries(models).reverse());
  const input = { allTimeModels: models, backend, asOfDay, days: { complete: true,
    rows: [{ date: '2026-10-05', models }, { date: '2026-10-05', models: reversed }] } };
  assert.equal(claudeAchievementMoneyScopes(input).completedMondayWeekPeak, 420);
  const conflict = cm(); delete conflict['claude-opus-5-5'].referenceUsage;
  const result = claudeAchievementMoneyScopes({ ...input, days: { complete: true,
    rows: [{ date: '2026-10-05', models: cm() }, { date: '2026-10-05', models: conflict }] } });
  assert.equal(result.completedMondayWeekPeak, undefined);
  assert.equal(result.coverage.completedMondayWeekPeak.status, 'invalid');
  assert.equal(result.cumulative?.microUsd, 420);
});
test('scopepending, verified empty, unpriced and partial money scopes do not become total money', () => {
  const base = { allTimeModels: cm(), backend, asOfDay };
  assert.equal(claudeAchievementMoneyScopes(base).coverage.completedMondayWeekPeak.status, 'scopepending');
  const empty = claudeAchievementMoneyScopes({ ...base, days: { complete: true, rows: [] }, allSessionModels: [], sessionsComplete: true });
  assert.equal(empty.coverage.completedMondayWeekPeak.status, 'empty');
  assert.equal(empty.coverage.maxSessionTask.status, 'empty');
  const unpriced = claudeAchievementMoneyScopes({ ...base, days: { complete: true,
    rows: [{ date: '2026-10-05', models: cm(100, 'unknown') }] } });
  assert.equal(unpriced.completedMondayWeekPeak, undefined);
  assert.equal(unpriced.coverage.completedMondayWeekPeak.status, 'unpriced');
  const partialModels = { ...cm(), ...cm(100, 'unknown') };
  const partial = claudeAchievementMoneyScopes({ ...base, days: { complete: true,
    rows: [{ date: '2026-10-05', models: partialModels }] } });
  assert.equal(partial.completedMondayWeekPeak, 400);
  assert.equal(partial.coverage.completedMondayWeekPeak.status, 'partial');
});
test('Codex root task sums each canonical file once including actual APR usage, no total/ancestor double count', () => {
  const files = [file('grand', 300, 'child'), file('other', 500), file('apr', 40, 'root', 'approval-reviewer'),
    file('child', 200, 'root'), file('root', 100)];
  const result = codexAchievementMoneyScopes({ files, complete: true, dayEvidence: proof(files), backend, asOfDay });
  assert.equal(result.cumulative?.microUsd, 2280);
  assert.equal(result.completedMondayWeekPeak, 2280);
  assert.equal(result.maxSessionTask, 1280);
  assert.equal(result.cumulative?.provider, 'codex');
  const huge = codexAchievementMoneyScopes({ files: [file('huge', 1_000_000)], complete: true, backend, asOfDay });
  assert.equal(huge.maxSessionTask, 2_000_000);
  assert.equal(huge.completedMondayWeekPeak, undefined);
  assert.equal('multiAgentRootCount' in huge, false);
});
test('Codex identity conflict excludes descendants, independent root survives; no repeated prefix subtraction', () => {
  const files = [file('duplicate'), file('duplicate'), file('kid', 1000, 'duplicate'), file('sound', 25)];
  const result = codexAchievementMoneyScopes({ files, complete: true, backend, asOfDay });
  assert.equal(result.cumulative?.microUsd, 50);
  assert.equal(result.maxSessionTask, 50);
  assert.equal(result.coverage.verifiedFiles, 1);
  const filtered = [file('r', 100), file('c', 30, 'r')];
  filtered[1].period!.lineagePrefixEvents = 999; // Canonical net counters already exclude the prefix.
  assert.equal(codexAchievementMoneyScopes({ files: filtered, complete: true, backend, asOfDay }).maxSessionTask, 260);
});
test('Codex date proof is required and jointly checked against actual period model counters', () => {
  const files = [file('r')];
  const base = { files, complete: true, backend, asOfDay };
  assert.equal(codexAchievementMoneyScopes(base).completedMondayWeekPeak, undefined);
  const evidence = proof(files);
  assert.equal(codexAchievementMoneyScopes({ ...base, dayEvidence: evidence }).completedMondayWeekPeak, 200);
  evidence.days[0].models = { 'gpt-6-astra': { processed: 100, output: 0 } };
  assert.equal(codexAchievementMoneyScopes({ ...base, dayEvidence: evidence }).completedMondayWeekPeak, undefined);
  const wrongZone = { ...proof(files), timeZone: 'Asia/Shanghai' };
  assert.equal(codexAchievementMoneyScopes({ ...base, dayEvidence: wrongZone }).completedMondayWeekPeak, undefined);
  files[0].period!.days['2026-10-05'].byModel['gpt-6.1-sol'].inputTotal = 101;
  assert.equal(codexAchievementMoneyScopes({ ...base, dayEvidence: proof(files) }).completedMondayWeekPeak, undefined);
  assert.equal(codexAchievementMoneyScopes(base).cumulative?.microUsd, 200);
});
test('unsafe or overflowing cumulative counters never throw into host; amount overflow has no scope value', () => {
  const models = { ...cm(Number.MAX_SAFE_INTEGER, 'unknown'), ...cm(1) };
  assert.deepEqual(claudeMoneyEvidenceFromModels(models, backend), { status: 'invalid' });
  const big = cm(3_000_000_000_000_000);
  const money = claudeMoneyEvidenceFromModels(big, backend);
  assert.equal(money.status, 'overflow');
  assert.equal(money.microUsd, null);
  const scopes = claudeAchievementMoneyScopes({ allTimeModels: big, backend, asOfDay,
    allSessionModels: [big], sessionsComplete: true });
  assert.equal(scopes.maxSessionTask, undefined);
  assert.equal(scopes.coverage.maxSessionTask.status, 'overflow');
  assert.deepEqual(codexMoneyEvidenceFromModels({ m: { inputTotal: 1, outputTotal: 0, cachedInput: 2 } }, backend), { status: 'invalid' });
});
test('providers and backend/version are isolated and unsafe backend has a fixed invalid result', () => {
  assert.equal(claudeMoneyEvidenceFromModels(cm(), backend).provider, 'claude');
  assert.equal(codexMoneyEvidenceFromModels({ 'gpt-6.1-sol': { inputTotal: 100, outputTotal: 0 } }, backend).provider, 'codex');
  assert.equal(claudeAchievementMoneyScopes({ allTimeModels: cm(), asOfDay, backend: 'bad' as any }).coverage.cumulative.status, 'invalid');
  const aws = claudeAchievementMoneyScopes({ allTimeModels: cm(), asOfDay, backend: 'aws-bedrock-in-region' });
  assert.equal(aws.cumulative?.microUsd, 440);
  assert.notEqual(aws.pricebookVersion, getAchievementMoneyPricebook(backend).version);
});
test('deep unordered Codex lineage resolves iteratively without recursion or quadratic ancestor sums', () => {
  const files = Array.from({ length: 12000 }, (_, i) => file(String(i), 1, i ? String(i - 1) : undefined)).reverse();
  const result = codexAchievementMoneyScopes({ files, complete: true, backend, asOfDay });
  assert.equal(result.maxSessionTask, 24000);
  assert.equal(result.cumulative?.microUsd, 24000);
});
test('Codex invalid zone cannot supply an independently complete date proof', () => {
  const files = [file('r')];
  files[0].period!.timeZone = 'not-a-zone';
  const result = codexAchievementMoneyScopes({ files, complete: true, backend, asOfDay,
    dayEvidence: { ...proof(files), timeZone: 'not-a-zone' } });
  assert.equal(result.completedMondayWeekPeak, undefined);
  assert.equal(result.coverage.completedMondayWeekPeak.status, 'invalid');
  assert.equal(result.cumulative?.microUsd, 200);
});
test('exact fractions round after the entire week/root, never per model or per day', () => {
  const rows = Array.from({ length: 6 }, (_, i) => {
    const models = cm(0); const row = models['claude-opus-5-5'];
    row.cacheReadTokens = row.referenceUsage!.cacheReadTokens = 1;
    return { date: `2026-10-${String(5 + i).padStart(2, '0')}`, models };
  });
  const claude = claudeAchievementMoneyScopes({ allTimeModels: {}, backend, asOfDay, days: { complete: true, rows } });
  assert.equal(claude.completedMondayWeekPeak, 1); // 6 * 0.2, floored once.
  const files = Array.from({ length: 10 }, (_, i) => {
    const f = file(String(i), 1, i ? '0' : undefined);
    f.total.cachedInput = f.byModel['gpt-6.1-sol'].cachedInput = 1;
    f.period!.days['2026-10-05'].total.cachedInput = f.period!.days['2026-10-05'].byModel['gpt-6.1-sol'].cachedInput = 1;
    return f;
  });
  const codex = codexAchievementMoneyScopes({ files, complete: true, backend, asOfDay, dayEvidence: proof(files) });
  assert.equal(codex.cumulative?.microUsd, 1);
  assert.equal(codex.completedMondayWeekPeak, 1);
  assert.equal(codex.maxSessionTask, 1);
});
test('model/day joint buckets choose the actual highest completed week, not global rates times day marginals', () => {
  const rows = [{ date: '2026-09-28', models: cm(200, 'claude-sonnet-5-5') },
    { date: '2026-10-05', models: cm(150) }];
  const c = claudeAchievementMoneyScopes({ allTimeModels: {}, backend, asOfDay, days: { complete: true, rows } });
  assert.equal(c.completedMondayWeekPeak, 600); // Cheaper 200 tokens is only 400.
  const files = [file('cheap', 200), file('expensive', 150, undefined, 'root', 'gpt-6-astra')];
  const period = files[0].period!;
  period.days['2026-09-28'] = period.days['2026-10-05']; delete period.days['2026-10-05'];
  const x = codexAchievementMoneyScopes({ files, complete: true, backend, asOfDay, dayEvidence: proof(files) });
  assert.equal(x.completedMondayWeekPeak, 1500);
  assert.equal(x.cumulative?.microUsd, 1900);
});
test('independent date proof does not bless a period with missing undated usage or wrong joint subsets', () => {
  const f = file('r', 100); f.period!.days['2026-10-05'].total.inputTotal = 50;
  f.period!.days['2026-10-05'].byModel['gpt-6.1-sol'].inputTotal = 50;
  const base = { files: [f], complete: true, backend, asOfDay };
  assert.equal(codexAchievementMoneyScopes({ ...base, dayEvidence: proof([f]) }).completedMondayWeekPeak, undefined);
  assert.equal(codexAchievementMoneyScopes(base).maxSessionTask, 200);
  f.period = undefined;
  assert.equal(codexAchievementMoneyScopes({ ...base, dayEvidence: { complete: true, timeZone: 'UTC', days: [] } }).completedMondayWeekPeak, undefined);
});
test('date duplicates cannot hide component or TTL differences behind equal rounded money', () => {
  const a = cm(0), b = cm(0);
  a['claude-opus-5-5'].cacheReadTokens = a['claude-opus-5-5'].referenceUsage!.cacheReadTokens = 1;
  b['claude-opus-5-5'].cacheReadTokens = 1;
  const result = claudeAchievementMoneyScopes({ allTimeModels: {}, backend, asOfDay,
    days: { complete: true, rows: [{ date: '2026-10-05', models: a }, { date: '2026-10-05', models: b }] } });
  assert.equal(result.coverage.completedMondayWeekPeak.status, 'invalid');
  for (const date of ['2026-02-30', '2026-13-01', '2026-1-01']) {
    assert.equal(claudeAchievementMoneyScopes({ allTimeModels: {}, backend, asOfDay,
      days: { complete: true, rows: [{ date, models: cm() }] } }).completedMondayWeekPeak, undefined);
  }
});
test('missing required price excludes only that model subset and unknown labels are never guessed', () => {
  const bad = cm(100, 'gpt-6.1-sol');
  bad['gpt-6.1-sol'].cacheCreationTokens = bad['gpt-6.1-sol'].referenceUsage!.cacheCreation5mTokens = 1;
  const result = claudeMoneyEvidenceFromModels({ ...bad, ...cm(100) }, backend);
  assert.equal(result.microUsd, 400);
  assert.equal(result.pricedTokens, 100);
  assert.equal(result.unpricedTokens, 101);
  assert.equal(result.status, 'partial');
  const cx = codexMoneyEvidenceFromModels({ 'proxy-gpt-6.1-sol': { inputTotal: 100, outputTotal: 50 },
    'gpt-6.1-sol': { inputTotal: 100, cachedInput: 30, outputTotal: 20, reasoningOutput: 15 } }, backend);
  assert.equal(cx.microUsd, 343);
  assert.equal(cx.totalTokens, 270);
  assert.equal(cx.pricedTokens, 120);
});
test('cycles, orphans, empty census and incomplete index preserve evidence boundaries', () => {
  const files = [file('a', 100, 'b'), file('b', 100, 'a'), file('orphan', 100, 'missing')];
  const invalid = codexAchievementMoneyScopes({ files, complete: true, backend, asOfDay });
  assert.equal(invalid.cumulative, undefined);
  assert.equal(invalid.maxSessionTask, undefined);
  assert.equal(invalid.coverage.cumulative.status, 'invalid');
  const pending = codexAchievementMoneyScopes({ files: [file('r')], complete: false, backend, asOfDay });
  assert.equal(pending.coverage.cumulative.status, 'scopepending');
  const empty = codexAchievementMoneyScopes({ files: [], complete: true, backend, asOfDay,
    dayEvidence: { complete: true, timeZone: 'UTC', days: [] } });
  assert.equal(empty.cumulative?.status, 'empty');
  assert.equal(empty.coverage.maxSessionTask.status, 'empty');
  assert.equal(empty.coverage.completedMondayWeekPeak.status, 'empty');
});
test('Codex period duplicate proof rows dedup; changed same-day proof or unsafe totals withhold week only', () => {
  const files = [file('r')], evidence = proof(files);
  evidence.days.push({ ...evidence.days[0] });
  const input = { files, complete: true, backend, asOfDay, dayEvidence: evidence };
  assert.equal(codexAchievementMoneyScopes(input).completedMondayWeekPeak, 200);
  evidence.days[1] = { ...evidence.days[1], output: 1 };
  assert.equal(codexAchievementMoneyScopes(input).completedMondayWeekPeak, undefined);
  assert.equal(codexAchievementMoneyScopes(input).cumulative?.microUsd, 200);
  files[0].total.inputTotal = Number.MAX_SAFE_INTEGER;
  files[0].total.outputTotal = 1;
  assert.doesNotThrow(() => codexAchievementMoneyScopes(input));
  assert.equal(codexAchievementMoneyScopes(input).coverage.cumulative.status, 'invalid');
});
