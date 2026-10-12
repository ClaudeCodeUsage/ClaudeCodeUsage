import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ClaudeDataLoader, compactUsageRecord } from '../dataLoader';
import { claudeReferenceUsage } from '../claudeReferenceUsage';
import { claudeUsageDashboardSnapshot, createClaudeUsageIndex, updateClaudeUsageIndex } from '../claudeIncrementalIndex';
import { claudeMoneyEvidenceFromModels } from '../achievementMoneyScopes';
import { I18n } from '../i18n';
import { calculateCostBreakdown } from '../pricing';
import { ClaudeUsageRecord } from '../types';

type Usage = ClaudeUsageRecord['message']['usage'];
const model = 'claude-opus-5-5';
const timestamp = '2026-10-05T08:00:00.000Z';
const now = new Date('2026-10-12T12:00:00.000Z');
const writes: Usage = { input_tokens: 0, output_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 60 } };
const row = (id: string, usage: Usage = writes): ClaudeUsageRecord => ({
  timestamp, requestId: `request-${id}`, message: { id: `message-${id}`, model, usage },
});
const line = (record: ClaudeUsageRecord): string => JSON.stringify({ type: 'assistant', ...record }) + '\n';

test('explicit complete split-only writes survive compaction and cache-only native aggregation', () => {
  const original = row('writes');
  const before = JSON.stringify(original);
  const compact = compactUsageRecord(original);
  assert.equal(compact.message.usage.cache_creation_input_tokens, 100);
  assert.deepEqual(claudeReferenceUsage(writes), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreation5mTokens: 40, cacheCreation1hTokens: 60 });
  const direct = ClaudeDataLoader.calculateUsageData([original]);
  assert.equal(direct.totalCacheCreationTokens, 100);
  assert.equal(direct.modelBreakdown[model].count, 1);
  assert.deepEqual(direct, ClaudeDataLoader.calculateUsageData([compact]));
  assert.deepEqual(direct.costBreakdown, calculateCostBreakdown(writes, model));
  const money = claudeMoneyEvidenceFromModels(direct.modelBreakdown, 'anthropic');
  assert.equal(money.status, 'complete');
  assert.equal(money.totalTokens, 100);
  assert.equal(money.microUsd, 680);
  assert.equal(JSON.stringify(original), before, 'normalization must not mutate the source');
});

test('split-only writes require both explicit safe TTL counts; flat contradictions remain excluded', () => {
  const splits: unknown[] = [
    { ephemeral_5m_input_tokens: 100 }, { ephemeral_1h_input_tokens: 100 },
    { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 60, extra: 0 },
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '60'].map(value =>
      ({ ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: value })),
    { ephemeral_5m_input_tokens: Number.MAX_SAFE_INTEGER, ephemeral_1h_input_tokens: 1 },
    null, [], false,
  ];
  for (const split of splits) {
    const usage = { input_tokens: 7, output_tokens: 3, cache_creation: split } as Usage;
    assert.equal(compactUsageRecord(row('bad', usage)).message.usage.cache_creation_input_tokens, undefined);
    assert.equal(claudeReferenceUsage(usage), undefined, JSON.stringify(split));
  }
  for (const flat of [0, 99, 101, -1, 0.5, NaN, Infinity, null, '100']) {
    const usage = { ...writes, input_tokens: 7, cache_creation_input_tokens: flat } as Usage;
    assert.equal(claudeReferenceUsage(usage), undefined, String(flat));
    assert.ok(Object.is(compactUsageRecord(row('conflict', usage)).message.usage.cache_creation_input_tokens, flat));
  }
  for (const split of [{ ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 },
    { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100 }]) {
    assert.equal(ClaudeDataLoader.calculateUsageData([row('one-ttl', { ...writes, cache_creation: split })])
      .totalCacheCreationTokens, 100);
  }
  assert.equal(claudeReferenceUsage({ input_tokens: 7, output_tokens: 3,
    cache_creation_input_tokens: 100 }), undefined, 'flat-only positive writes have unknown TTL');
  assert.ok(claudeReferenceUsage({ input_tokens: 7, output_tokens: 3, cache_creation_input_tokens: 100,
    cache_creation: { ephemeral_1h_input_tokens: 100 } }), 'flat equality still proves a missing count is zero');
  assert.ok(claudeReferenceUsage({ input_tokens: 7, output_tokens: 3, cache_creation: {} }),
    'an empty split retains the existing zero-write semantics');
});

test('Full, index, materialization and frozen money agree across split-only cold, append, replacement and warm refresh', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-split-only-'));
  const previousZone = I18n.getTimezone();
  I18n.setTimezone('UTC');
  try {
    const project = path.join(root, 'projects', '-synthetic-split');
    await mkdir(project, { recursive: true });
    const file = path.join(project, 'session.jsonl');
    await writeFile(file, line(row('initial')));
    let result = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false });
    const check = async (creation: number, processed: number, microUsd: number) => {
      const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false });
      const data = ClaudeDataLoader.calculateUsageData(full.records);
      assert.equal(data.totalCacheCreationTokens, creation);
      assert.deepEqual(result.index.aggregates.allTime, data);
      const snapshot = claudeUsageDashboardSnapshot(result.index, { now, achievementMoneyBackend: 'anthropic' });
      assert.deepEqual(snapshot.allTime, data);
      assert.deepEqual(snapshot.dailyForAllTime.map(day => day.data), [data]);
      assert.deepEqual(snapshot.sessions.map(session => session.data), [data]);
      const money = snapshot.achievementMoney!;
      assert.equal(money.cumulative?.status, 'complete');
      assert.equal(money.cumulative?.totalTokens, processed);
      assert.equal(money.cumulative?.pricedTokens, processed);
      assert.equal(money.cumulative?.microUsd, microUsd);
      assert.equal(money.completedMondayWeekPeak, microUsd);
      assert.equal(money.maxSessionTask, microUsd);
      return snapshot;
    };
    const initial = await check(100, 100, 680);
    const initialJson = JSON.stringify(initial);
    const mixed: Usage = { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 11,
      cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 } };
    await appendFile(file, line(row('tail', mixed)));
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.equal(result.diagnostics.bodyReads, 1);
    await check(150, 171, 1110);
    await appendFile(file, line(row('initial', { ...writes,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 100 } })));
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    await check(250, 271, 1730);
    assert.equal(result.records.length, 2, 'larger normalized response replaces rather than doubles its predecessor');
    assert.equal(JSON.stringify(initial), initialJson, 'published snapshots stay immutable');
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.equal(result.diagnostics.bodyReads, 0);
    assert.equal(result.diagnostics.linesParsed, 0);
    await check(250, 271, 1730);
  } finally {
    I18n.setTimezone(previousZone);
    await rm(root, { recursive: true, force: true });
  }
});
