import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { addCodexOriginEvent, emptyCodexUsageDelta, finalizeCodexUsageDelta } from '../providers/codex/codexAchievementOrigin';
import { createEmptyCodexIndex, updateCodexIndex } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import type { CodexIndexV3 } from '../providers/codex/codexIndex';
import type { NormalizedUsageEvent } from '../providers/providerTypes';

const window = { after: Date.parse('2026-10-09T01:00:00Z'), through: Date.parse('2026-10-09T02:00:00Z') };
const tokens = { inputTotal: 10, cachedInput: 4, outputTotal: 2 };
const familyLabels = [
  ['gpt-6-sol', 'sol'], ['openai/gpt-6-sol', 'sol'], ['openai/gpt-6.1-astra', 'astra'],
  ['gpt-6.2-sol', 'sol'], ['openai/gpt-6-luna-2026-09-01', 'luna'],
  [' GPT-6-SOL ', 'sol'], [' OPENAI/GPT-6.1-ASTRA ', 'astra'],
] as const;
const rejectedLabels = ['gpt-6-sol-custom', 'gpt-6-sol-', 'openai/gpt-6-sol-custom',
  'gpt-6-sol-2026-09-01-custom', 'proxy/gpt-6-sol', 'unknown', ' GPT-6-SOL-CUSTOM '];
function event(model: string): NormalizedUsageEvent {
  return { provider: 'codex', sourceKind: 'local-jsonl', schemaVariant: 'fixture', timestamp: window.after + 1,
    sessionKey: 'fixture', model, tokens: { ...tokens }, confidence: 'exact', qualityFlags: [] };
}

test('origin events admit strict family aliases and future snapshots without changing totals or money', () => {
  for (const [model, family] of familyLabels) {
    const delta = emptyCodexUsageDelta(window);
    assert.equal(addCodexOriginEvent(delta, event(model)), true);
    assert.equal(delta.families[family], 12, model);
    assert.equal(delta.processed, 12); assert.equal(delta.output, 2); assert.equal(delta.cacheRead, 4);
    if (model === 'gpt-6-sol' || model === 'openai/gpt-6-sol') {
      assert.equal(delta.money?.openai?.microUsd, 32);
      assert.equal(delta.money?.openai?.eligibleProcessed, 12);
    }
    if (model.includes('6.2-sol') || model.includes('2026-09-01') || model.startsWith(' ')) {
      assert.equal(delta.money, undefined, 'nonmoney normalization never expands monetary alias admission');
    }
  }
  const native = emptyCodexUsageDelta(window), alias = emptyCodexUsageDelta(window);
  addCodexOriginEvent(native, event('gpt-6-sol'));
  addCodexOriginEvent(alias, event('openai/gpt-6-sol'));
  assert.deepEqual(alias, native, 'known aliases preserve exact money proof and global counters');
});

test('origin events retain global usage but withhold family and money for custom/dangling labels', () => {
  for (const model of rejectedLabels) {
    const delta = emptyCodexUsageDelta(window);
    assert.equal(addCodexOriginEvent(delta, event(model)), true);
    assert.deepEqual(delta.families, { astra: 0, sol: 0, luna: 0 }, model);
    assert.equal(delta.processed, 12); assert.equal(delta.output, 2); assert.equal(delta.cacheRead, 4);
    assert.equal(delta.money, undefined);
  }
});

async function withIndexes(run: (before: CodexIndexV3, after: CodexIndexV3, key: string) => void): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-origin-models-'));
  const salt = 'origin-model-test';
  try {
    const sessions = path.join(root, 'sessions'); await mkdir(sessions);
    const log = path.join(sessions, 'usage.jsonl');
    const tokenLine = (multiple: number, timestamp: string) => JSON.stringify({ type: 'event_msg', timestamp,
      payload: { type: 'token_count', info: {
        total_token_usage: { input_tokens: 10 * multiple, cached_input_tokens: 4 * multiple, output_tokens: 2 * multiple },
        last_token_usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 },
      } } }) + '\n';
    await writeFile(log, JSON.stringify({ type: 'session_meta', payload: { id: 'root', cwd: '/fixture' } }) + '\n'
      + JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-sol' } }) + '\n'
      + tokenLine(1, '2026-10-09T00:00:00Z'));
    const options = { salt, timeZone: 'UTC', now: () => window.through, achievementUsageWindow: window };
    let baseline = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(root, salt), options);
    for (let i = 0; baseline.migration.pending && i < 6; i++) {
      baseline = await updateCodexIndex(baseline.index, await scanCodexManifest(root, salt), options);
    }
    await appendFile(log, tokenLine(2, '2026-10-09T01:30:00Z'));
    const live = await updateCodexIndex(baseline.index, await scanCodexManifest(root, salt), options);
    assert.equal(live.achievementUsageDelta?.processed, 12, 'fixture has settled live append proof');
    run(baseline.index, live.index, Object.keys(live.index.files)[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
}

function relabel(index: CodexIndexV3, key: string, model: string): CodexIndexV3 {
  const copy = structuredClone(index);
  copy.files[key].aggregate.byModel = { [model]: { ...copy.files[key].aggregate.total } };
  return copy;
}

test('aggregate origin reconciliation admits the same canonical family aliases and unpriced snapshots', async () => {
  await withIndexes((before, after, key) => {
    for (const [model, family] of familyLabels) {
      const delta = { ...emptyCodexUsageDelta(window), processed: 12, output: 2, cacheRead: 4 };
      delta.families[family] = 12;
      const result = finalizeCodexUsageDelta(relabel(before, key, model), relabel(after, key, model), new Map([[key, delta]]), window);
      assert.deepEqual(result, delta, model);
    }
  });
});

test('aggregate custom labels cannot validate a claimed family delta but retain global-only proof', async () => {
  await withIndexes((before, after, key) => {
    for (const model of rejectedLabels) {
      const old = relabel(before, key, model), next = relabel(after, key, model);
      const global = { ...emptyCodexUsageDelta(window), processed: 12, output: 2, cacheRead: 4 };
      assert.deepEqual(finalizeCodexUsageDelta(old, next, new Map([[key, global]]), window), global, model);
      const claimed = { ...global, families: { astra: 0, sol: 12, luna: 0 } };
      assert.equal(finalizeCodexUsageDelta(old, next, new Map([[key, claimed]]), window), undefined, model);
    }
  });
});
