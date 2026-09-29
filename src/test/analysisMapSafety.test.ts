import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeLine, finalizeAnalysis, mergeAnalysisAcc, newAnalysisAcc } from '../dataLoader';
import { createClaudeUsageIndex, updateClaudeUsageIndex } from '../claudeIncrementalIndex';

const timestamp = new Date().toISOString();
const keys = ['__proto__', 'constructor', 'toString'];
function prototypeSnapshots(): Map<object, PropertyDescriptorMap> {
  return new Map([Object.prototype, Object, Object.prototype.toString]
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
