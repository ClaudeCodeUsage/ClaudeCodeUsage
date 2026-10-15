import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { createEmptyCodexIndex, updateCodexIndex, runCodexFilePass, codexHourProofSnapshot,
  saveCodexIndexAtomic, loadCodexIndex } from '../providers/codex/codexIndex';

const native = typeof zlib.createZstdDecompress === 'function';
const time = (second: number) => `2026-07-20T00:00:0${second}.000Z`;
const usage = (n: number, second: number) => ({ timestamp: time(second), type: 'event_msg', payload: {
  type: 'token_count', info: {
    total_token_usage: { input_tokens: 100 * n, cached_input_tokens: 50 * n, output_tokens: 30 * n, reasoning_output_tokens: 10 * n, total_tokens: 130 * n },
    last_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: 130 },
  },
} });
function contents(child: boolean): Buffer {
  return Buffer.from([
    { timestamp: time(0), type: 'session_meta', payload: { id: child ? 'child' : 'parent', cwd: '/anonymous/fixture',
      source: child ? { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } : 'cli' } },
    { timestamp: time(1), type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } },
    usage(1, 2), ...(child ? [usage(2, 3)] : []),
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
}
function packed(bytes: Buffer): Buffer {
  const header = Buffer.alloc(12); header.writeUInt32LE(0xfd2fb528); header[4] = 0xa0;
  header.writeUInt32LE(bytes.length, 5); header.writeUIntLE((bytes.length << 3) | 1, 9, 3);
  return Buffer.concat([header, bytes]);
}

for (const parallel of [false, true]) test(`compressed parent/child copied prefixes remain equivalent (${parallel ? 'file-pass tasks' : 'serial'})`, { skip: !native }, async () => {
  const totals: unknown[] = [];
  for (const formats of [[false, false], [true, false], [false, true], [true, true]]) {
    const home = await mkdtemp(path.join(os.tmpdir(), 'ccu-zstd-lineage-'));
    try {
      await mkdir(path.join(home, 'sessions'));
      for (let i = 0; i < 2; i++) {
        const bytes = contents(i === 1);
        await writeFile(path.join(home, 'sessions', `${i ? 'child' : 'parent'}.jsonl${formats[i] ? '.zst' : ''}`), formats[i] ? packed(bytes) : bytes);
      }
      const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(home, 'fixture-salt'), {
        salt: 'fixture-salt', timeZone: 'UTC', asOfDay: '2026-07-22', budget: { maxFilePasses: 100, maxBytes: 64 * 1024 * 1024 },
        ...(parallel ? { filePassBatch: async (tasks, apply) => {
          for (const task of tasks) await apply(await runCodexFilePass(task));
        } } : {}),
      });
      assert.equal(result.failedFiles, 0); assert.equal(result.index.coverage.complete, true);
      assert.equal(result.index.aggregate.total.inputTotal + result.index.aggregate.total.outputTotal, 260);
      const child = Object.values(result.index.files).find(file => file.aggregate.session.parentSessionKey)!;
      assert.equal(child.lineage?.desiredPrefixEvents, 1); assert.equal(child.lineage?.appliedPrefixEvents, 1);
      totals.push({ aggregate: result.index.aggregate, hourProof: codexHourProofSnapshot(result.index) });
    } finally { await rm(home, { recursive: true, force: true }); }
  }
  for (const value of totals) assert.deepEqual(value, totals[0]);
});

test('restoring a compressed parent reattributes an already indexed child instead of adding inherited usage twice', { skip: !native }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ccu-zstd-parent-restored-'));
  try {
    await mkdir(path.join(home, 'sessions'));
    await writeFile(path.join(home, 'sessions', 'child.jsonl'), contents(true));
    const options = { salt: 'fixture-salt', timeZone: 'UTC', asOfDay: '2026-07-22',
      budget: { maxFilePasses: 100, maxBytes: 64 * 1024 * 1024 } };
    const childOnly = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(home, options.salt), options);
    assert.equal(childOnly.index.aggregate.total.inputTotal + childOnly.index.aggregate.total.outputTotal, 260);
    assert.ok(Object.values(childOnly.index.files)[0].qualityFlags.includes('missing-parent'));
    const target = path.join(home, 'derived-index.json'); await saveCodexIndexAtomic(target, childOnly.index);
    await writeFile(path.join(home, 'sessions', 'parent.jsonl.zst'), packed(contents(false)));
    const restored = await updateCodexIndex(await loadCodexIndex(target), await scanCodexManifest(home, options.salt), options);
    assert.equal(restored.failedFiles, 0); assert.equal(restored.index.coverage.complete, true);
    assert.equal(restored.index.aggregate.total.inputTotal + restored.index.aggregate.total.outputTotal, 260);
    const child = Object.values(restored.index.files).find(file => file.aggregate.session.parentSessionKey)!;
    assert.equal(child.lineage?.desiredPrefixEvents, 1); assert.equal(child.lineage?.appliedPrefixEvents, 1);
    assert.ok(!child.qualityFlags.includes('missing-parent')); assert.equal(restored.achievementUsageDelta, undefined);
  } finally { await rm(home, { recursive: true, force: true }); }
});
