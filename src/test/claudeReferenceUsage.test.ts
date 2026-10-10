import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ClaudeDataLoader } from '../dataLoader';
import { claudeUsageDashboardSnapshot, createClaudeUsageIndex, updateClaudeUsageIndex } from '../claudeIncrementalIndex';
import { I18n } from '../i18n';
import { calculateCostBreakdown } from '../pricing';
import { ClaudeUsageRecord, UsageData } from '../types';

const model = 'claude-sonnet-4-5';
const timestamp = '2026-10-09T08:00:00.000Z';
const known = {
  input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 13,
  cache_creation_input_tokens: 8,
  cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 5 },
};
const vector = {
  inputTokens: 11, outputTokens: 7, cacheReadTokens: 13,
  cacheCreation5mTokens: 3, cacheCreation1hTokens: 5,
};

function record(id: string, usage: object = known, label = model): ClaudeUsageRecord {
  return { timestamp, requestId: `request-${id}`, message: {
    id: `message-${id}`, model: label, usage: usage as ClaudeUsageRecord['message']['usage'],
  } };
}

function reference(data: UsageData, label = model): unknown {
  return data.modelBreakdown[label]?.referenceUsage;
}

function primary(data: UsageData): UsageData {
  const copy = structuredClone(data);
  for (const bucket of Object.values(copy.modelBreakdown)) {
    delete (bucket as { referenceUsage?: unknown }).referenceUsage;
  }
  return copy;
}

test('referenceUsage retains a reliable TTL subset without changing primary tokens or cost', () => {
  const unknownTTL = { ...known, cache_creation: undefined };
  const rows = [record('known'), record('old', unknownTTL), record('future', known, 'future-unpriced-model')];
  const actual = ClaudeDataLoader.calculateUsageData(rows);
  assert.deepEqual(reference(actual), vector);
  assert.deepEqual(reference(actual, 'future-unpriced-model'), vector, 'price availability is independent');
  const parts = calculateCostBreakdown(known, model);
  const oldParts = calculateCostBreakdown(unknownTTL, model);
  const futureParts = calculateCostBreakdown(known, 'future-unpriced-model');
  const cost = (part: typeof parts) => part.input + part.output + part.cacheWrite + part.cacheRead;
  assert.deepEqual(primary(actual), {
    totalInputTokens: 33, totalOutputTokens: 21, totalCacheCreationTokens: 24, totalCacheReadTokens: 39,
    totalCost: cost(parts) + cost(oldParts) + cost(futureParts), messageCount: 0,
    costBreakdown: {
      input: parts.input + oldParts.input + futureParts.input,
      output: parts.output + oldParts.output + futureParts.output,
      cacheWrite: parts.cacheWrite + oldParts.cacheWrite + futureParts.cacheWrite,
      cacheRead: parts.cacheRead + oldParts.cacheRead + futureParts.cacheRead,
    },
    modelBreakdown: {
      [model]: { inputTokens: 22, outputTokens: 14, cacheCreationTokens: 16, cacheReadTokens: 26,
        cost: cost(parts) + cost(oldParts), count: 2 },
      'future-unpriced-model': { inputTokens: 11, outputTokens: 7, cacheCreationTokens: 8, cacheReadTokens: 13,
        cost: cost(futureParts), count: 1 },
    },
  });
});

test('referenceUsage requires safe native components and a complete consistent split', () => {
  const invalid: object[] = [
    { ...known, cache_creation: undefined },
    { ...known, cache_creation: {} },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: 3 } },
    { ...known, cache_creation: { ephemeral_1h_input_tokens: 5 } },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: 9 } },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 4 } },
    { ...known, cache_creation_input_tokens: undefined },
    { ...known, cache_creation_input_tokens: 0 },
    { ...known, cache_creation: null },
    { ...known, cache_creation: [] },
    { ...known, cache_creation: 8 },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: -1, ephemeral_1h_input_tokens: 9 } },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: 3.5, ephemeral_1h_input_tokens: 4.5 } },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: '3', ephemeral_1h_input_tokens: 5 } },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: null } },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: Number.MAX_SAFE_INTEGER + 1, ephemeral_1h_input_tokens: 0 } },
  ];
  const malformedSplits = [...invalid];
  for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, null, '1']) {
      invalid.push({ ...known, [key]: value });
    }
  }
  for (const [id, usage] of invalid.entries()) {
    const actual = ClaudeDataLoader.calculateUsageData([record(String(id), usage)]);
    assert.equal(reference(actual), undefined, JSON.stringify(usage));
  }
  for (const [id, usage] of malformedSplits.entries()) {
    const row = record(`primary-${id}`, usage);
    const data = ClaudeDataLoader.calculateUsageData([row]);
    const parts = calculateCostBreakdown(row.message.usage, model);
    assert.equal(data.totalInputTokens, 11);
    assert.equal(data.totalOutputTokens, 7);
    assert.equal(data.totalCacheReadTokens, 13);
    assert.equal(data.totalCacheCreationTokens, row.message.usage.cache_creation_input_tokens || 0);
    assert.deepEqual(data.costBreakdown, parts);
    assert.equal(data.totalCost, parts.input + parts.output + parts.cacheWrite + parts.cacheRead);
    assert.equal(data.modelBreakdown[model].count, 1);
  }
  for (const usage of [
    { input_tokens: 11, output_tokens: 7 },
    { input_tokens: 11, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    { input_tokens: 11, output_tokens: 7, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } },
  ]) {
    assert.deepEqual(reference(ClaudeDataLoader.calculateUsageData([record('zero', usage)])), {
      inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
    });
  }
  for (const usage of [
    { ...known, cache_creation: { ephemeral_5m_input_tokens: 8, ephemeral_1h_input_tokens: 0 } },
    { ...known, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 8 } },
  ]) assert.ok(reference(ClaudeDataLoader.calculateUsageData([record('ttl', usage)])));
  const excluded = [
    { ...record('error'), isApiErrorMessage: true }, record('synthetic', known, '<synthetic>'),
    { ...record('prompt'), _isUserPrompt: true }, record('absent', known, ''),
    record('empty', { input_tokens: 0, output_tokens: 0 }),
  ];
  assert.deepEqual(ClaudeDataLoader.calculateUsageData(excluded).modelBreakdown, {});
});

test('referenceUsage proves a missing TTL is zero only when known counts equal safe flat creation', () => {
  for (const [split, creation, fiveM, oneH] of [
    [{ ephemeral_5m_input_tokens: 8 }, 8, 8, 0],
    [{ ephemeral_1h_input_tokens: 8 }, 8, 0, 8],
    [{}, 0, 0, 0],
    [{ ephemeral_5m_input_tokens: 0 }, 0, 0, 0],
    [{ ephemeral_1h_input_tokens: 0 }, 0, 0, 0],
  ] as const) {
    const usage = { ...known, cache_creation_input_tokens: creation, cache_creation: split };
    const actual = ClaudeDataLoader.calculateUsageData([record('provable-zero', usage)]);
    assert.deepEqual(reference(actual), { ...vector, cacheCreation5mTokens: fiveM, cacheCreation1hTokens: oneH });
    assert.deepEqual(actual.costBreakdown, calculateCostBreakdown(usage, model));
    assert.equal(actual.totalCacheCreationTokens, creation);
  }
});

test('referenceUsage rejects every unknown TTL field and preserves malformed zero-write rejection', () => {
  for (const usage of [
    ...[0, 3, null, '0'].map(value => ({ ...known,
      cache_creation: { ...known.cache_creation, ephemeral_2h_input_tokens: value } })),
    { ...known, cache_creation: { ...known.cache_creation, extra: 0 } },
    { ...known, cache_creation_input_tokens: 0, cache_creation: { ephemeral_2h_input_tokens: 0 } },
    ...[null, [], 0, false, ''].map(split => ({ ...known, cache_creation_input_tokens: 0, cache_creation: split })),
  ]) {
    assert.equal(reference(ClaudeDataLoader.calculateUsageData([record('unknown-field', usage)])), undefined,
      JSON.stringify(usage));
  }
});

test('normal Full and incremental parsing retain unknown or malformed TTL exclusion without changing primary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-reference-ttl-shape-'));
  try {
    const directory = path.join(root, 'projects', '-fixture-reference');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'session.jsonl');
    const usages = [
      { ...known, cache_creation: { ephemeral_5m_input_tokens: 8 } },
      { ...known, cache_creation: { ephemeral_1h_input_tokens: 8 } },
      { ...known, cache_creation_input_tokens: 0, cache_creation: {} },
      { ...known, cache_creation: { ...known.cache_creation, ephemeral_2h_input_tokens: 3 } },
      { ...known, cache_creation: { ...known.cache_creation, ephemeral_2h_input_tokens: 0 } },
      { ...known, cache_creation: { ephemeral_5m_input_tokens: 3 } },
      ...[null, [], 0, false, ''].map(split => ({ ...known, cache_creation_input_tokens: 0, cache_creation: split })),
    ];
    const rows = usages.map((usage, id) => record(`shape-${id}`, usage));
    await writeFile(file, rows.map(line).join(''));
    const expected = { ...vector, inputTokens: 33, outputTokens: 21, cacheReadTokens: 39,
      cacheCreation5mTokens: 8, cacheCreation1hTokens: 8 };
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false });
    const fullData = ClaudeDataLoader.calculateUsageData(full.records);
    assert.deepEqual(reference(fullData), expected);
    assert.deepEqual(primary(fullData), primary(ClaudeDataLoader.calculateUsageData(rows)));
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false });
    assert.deepEqual(cold.index.aggregates.allTime, fullData);
    await appendFile(file, line(record('shape-tail', usages[0])));
    const appended = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: false });
    assert.deepEqual(reference(appended.index.aggregates.allTime), { ...expected,
      inputTokens: 44, outputTokens: 28, cacheReadTokens: 52, cacheCreation5mTokens: 16 });
    assert.equal(appended.diagnostics.bodyReads, 1);
    const warm = await updateClaudeUsageIndex(appended.index, root, { analyzeContent: false });
    assert.equal(warm.diagnostics.bodyReads, 0);
    assert.equal(warm.diagnostics.linesParsed, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workflow referenceUsage follows canonical response replacements and compacted malformed splits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-reference-workflow-'));
  try {
    const directory = path.join(root, 'projects', '-fixture-reference', 'session', 'subagents', 'workflows', 'wf_reference');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'agent-reference.jsonl');
    const malformed = [
      { ...known, cache_creation_input_tokens: undefined },
      { ...known, cache_creation_input_tokens: 0 },
      { ...known, cache_creation: { ephemeral_5m_input_tokens: 3 } },
      { ...known, cache_creation: null },
      { ...known, cache_read_input_tokens: -1 },
    ];
    await writeFile(file, line(record('canonical')) +
      malformed.map((usage, id) => line(record(`malformed-${id}`, usage))).join(''));
    let result = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false });
    const check = async (expected: unknown) => {
      const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false });
      const expectedData = ClaudeDataLoader.calculateUsageData(full.records);
      assert.deepEqual(stable(result.index.aggregates.allTime), stable(expectedData));
      assert.deepEqual(stable(result.index.aggregates.byWorkflow.get('wf_reference')), stable(expectedData));
      assert.deepEqual(reference(result.index.aggregates.byWorkflow.get('wf_reference')!), expected);
      const snapshot = claudeUsageDashboardSnapshot(result.index, { projectGroupingMode: 'flat' });
      assert.deepEqual(stable(snapshot.workflows), stable(ClaudeDataLoader.getWorkflowBreakdown(full.records)));
      assert.deepEqual(reference(snapshot.workflows[0].data), expected);
      assert.equal(full.records.length, 6, 'snapshots of the same response remain one canonical record');
      return snapshot;
    };
    const prior = await check(vector);
    const priorJson = JSON.stringify(prior);
    deepFreeze(prior);
    deepFreeze(result.index.aggregates.byWorkflow.get('wf_reference'));
    await appendFile(file, line(record('canonical', { ...known, output_tokens: 9 })));
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.equal(result.diagnostics.bodyReads, 1);
    await check({ ...vector, outputTokens: 9 });
    await appendFile(file, line(record('canonical', { ...known, output_tokens: 12, cache_creation: undefined })));
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    await check(undefined);
    assert.equal(JSON.stringify(prior), priorJson);
    const warm = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.equal(warm.diagnostics.bodyReads, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function line(row: ClaudeUsageRecord): string {
  return JSON.stringify({ type: 'assistant', cwd: '/fixture/reference', gitBranch: 'main', ...row }) + '\n';
}

function stable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === 'number' ? Math.round(item * 1e12) / 1e12 : item));
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

test('incremental referenceUsage matches Full across dedup, append, truncate, delete and preserves snapshots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-reference-'));
  const savedZone = I18n.getTimezone();
  const savedNow = Date.now;
  I18n.setTimezone('UTC');
  Date.now = () => Date.parse(timestamp) + 60_000;
  try {
    const project = path.join(root, 'projects', '-fixture-reference');
    await mkdir(project, { recursive: true });
    const file = path.join(project, 'session.jsonl');
    const duplicateFile = path.join(project, 'duplicate.jsonl');
    const initial = line(record('known')) + line(record('unknown', { ...known, cache_creation: undefined }));
    await writeFile(file, initial);
    await writeFile(duplicateFile, line(record('known')));
    let result = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false });
    const check = async () => {
      const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false });
      assert.equal(full.diagnostics.filesFailed, 0);
      assert.deepEqual(stable(result.index.aggregates.allTime), stable(ClaudeDataLoader.calculateUsageData(full.records)));
      const snapshot = claudeUsageDashboardSnapshot(result.index, { now: new Date(Date.now()), projectGroupingMode: 'flat' });
      assert.deepEqual(stable(snapshot.sessions), stable(ClaudeDataLoader.getSessionBreakdown(full.records)));
      assert.deepEqual(stable(snapshot.projects), stable(ClaudeDataLoader.getProjectBreakdown(full.records, 60, 'flat')));
      assert.deepEqual(stable(snapshot.dailyForAllTime), stable(ClaudeDataLoader.getDailyDataForSpecificMonth(full.records, '2026-10')));
      assert.deepEqual(stable(snapshot.hourlyForToday), stable(ClaudeDataLoader.getHourlyDataForDate(full.records, '2026-10-09')));
      assert.deepEqual(stable(snapshot.branches), stable(ClaudeDataLoader.getBranchBreakdown(full.records)));
      const groups: [Map<string, UsageData>, (row: ClaudeUsageRecord) => string][] = [
        [result.index.aggregates.bySession, row => row._sessionId || 'unknown'],
        [result.index.aggregates.byProject, row => (row._projectPath || row._projectName || 'unknown').toLowerCase()],
        [result.index.aggregates.byLocalDay, row => row.timestamp.slice(0, 10)],
        [result.index.aggregates.byDay, row => row.timestamp.slice(0, 10)],
        [result.index.aggregates.byMonth, row => row.timestamp.slice(0, 7)],
        [result.index.aggregates.byLocalHour, row => `${row.timestamp.slice(0, 10)}\0${row.timestamp.slice(11, 13)}:00`],
        [result.index.aggregates.byProjectDay, row => `${ClaudeDataLoader.normalizePath(row._projectPath || row._projectName || 'unknown')}\0${row.timestamp.slice(0, 10)}`],
        [result.index.aggregates.byBranch, row => `${row._projectName || 'unknown'}\0${row._gitBranch || '-'}`],
      ];
      for (const [buckets, key] of groups) for (const [id, data] of buckets) {
        assert.deepEqual(stable(data), stable(ClaudeDataLoader.calculateUsageData(full.records.filter(row => key(row) === id))));
      }
      return snapshot;
    };
    const old = await check();
    assert.deepEqual(reference(old.allTime), vector);
    const oldJson = JSON.stringify(old);
    const coldAggregate = JSON.stringify(result.index.aggregates.allTime);
    const oldIndex = result.index;
    deepFreeze(old);
    deepFreeze(oldIndex.aggregates.allTime);
    for (const buckets of Object.values(oldIndex.aggregates)) {
      if (buckets instanceof Map) for (const bucket of buckets.values()) deepFreeze(bucket);
    }
    const tail = line(record('hour', {
      ...known, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 8 },
    })) + line(record('known'));
    await appendFile(file, tail);
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.equal(result.diagnostics.bodyReads, 1);
    assert.equal(result.diagnostics.bytesRead, Buffer.byteLength(tail));
    assert.equal(JSON.stringify(old), oldJson);
    assert.equal(JSON.stringify(oldIndex.aggregates.allTime), coldAggregate);
    assert.deepEqual(reference((await check()).allTime), { ...vector, inputTokens: 22, outputTokens: 14,
      cacheReadTokens: 26, cacheCreation1hTokens: 13 });
    const warm = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.equal(warm.diagnostics.bodyReads, 0);
    assert.equal(warm.diagnostics.bytesRead, 0);
    assert.equal(warm.diagnostics.linesParsed, 0);
    result = warm;
    await check();
    await writeFile(file, line(record('unknown', { ...known, cache_creation: undefined })));
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.deepEqual(reference((await check()).allTime), vector, 'duplicate becomes canonical after truncation');
    await unlink(duplicateFile);
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.equal(reference((await check()).allTime), undefined, 'subtract the last reliable record from a partial bucket');
    assert.equal(result.index.aggregates.allTime.totalInputTokens, 11);
    await unlink(file);
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.deepEqual((await check()).allTime.modelBreakdown, {});
    assert.equal(JSON.stringify(old), oldJson);
  } finally {
    Date.now = savedNow;
    I18n.setTimezone(savedZone);
    await rm(root, { recursive: true, force: true });
  }
});

test('referenceUsage snapshot clones own nested vectors, including historical hourly rebucketing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-reference-cutoff-'));
  const savedZone = I18n.getTimezone();
  const savedNow = Date.now;
  let now = Date.parse(timestamp);
  I18n.setTimezone('UTC');
  Date.now = () => now;
  try {
    const project = path.join(root, 'projects', '-fixture-reference');
    await mkdir(project, { recursive: true });
    const historical = { ...record('historical'), timestamp: '2026-08-01T08:00:00.000Z' };
    await writeFile(path.join(project, 'session.jsonl'), line(historical));
    let result = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: true });
    assert.equal(result.index.aggregates.byLocalHour.size, 0);
    const prior = claudeUsageDashboardSnapshot(result.index, { now: new Date(now), projectGroupingMode: 'flat' });
    const priorJson = JSON.stringify(prior);
    now = Date.parse(historical.timestamp) + 60_000;
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: true });
    const snapshot = claudeUsageDashboardSnapshot(result.index, { now: new Date(now), projectGroupingMode: 'flat' });
    assert.equal(JSON.stringify(prior), priorJson);
    assert.deepEqual(reference(snapshot.hourlyForToday[0].data), vector);
    assert.deepEqual(stable(snapshot.hourlyForToday), stable(ClaudeDataLoader.getHourlyDataForDate(result.records, '2026-08-01')));
    const original = result.index.aggregates.allTime.modelBreakdown[model].referenceUsage!;
    for (const data of [snapshot.allTime, snapshot.today, snapshot.month, snapshot.last30Days,
      snapshot.dailyForAllTime[0].data, snapshot.dailyForMonth[0].data,
      snapshot.monthlyForAllTime[0].data, snapshot.hourlyForToday[0].data]) {
      const cloned = data.modelBreakdown[model].referenceUsage!;
      assert.notStrictEqual(cloned, original);
      assert.deepEqual(cloned, vector);
    }
    snapshot.allTime.modelBreakdown[model].referenceUsage!.inputTokens = 999;
    assert.deepEqual(original, vector);
    assert.deepEqual(reference(snapshot.today), vector);
    I18n.setTimezone('Asia/Shanghai');
    result = await updateClaudeUsageIndex(result.index, root, { analyzeContent: false });
    assert.equal(result.diagnostics.bodyReads, 0, 'existing timezone reaggregation uses retained records');
    const rebucketed = claudeUsageDashboardSnapshot(result.index, { now: new Date(now), projectGroupingMode: 'flat' });
    assert.deepEqual(reference(rebucketed.today), vector);
    assert.deepEqual(stable(rebucketed.hourlyForToday), stable(ClaudeDataLoader.getHourlyDataForDate(result.records, '2026-08-01')));
    assert.equal(JSON.stringify(prior), priorJson);
  } finally {
    Date.now = savedNow;
    I18n.setTimezone(savedZone);
    await rm(root, { recursive: true, force: true });
  }
});
