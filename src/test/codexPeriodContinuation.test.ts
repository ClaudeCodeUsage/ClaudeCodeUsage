import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CODEX_REFRESH_MIN_BYTES, CodexIndexCancelledError, createEmptyCodexIndex,
  loadCodexIndex, runCodexFilePass, saveCodexIndexAtomic, updateCodexIndex,
  type CodexFilePassBatchRunner, type CodexIndexIo, type CodexIndexV1,
} from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { CodexProvider } from '../providers/codex/codexProvider';
import { codexAchievementCalendarProjection } from '../achievementCalendar';

const SALT = 'period-continuation-fixture';
const now = () => Date.parse('2026-10-13T00:00:00Z');
const options = { salt: SALT, timeZone: 'UTC', now };
const budget = { maxFilePasses: 2, maxBytes: CODEX_REFRESH_MIN_BYTES };
const meta = (id: string, parent?: string) => JSON.stringify({
  timestamp: '2026-10-05T00:00:00Z', type: 'session_meta', payload: { id,
    ...(parent ? { source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } : {}) },
});
const context = JSON.stringify({ timestamp: '2026-10-05T00:00:01Z', type: 'turn_context',
  payload: { model: 'gpt-6.1-sol', effort: 'high' } });
const token = (n: number, day = '2026-10-05') => JSON.stringify({
  timestamp: `${day}T00:0${n}:00Z`, type: 'event_msg', payload: { type: 'token_count',
    info: { total_token_usage: { input_tokens: n * 1_000_000, output_tokens: n,
      cached_input_tokens: 0, total_tokens: n * 1_000_000 + n } } },
});

async function fixture(children = 2) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-period-prefix-'));
  await mkdir(path.join(root, 'sessions'));
  await writeFile(path.join(root, 'sessions', 'root.jsonl'),
    [meta('root'), context, token(1), token(2), ''].join('\n'));
  for (let i = 0; i < children; i++) {
    // A bounded pass stops before the second inherited event. Blank lines
    // exercise byte budgets without source conversations or oversized lines.
    await writeFile(path.join(root, 'sessions', `child-${i}.jsonl`),
      [meta(`child-${i}`, 'root'), context, token(1), ' \n'.repeat(CODEX_REFRESH_MIN_BYTES),
        token(2), token(3 + i, '2026-10-06'), ''].join('\n'));
  }
  const manifest = await scanCodexManifest(root, SALT);
  const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, options);
  assert.equal(cold.index.coverage.complete, true);
  const childKeys = Object.keys(cold.index.files).filter(key =>
    cold.index.files[key].aggregate.session.parentSessionKey !== undefined);
  const legacy = structuredClone(cold.index);
  for (const key of childKeys) {
    assert.equal(legacy.files[key].lineage!.desiredPrefixEvents, 2);
    delete legacy.files[key].aggregate.period!.lineageVersion;
    delete legacy.files[key].aggregate.period!.lineagePrefixEvents;
  }
  return { root, manifest, cold, legacy, childKeys };
}

async function projection(root: string, index: CodexIndexV1) {
  const provider = new CodexProvider({ enabled: true, codexHome: root,
    indexPath: path.join(root, 'unused-index.json'), salt: SALT, timeZone: 'UTC' },
  () => ({ refresh: async () => ({ index, indexChanged: false, bodyReads: 0, failedFiles: 0,
    metadataMs: 0, parseMs: 0, migration: { filePasses: 0, bytesRead: 0,
      pending: !index.coverage.period.allTime.complete } }), dispose() {} }));
  try {
    const { snapshot } = await provider.refresh();
    return { files: snapshot.files, evidence: codexAchievementCalendarProjection(snapshot.files, 'UTC',
      snapshot.currentManifestVerified === true && snapshot.coverage.complete,
      snapshot.coverage.identity.complete && snapshot.coverage.period.allTime.complete).evidence };
  } finally { await provider.dispose(); }
}

for (const batched of [false, true]) test(`inherited-prefix period migration resumes before the prefix ends (${batched ? 'batch' : 'sequential'})`, async () => {
  const f = await fixture();
  try {
    let batches = 0;
    const filePassBatch: CodexFilePassBatchRunner | undefined = batched ? async (tasks, accept) => {
      batches++;
      for (const task of tasks) { assert.equal(task.kind, 'period'); await accept(await runCodexFilePass(task)); }
    } : undefined;
    const first = await updateCodexIndex(f.legacy, f.manifest, { ...options, budget, filePassBatch });
    const key = f.childKeys.find(key => first.index.files[key].periodMigration)!;
    const draft = first.index.files[key].periodMigration!;
    assert.equal(draft.tokenEventsSeen, 1);
    assert.equal(draft.prefixEvents, 2);
    assert.deepEqual(draft.days, {});
    assert.ok(draft.offset > 0);
    const partial = await projection(f.root, first.index);
    assert.equal(partial.evidence.complete, false);
    assert.equal(partial.files.find(file => file.session.parentSessionKey)?.achievementPeriodWitness, undefined);
    const checkpoint = path.join(f.root, 'checkpoint.json');
    await saveCodexIndexAtomic(checkpoint, first.index);
    const restored = await loadCodexIndex(checkpoint, 'UTC');
    const second = await updateCodexIndex(restored, f.manifest, { ...options, budget, filePassBatch });
    assert.ok(second.index.files[key].periodMigration!.offset > draft.offset,
      'the second pass must advance instead of discarding a valid pre-prefix checkpoint');
    let result = second;
    for (let pass = 0; result.migration.pending && pass < 8; pass++) {
      assert.equal(result.failedFiles, 0);
      assert.ok(result.migration.bytesRead <= budget.maxBytes);
      result = await updateCodexIndex(result.index, f.manifest, { ...options, budget, filePassBatch });
    }
    assert.equal(result.migration.pending, false);
    assert.deepEqual(result.index.aggregate.total, f.cold.index.aggregate.total);
    for (const child of f.childKeys) {
      assert.deepEqual(result.index.files[child].aggregate.period, f.cold.index.files[child].aggregate.period);
      assert.deepEqual(Object.keys(result.index.files[child].aggregate.period!.days), ['2026-10-06'],
        'inherited parent dates are not counted again in children');
    }
    const complete = await projection(f.root, result.index);
    assert.equal(complete.evidence.complete, true);
    assert.ok(complete.files.every(file => file.achievementPeriodWitness));
    assert.deepEqual(complete.evidence.days, (await projection(f.root, f.cold.index)).evidence.days);
    assert.equal((await updateCodexIndex(result.index, f.manifest, options)).bodyReads, 0);
    if (batched) assert.ok(batches > 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('cancellation before an inherited prefix ends preserves the exact resume offset', async () => {
  const f = await fixture(1);
  try {
    const checkpoint = path.join(f.root, 'cancelled.json');
    let cancelled = false;
    await assert.rejects(updateCodexIndex(f.legacy, f.manifest, { ...options, budget,
      shouldCancel: () => cancelled,
      io: { async *read(entry, start, end) {
        const body = await readFile(entry.absolutePath);
        cancelled = true;
        yield body.subarray(start, Math.min(end, start + 1024 * 1024));
      } },
      onCheckpoint: async index => {
        await saveCodexIndexAtomic(checkpoint, index);
      },
    }), CodexIndexCancelledError);
    const saved = await loadCodexIndex(checkpoint, 'UTC');
    const key = f.childKeys[0], draft = saved.files[key].periodMigration!;
    assert.equal(draft.tokenEventsSeen, 1);
    assert.equal((await projection(f.root, saved)).evidence.complete, false);
    const starts: number[] = [];
    const io: CodexIndexIo = { async *read(entry, start, end) {
      starts.push(start); yield (await readFile(entry.absolutePath)).subarray(start, end);
    } };
    const resumed = await updateCodexIndex(saved, f.manifest, { ...options, io });
    assert.equal(starts[0], draft.offset);
    assert.equal(resumed.failedFiles, 0);
    assert.equal((await projection(f.root, resumed.index)).evidence.complete, true);
    assert.deepEqual(resumed.index.files[key].aggregate.period, f.cold.index.files[key].aggregate.period);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('reaching EOF before the required inherited events never promotes calendar proof', async () => {
  const f = await fixture(1);
  try {
    const io: CodexIndexIo = { async *read(entry, start, end) {
      let body = await readFile(entry.absolutePath, 'utf8');
      for (const line of [token(2), token(3, '2026-10-06')]) body = body.replace(line, ' '.repeat(line.length));
      yield Buffer.from(body).subarray(start, end);
    } };
    const result = await updateCodexIndex(f.legacy, f.manifest, { ...options, io });
    const child = result.index.files[f.childKeys[0]];
    assert.equal(child.periodMigration?.tokenEventsSeen, 1);
    assert.equal(child.aggregate.period?.lineageVersion, undefined);
    assert.equal(result.index.coverage.period.allTime.complete, false);
    assert.equal((await projection(f.root, result.index)).evidence.complete, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
