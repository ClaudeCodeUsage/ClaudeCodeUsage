import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeLine, ClaudeDataLoader, finalizeAnalysis, mergeAnalysisAcc, newAnalysisAcc } from '../dataLoader';
import { createClaudeUsageIndex, updateClaudeUsageIndex } from '../claudeIncrementalIndex';
import { ClaudeUsageRecord } from '../types';

const timestamp = new Date().toISOString();
const keys = ['__proto__', 'constructor', 'toString'];
function prototypeSnapshots(): Map<object, PropertyDescriptorMap> {
  return new Map([Object.prototype, Object, Object.prototype.toString, Object.prototype.valueOf]
    .map(value => [value, Object.getOwnPropertyDescriptors(value)]));
}
function restoreSyntheticPollution(before: Map<object, PropertyDescriptorMap>): void {
  for (const [value, descriptors] of before) {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (!Object.prototype.hasOwnProperty.call(descriptors, key)) delete (value as any)[key];
    }
  }
}
function toolRows(id: string, name: string, uuid: string): object[] {
  return [
    { type: 'assistant', uuid: `${uuid}-use`, timestamp, message: { role: 'assistant',
      content: [{ type: 'text', text: 'synthetic response' }, { type: 'tool_use', id, name, input: {} }] } },
    { type: 'user', uuid: `${uuid}-result`, timestamp, message: { role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: 'synthetic result' }] } },
  ];
}

test('analysis tool/session keys cannot read or mutate Object.prototype', () => {
  const before = prototypeSnapshots();
  try {
    const source = newAnalysisAcc(0);
    for (const key of keys) for (const row of toolRows(key, key, key)) analyzeLine(row, source, false, key);
    const merged = newAnalysisAcc(0);
    mergeAnalysisAcc(merged, source);
    for (const acc of [source, merged]) {
      const analysis = finalizeAnalysis(acc);
      assert.deepEqual(analysis.toolResultBreakdown.map(row => row.key).sort(), [...keys].sort());
      assert.ok(analysis.toolResultBreakdown.every(row => row.count === 1 && row.estimatedTokens > 0));
      for (const key of keys) {
        assert.ok(Object.prototype.hasOwnProperty.call(analysis.thinkingBySession, key));
        assert.ok(analysis.thinkingBySession[key].assistantTotal > 0);
      }
    }
    for (const [value, descriptors] of before) assert.deepEqual(Object.getOwnPropertyDescriptors(value), descriptors);
  } finally {
    // Restore only synthetic-test pollution from the old implementation, so
    // this failing regression cannot poison unrelated tests in the same realm.
    restoreSyntheticPollution(before);
  }
});

function usageRow(id: string): object {
  return { type: 'assistant', timestamp, requestId: `request-${id}`, message: {
    id: `message-${id}`, model: 'claude-opus-5-5',
    usage: { input_tokens: 100_000, output_tokens: 100, cache_read_input_tokens: 50_000 },
  } };
}

test('prototype-named session files with actual usage survive cold, unchanged and appended indexing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-session-own-keys-'));
  const project = path.join(root, 'projects', '-fixture');
  try {
    await mkdir(project, { recursive: true });
    for (const key of [...keys, 'valueOf']) {
      await writeFile(path.join(project, `${key}.jsonl`), JSON.stringify(usageRow(`cold-${key}`)) + '\n');
    }
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: true });
    assert.equal(cold.records.length, 4);
    assert.deepEqual([...cold.index.sessionRows.keys()].sort(), [...keys, 'valueOf'].sort());
    const unchanged = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: true });
    assert.equal(unchanged.diagnostics.bytesRead, 0);
    await appendFile(path.join(project, '__proto__.jsonl'), JSON.stringify(usageRow('tail')) + '\n');
    const warm = await updateClaudeUsageIndex(unchanged.index, root, { analyzeContent: true });
    assert.equal(warm.records.length, 5);
    assert.equal(warm.index.aggregates.allTime.totalInputTokens, 500_000);
    assert.equal(cold.index.aggregates.allTime.totalInputTokens, 400_000);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('render-time session, workflow, skill, plugin and project grouping cannot mutate prototypes', () => {
  const before = prototypeSnapshots();
  try {
    const records: ClaudeUsageRecord[] = [...keys, 'valueOf'].map((key, index) => ({
      ...usageRow(`render-${index}`) as ClaudeUsageRecord,
      _sessionId: key, _skill: key, _plugin: key, _agentId: key, _agentType: key,
      _workflowId: key, _projectPath: key, _projectName: key,
    }));
    const attribution = ClaudeDataLoader.getUsageAttribution(records, null, { kind: 'day' });
    assert.deepEqual(attribution.skills.map(row => row.key).sort(), [...keys, 'valueOf'].sort());
    assert.deepEqual(attribution.plugins.map(row => row.key).sort(), [...keys, 'valueOf'].sort());
    assert.deepEqual(attribution.subagents.map(row => row.key).sort(), [...keys, 'valueOf'].sort());
    assert.equal(ClaudeDataLoader.getSessionBreakdown(records).length, 4);
    assert.equal(ClaudeDataLoader.getWorkflowBreakdown(records).length, 4);
    assert.equal(ClaudeDataLoader.getCostliestMessages(records).length, 4);
    assert.doesNotThrow(() => ClaudeDataLoader.cacheStatsByModel(records));
    assert.doesNotThrow(() => ClaudeDataLoader.estimateCacheChurnCost(records));
    assert.doesNotThrow(() => ClaudeDataLoader.getProjectBreakdown(records, 60, 'flat'));
    const durations = ClaudeDataLoader.activeDurationBySession(records);
    assert.equal(Object.getPrototypeOf(durations), Object.prototype);
    for (const key of [...keys, 'valueOf']) assert.ok(Object.prototype.hasOwnProperty.call(durations, key));
    for (const [value, descriptors] of before) assert.deepEqual(Object.getOwnPropertyDescriptors(value), descriptors);
  } finally { restoreSyntheticPollution(before); }
});

test('heuristic skill activation keeps prototype-named skill and session keys distinct', () => {
  const before = prototypeSnapshots();
  try {
    const records = [...keys, 'valueOf'].map(key => ({
      ...usageRow(`heuristic-${key}`) as ClaudeUsageRecord, _sessionId: key,
    }));
    const analysis = finalizeAnalysis(newAnalysisAcc(0));
    analysis.skillUses = [...keys, 'valueOf'].map(key => ({
      name: key, sessionId: key, day: '', ts: Date.parse(timestamp) - 1000, estTokens: 100,
    }));
    const result = ClaudeDataLoader.getUsageAttribution(records, analysis, { kind: 'day' });
    assert.equal(result.skills.length, 4);
    assert.ok(result.skills.every(skill => skill.count === 1 && skill.share > 0));
    for (const [value, descriptors] of before) assert.deepEqual(Object.getOwnPropertyDescriptors(value), descriptors);
  } finally { restoreSyntheticPollution(before); }
});

test('prototype-named tool buckets survive cold materialization and a warm append', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-analysis-own-keys-'));
  const project = path.join(root, 'projects', '-fixture');
  const before = prototypeSnapshots();
  try {
    await mkdir(project, { recursive: true });
    const file = path.join(project, '__proto__.jsonl');
    await writeFile(file, keys.flatMap(key => toolRows(key, key, `cold-${key}`)).map(row => JSON.stringify(row)).join('\n') + '\n');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: true });
    assert.ok(cold.contentAnalysis);
    assert.equal(cold.contentAnalysis.toolResultBreakdown.length, 3);
    const coldSnapshot = JSON.stringify(cold.contentAnalysis);
    await appendFile(file, toolRows('tail-id', '__proto__', 'tail').map(row => JSON.stringify(row)).join('\n') + '\n');
    const warm = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: true });
    assert.ok(warm.contentAnalysis);
    assert.equal(warm.contentAnalysis.toolResultBreakdown.find(row => row.key === '__proto__')!.count, 2);
    assert.equal(JSON.stringify(cold.contentAnalysis), coldSnapshot);
    for (const [value, descriptors] of before) assert.deepEqual(Object.getOwnPropertyDescriptors(value), descriptors);
  } finally {
    restoreSyntheticPollution(before);
    await rm(root, { recursive: true, force: true });
  }
});
