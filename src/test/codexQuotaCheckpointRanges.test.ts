import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createEmptyCodexIndex, updateCodexIndex, normalizeCodexIndex } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { CodexProvider } from '../providers/codex/codexProvider';

const now = Date.parse('2026-10-20T00:00:00Z'), reset = now + 6 * 86400000;
function token(n: number, input: number, used = 10 + n) {
  return JSON.stringify({ type: 'event_msg', timestamp: new Date(now + n * 1000).toISOString(),
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, output_tokens: 2 } },
      rate_limits: { limit_id: 'codex', secondary: { used_percent: used, window_minutes: 10080, resets_at: reset } } } }) + '\n';
}
const context = JSON.stringify({ type: 'turn_context', timestamp: new Date(now).toISOString(), payload: { model: 'gpt-5' } }) + '\n';
async function setup(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-quota-range-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', 'synthetic.jsonl');
  const options = { salt: 'numeric-range-fixture', timeZone: 'UTC', now: () => now + 100000, allowAchievementHourProof: false };
  const manifest = () => scanCodexManifest(root, options.salt);
  const publish = async (result: Awaited<ReturnType<typeof updateCodexIndex>>) => {
    const provider = new CodexProvider({ ...options, codexHome: root, indexPath: path.join(root, 'unused.json'), enabled: true }, () => ({
      refresh: async () => ({ ...result, failedFiles: 0, metadataMs: 0, parseMs: 0 }), dispose() {},
    }));
    t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
    t.after(() => provider.dispose());
    return (await provider.refresh()).snapshot.weeklyValueInputs!;
  };
  return { root, file, options, manifest, publish };
}
test('a witnessed oversized gap does not poison later complete points or a warm future append', async t => {
  const f = await setup(t);
  const oversized = JSON.stringify({ type: 'response_item', timestamp: new Date(now + 2000).toISOString(), padding: 'x'.repeat(1024 * 1024 + 100) }) + '\n';
  await writeFile(f.file, context + token(1, 500) + oversized + token(3, 100) + token(4, 20));
  const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.manifest(), f.options);
  const file = Object.values(cold.index.files)[0];
  assert.ok(file.qualityFlags.includes('oversized-jsonl-line'));
  const inputs = await f.publish(cold);
  const ranges = (inputs as any).codexQuotaIncompleteRanges;
  assert.deepEqual(ranges, [{ from: now + 2000, through: now + 2000 }]);
  assert.equal(inputs.codexQuotaCheckpoints!.find(row => row.through === now + 4000)!.complete, true);
  assert.equal(inputs.codexQuotaCheckpoints!.find(row => row.through === now + 4000)!.byModel['gpt-5'].inputTotal, 20);
  assert.ok(ranges.some((range: any) => range.from <= now + 5000 && range.through > now + 1500));
  assert.ok(!ranges.some((range: any) => range.from <= now + 5000 && range.through > now + 2000));
  assert.ok(!ranges.some((range: any) => range.from < now + 5000 && range.through > now + 3000));
  const loaded = normalizeCodexIndex(JSON.parse(JSON.stringify(cold.index)))!;
  const warm = await updateCodexIndex(loaded, await f.manifest(), f.options);
  assert.equal(warm.bodyReads, 0);
  await appendFile(f.file, token(5, 30));
  const appended = await updateCodexIndex(warm.index, await f.manifest(), f.options);
  const fresh = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.manifest(), f.options);
  assert.deepEqual(Object.values(appended.index.files)[0].quotaCheckpoints, Object.values(fresh.index.files)[0].quotaCheckpoints);
  assert.deepEqual((await f.publish(appended) as any).codexQuotaIncompleteRanges, ranges);
});

test('a fully validated oversized final record has a finite point exclusion, not an ancient open tail', async t => {
  const f = await setup(t);
  const oversized = `{"padding":"${'x'.repeat(1024 * 1024 + 100)}","time\\u0073tamp":"${new Date(now + 2000).toISOString()}"}\n`;
  await writeFile(f.file, context + token(1, 100) + oversized);
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.manifest(), f.options);
  assert.deepEqual((await f.publish(result) as any).codexQuotaIncompleteRanges,
    [{ from: now + 2000, through: now + 2000 }]);
});

test('duplicate root timestamps never narrow an oversized unknown gap to a claimed point', async t => {
  const f = await setup(t);
  const iso = new Date(now + 2000).toISOString();
  const oversized = `{"timestamp":"${iso}","padding":"${'x'.repeat(1024 * 1024 + 100)}","time\\u0073tamp":"${iso}"}\n`;
  await writeFile(f.file, context + token(1, 100) + oversized + token(3, 200) + token(4, 30));
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.manifest(), f.options);
  const inputs = await f.publish(result);
  assert.deepEqual((inputs as any).codexQuotaIncompleteRanges, [{ from: now + 1000, through: now + 3000 }]);
  assert.equal(inputs.codexQuotaCheckpoints!.find(row => row.through === now + 4000)!.complete, true);
});

test('an unknown initial prefix is bounded by the first fresh baseline without poisoning its later delta', async t => {
  const f = await setup(t);
  await writeFile(f.file, 'not-json\n' + context + token(3, 200) + token(4, 30));
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.manifest(), f.options);
  const inputs = await f.publish(result);
  assert.deepEqual((inputs as any).codexQuotaIncompleteRanges, [{ from: 0, through: now + 3000 }]);
  assert.equal(inputs.codexQuotaCheckpoints!.find(row => row.through === now + 4000)!.complete, true);
});
test('an unknown tail is explicit and closes only after a subsequent valid baseline', async t => {
  const f = await setup(t);
  await writeFile(f.file, context + token(1, 100) + 'not-json\n');
  const first = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.manifest(), f.options);
  assert.deepEqual((await f.publish(first) as any).codexQuotaIncompleteRanges,
    [{ from: now + 1000, through: Number.MAX_SAFE_INTEGER }]);
  await appendFile(f.file, token(3, 200) + token(4, 30));
  const next = await updateCodexIndex(first.index, await f.manifest(), f.options);
  assert.deepEqual((await f.publish(next) as any).codexQuotaIncompleteRanges,
    [{ from: now + 1000, through: now + 3000 }]);
});
