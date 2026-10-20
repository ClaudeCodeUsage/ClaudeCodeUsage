import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex,
  CodexIndexCancelledError, CodexIndexV3, saveCodexIndexAtomic, loadCodexIndex,
  runCodexFilePass } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { CodexProvider } from '../providers/codex/codexProvider';
import { CODEX_QUOTA_CHECKPOINT_VERSION } from '../providers/codex/codexQuotaCheckpoints';

const salt = 'isolated-quota-fixtures';
const now = Date.parse('2026-10-02T00:00:00Z');
const reset = now + 6 * 86400000;
function record(i: number, input: number | null, used: number) {
  return JSON.stringify({ type: 'event_msg', timestamp: new Date(now + i * 1000).toISOString(), payload: {
    type: 'token_count', info: input === null ? null : { last_token_usage: {
      input_tokens: input, cached_input_tokens: 1, output_tokens: 2,
    } }, rate_limits: { limit_id: 'codex', secondary: {
      used_percent: used, window_minutes: 10080, resets_at: reset,
    } } } }) + '\n';
}
const context = JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5' } }) + '\n';
const meta = (id: string, parent?: string) => JSON.stringify({ type: 'session_meta', payload: {
  id, ...(parent ? { forked_from_id: parent } : {}),
} }) + '\n';
async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-quota-pair-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', 'rollout.jsonl');
  const options = { salt, timeZone: 'UTC', now: () => now, allowAchievementHourProof: false };
  const scan = () => scanCodexManifest(root, salt);
  return { root, file, options, scan };
}
test('cold, append and normalized reload retain identical pairing without rereading warm bodies', async t => {
  const f = await fixture(t);
  await writeFile(f.file, context + record(1, null, 10) + record(2, 100, 11));
  const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const key = Object.keys(cold.index.files)[0];
  assert.equal((cold.index.files[key] as any).quotaCheckpoints?.rows.length, 2);
  const reloaded = normalizeCodexIndex(JSON.parse(JSON.stringify(cold.index)))!;
  const warm = await updateCodexIndex(reloaded, await f.scan(), f.options);
  assert.equal(warm.bodyReads, 0);
  await appendFile(f.file, record(3, 50, 12));
  const appended = await updateCodexIndex(warm.index, await f.scan(), f.options);
  const fresh = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  assert.deepEqual((appended.index.files[key] as any).quotaCheckpoints,
    (fresh.index.files[key] as any).quotaCheckpoints);
  assert.equal((appended.index.files[key] as any).quotaCheckpoints.rows[2].byModel['gpt-5'].inputTotal, 150);
});
test('old checkpoints replay on the existing bounded period pass while primary counts stay exact', async t => {
  const f = await fixture(t);
  await writeFile(f.file, context + record(1, 900, 10) + record(2, 100, 11));
  const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const key = Object.keys(cold.index.files)[0];
  delete (cold.index.files[key] as any).quotaCheckpoints;
  const old = normalizeCodexIndex(JSON.parse(JSON.stringify(cold.index)))!;
  assert.equal(old.files[key].aggregate.total.inputTotal, 1000);
  const migrated = await updateCodexIndex(old, await f.scan(), f.options);
  assert.ok(migrated.bodyReads > 0);
  assert.equal(migrated.index.files[key].aggregate.total.inputTotal, 1000);
  assert.equal((migrated.index.files[key] as any).quotaCheckpoints.rows[1].byModel['gpt-5'].inputTotal, 100);
});
test('legacy v1/v2/v3/v4 checkpoints replay to current semantics without resetting primary counts', async t => {
  const f = await fixture(t);
  await writeFile(f.file, context + record(1, 900, 10) + record(2, 100, 11));
  const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const key = Object.keys(cold.index.files)[0];
  for (const version of [1, 2, 3, 4]) {
    const raw = JSON.parse(JSON.stringify(cold.index));
    raw.files[key].quotaCheckpoints.version = version;
    delete raw.files[key].quotaCheckpoints.rows[0].baselineByModel;
    const old = normalizeCodexIndex(raw)!;
    assert.equal(old.files[key].quotaCheckpoints, undefined);
    assert.equal(old.files[key].aggregate.total.inputTotal, 1000);
    const replayed = await updateCodexIndex(old, await f.scan(), f.options);
    assert.ok(replayed.bodyReads > 0);
    const state = replayed.index.files[key].quotaCheckpoints!;
    assert.equal(state.version, CODEX_QUOTA_CHECKPOINT_VERSION);
    assert.equal(state.rows[0].baselineByModel!['gpt-5'].inputTotal, 900);
    assert.deepEqual(state.rows[0].byModel, {});
    assert.equal(state.rows[1].byModel['gpt-5'].inputTotal, 100);
    assert.equal(replayed.index.files[key].aggregate.total.inputTotal, 1000);
  }
});

test('jittered checkpoints preserve exact cold/append/reload pairing with the first reset anchor', async t => {
  const f = await fixture(t);
  const jitter = (i: number, input: number, used: number, delta: number) => {
    const row = JSON.parse(record(i, input, used));
    row.payload.rate_limits.secondary.resets_at = reset + delta;
    return JSON.stringify(row) + '\n';
  };
  await writeFile(f.file, context + jitter(1, 500, 20, 0) + jitter(2, 100, 30, 5000));
  const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const key = Object.keys(cold.index.files)[0];
  const loaded = normalizeCodexIndex(JSON.parse(JSON.stringify(cold.index)))!;
  const warm = await updateCodexIndex(loaded, await f.scan(), f.options);
  assert.equal(warm.bodyReads, 0);
  await appendFile(f.file, jitter(3, 200, 40, -5000));
  const appended = await updateCodexIndex(warm.index, await f.scan(), f.options);
  const fresh = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const state = appended.index.files[key].quotaCheckpoints!;
  assert.deepEqual(state, fresh.index.files[key].quotaCheckpoints);
  assert.deepEqual(state.rows.map(row => row.resetAt), [reset, reset, reset]);
  assert.deepEqual(state.rows.map(row => row.observedResetAt), [reset, reset + 5000, reset - 5000]);
  assert.equal(state.rows[2].byModel['gpt-5'].inputTotal, 300);
  assert.equal(appended.index.files[key].aggregate.total.inputTotal, 800);
});

test('valid last recovery below cumulative high-water survives reload and append with exact primary parity', async t => {
  const f = await fixture(t);
  const withTotal = (i: number, total: number, last: number) => {
    const row = JSON.parse(record(i, last, 10 + i * 10));
    row.payload.info.total_token_usage = { input_tokens: total, output_tokens: total / 100 };
    return JSON.stringify(row) + '\n';
  };
  await writeFile(f.file, context + withTotal(1, 10000, 500) + withTotal(2, 1000, 100));
  const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const key = Object.keys(cold.index.files)[0];
  assert.equal(cold.index.files[key].aggregate.total.inputTotal, 600);
  assert.equal(cold.index.files[key].parserState.highWater!.inputTokens, 10000);
  const loaded = normalizeCodexIndex(JSON.parse(JSON.stringify(cold.index)))!;
  const warm = await updateCodexIndex(loaded, await f.scan(), f.options);
  assert.equal(warm.bodyReads, 0);
  await appendFile(f.file, withTotal(3, 1200, 200));
  const appended = await updateCodexIndex(warm.index, await f.scan(), f.options);
  const fresh = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const file = appended.index.files[key];
  assert.deepEqual(file.quotaCheckpoints, fresh.index.files[key].quotaCheckpoints);
  assert.deepEqual(file.aggregate.total, fresh.index.files[key].aggregate.total);
  assert.equal(file.aggregate.total.inputTotal, 800);
  assert.equal(file.aggregate.total.outputTotal, 6);
  assert.equal(file.parserState.highWater!.inputTokens, 10000);
  assert.ok(file.qualityFlags.includes('counter-regression'));
  assert.deepEqual(file.quotaCheckpoints!.rows.map(row => row.baseline), [true, false, false]);
  assert.equal(file.quotaCheckpoints!.rows[2].byModel['gpt-5'].inputTotal, 300);
  assert.deepEqual(file.quotaCheckpoints!.ranges, []);
  const oldRaw = JSON.parse(JSON.stringify(appended.index));
  oldRaw.files[key].quotaCheckpoints.version = 4;
  const oldV4 = normalizeCodexIndex(oldRaw)!;
  assert.equal(oldV4.files[key].quotaCheckpoints, undefined);
  assert.deepEqual(oldV4.files[key].aggregate.total, file.aggregate.total);
  const replayed = await updateCodexIndex(oldV4, await f.scan(), f.options);
  assert.ok(replayed.bodyReads > 0);
  assert.deepEqual(replayed.index.files[key].aggregate.total, file.aggregate.total);
  assert.deepEqual(replayed.index.files[key].quotaCheckpoints, file.quotaCheckpoints);
});
test('provider publishes bounded canonical paired evidence with runtime file keys', async t => {
  const f = await fixture(t);
  await writeFile(f.file, context + record(1, null, 10) + record(2, 100, 11));
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const provider = new CodexProvider({ enabled: true, codexHome: f.root,
    indexPath: path.join(f.root, 'unused.json'), salt, timeZone: 'UTC' }, () => ({
      refresh: async () => ({ ...result, failedFiles: 0, metadataMs: 0, parseMs: 0 }), dispose() {},
    }));
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  t.after(() => provider.dispose());
  const inputs = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal(inputs.codexQuotaCheckpoints?.length, 2);
  assert.equal(inputs.codexQuotaCheckpointsComplete, true);
  assert.match(inputs.codexQuotaCheckpoints![0].sourceKey, /^[a-f0-9]{64}$/);
});

test('copied parent prefixes are excluded by the same lineage admission in sequential and file-pass execution', async t => {
  const f = await fixture(t);
  await writeFile(f.file, meta('parent') + context + record(1, 900, 10) + record(2, 100, 11));
  const child = path.join(f.root, 'sessions', 'child.jsonl');
  await writeFile(child, meta('child', 'parent') + context + record(1, 900, 10) +
    record(2, 100, 11) + record(3, 50, 12) + record(4, 20, 13));
  for (const batch of [false, true]) {
    const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), {
      ...f.options, ...(batch ? { filePassBatch: async (tasks: any, accept: any) => {
        for (const task of tasks) await accept(await runCodexFilePass(task));
      } } : {}),
    });
    const file = Object.values(result.index.files).find(file => file.lineage?.desiredPrefixEvents === 2)!;
    assert.ok(file);
    assert.equal(file.aggregate.total.inputTotal, 70);
    const rows = file.quotaCheckpoints!.rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].baseline, true);
    assert.equal(rows[0].through, now + 3000);
    assert.equal((rows[0] as any).baselineByModel['gpt-5'].inputTotal, 50);
    assert.deepEqual(rows[0].byModel, {});
    assert.equal(rows[1].byModel['gpt-5'].inputTotal, 20);
  }
});

test('cancelled period replay resumes its numeric pairing from a durable safe chunk', async t => {
  const f = await fixture(t);
  const filler = JSON.stringify({ type: 'world_state', padding: 'x'.repeat(80000) }) + '\n';
  await writeFile(f.file, context + record(1, null, 10) + filler + record(2, 100, 11) + filler + record(3, 50, 12));
  const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const key = Object.keys(cold.index.files)[0]; delete cold.index.files[key].quotaCheckpoints;
  let saved: CodexIndexV3 | undefined, cancel = false;
  const cache = path.join(f.root, 'isolated-index.json');
  await assert.rejects(updateCodexIndex(cold.index, await f.scan(), { ...f.options,
    scheduling: { checkpointEveryMs: 0 }, shouldCancel: () => cancel,
    onCheckpoint: async index => {
      if (index.files[key].periodMigration?.offset) {
        await saveCodexIndexAtomic(cache, index); saved = await loadCodexIndex(cache); cancel = true;
      }
    },
  }), CodexIndexCancelledError);
  assert.ok(saved?.files[key].periodMigration?.offset);
  assert.equal(saved!.files[key].aggregate.total.inputTotal, 150);
  const resumed = await updateCodexIndex(saved!, await f.scan(), f.options);
  assert.deepEqual(resumed.index.files[key].quotaCheckpoints, cold.index.files[key].quotaCheckpoints ??
    Object.values((await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options)).index.files)[0].quotaCheckpoints);
  const legacyRaw = JSON.parse(JSON.stringify(saved));
  legacyRaw.files[key].periodMigration.quotaCheckpoints.version = 1;
  const legacyDraft = normalizeCodexIndex(legacyRaw)!;
  assert.equal(legacyDraft.files[key].periodMigration!.quotaCheckpoints, undefined);
  assert.equal(legacyDraft.files[key].aggregate.total.inputTotal, 150);
  const restarted = await updateCodexIndex(legacyDraft, await f.scan(), f.options);
  assert.deepEqual(restarted.index.files[key].quotaCheckpoints, resumed.index.files[key].quotaCheckpoints);
});

test('canonical copies count once and ambiguous copies annotate each retained checkpoint', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'archived_sessions'));
  const text = meta('same-session') + context + record(1, null, 10) + record(2, 100, 11);
  await writeFile(f.file, text);
  await writeFile(path.join(f.root, 'archived_sessions', 'copy.jsonl'), text);
  let result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const provider = new CodexProvider({ enabled: true, codexHome: f.root,
    indexPath: path.join(f.root, 'unused.json'), salt, timeZone: 'UTC' }, () => ({
      refresh: async () => ({ ...result, failedFiles: 0, metadataMs: 0, parseMs: 0 }), dispose() {},
    }));
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  t.after(() => provider.dispose());
  const canonical = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal(canonical.codexQuotaCheckpoints!.length, 2);
  assert.equal(canonical.codexQuotaCheckpointsComplete, true);
  await appendFile(path.join(f.root, 'archived_sessions', 'copy.jsonl'), record(3, 50, 12));
  result = await updateCodexIndex(result.index, await f.scan(), f.options);
  const ambiguous = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal(ambiguous.codexQuotaCheckpointsComplete, false);
  assert.ok(ambiguous.codexQuotaCheckpoints!.length > 0);
  assert.ok(ambiguous.codexQuotaCheckpoints!.every(row => row.complete === false));
});

test('provider retains older windows below the corpus-calibrated projection budget', async t => {
  const f = await fixture(t);
  for (let file = 0; file < 10; file++) {
    let text = meta(`source-${file}`) + context;
    for (let episode = 0; episode < 256; episode++) {
      for (let point = 0; point < 2; point++) {
        const raw = JSON.parse(record(1, point ? 100 : null, 10 + point));
        raw.timestamp = new Date(now - (9 - file) * 8 * 86400000 - 1000000 + episode * 2000 + point * 1000).toISOString();
        raw.payload.rate_limits.secondary.resets_at = reset - (9 - file) * 8 * 86400000 + episode * 1000;
        text += JSON.stringify(raw) + '\n';
      }
    }
    await writeFile(path.join(f.root, 'sessions', `source-${file}.jsonl`), text);
  }
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const provider = new CodexProvider({ enabled: true, codexHome: f.root,
    indexPath: path.join(f.root, 'unused.json'), salt, timeZone: 'UTC' }, () => ({
      refresh: async () => ({ ...result, failedFiles: 0, metadataMs: 0, parseMs: 0 }), dispose() {},
    }));
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  t.after(() => provider.dispose());
  const inputs = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal(inputs.codexQuotaCheckpoints!.length, 5120);
  assert.equal(inputs.codexQuotaCheckpointsComplete, true);
  const incomplete = (inputs as any).codexQuotaIncompleteResets as number[] | undefined;
  assert.ok(incomplete);
  assert.deepEqual(incomplete, []);
  const latest = inputs.codexQuotaCheckpoints![inputs.codexQuotaCheckpoints!.length - 1];
  assert.equal(latest.through, now - 1000000 + 255 * 2000 + 1000);
  assert.equal(latest.complete, true);
  assert.equal(latest.byModel['gpt-5'].inputTotal, 100);
  assert.ok(inputs.codexQuotaCheckpoints!.some(row => row.baseline &&
    row.sourceKey === latest.sourceKey && row.segment === latest.segment));
});

test('missing old source checkpoints do not bless an overlapping current source or block an unrelated window', async t => {
  const f = await fixture(t);
  const oldReset = reset - 14 * 86400000;
  const oldRecord = (i: number) => {
    const raw = JSON.parse(record(i, i === 1 ? null : 20, 10 + i));
    raw.timestamp = new Date(now - 14 * 86400000 + i * 1000).toISOString();
    raw.payload.rate_limits.secondary.resets_at = oldReset;
    return JSON.stringify(raw) + '\n';
  };
  await writeFile(f.file, meta('current') + context + record(1, null, 10) + record(2, 100, 11));
  await writeFile(path.join(f.root, 'sessions', 'old.jsonl'), meta('old') + context + oldRecord(1) + oldRecord(2));
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const old = Object.values(result.index.files).find(file => file.quotaHistory?.some(row => row.resetAt === oldReset))!;
  const current = Object.values(result.index.files).find(file => file !== old)!;
  old.quotaCheckpoints!.overflow = true;
  old.quotaCheckpoints!.complete = false;
  const provider = new CodexProvider({ enabled: true, codexHome: f.root,
    indexPath: path.join(f.root, 'unused.json'), salt, timeZone: 'UTC' }, () => ({
      refresh: async () => ({ ...result, failedFiles: 0, metadataMs: 0, parseMs: 0 }), dispose() {},
    }));
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  t.after(() => provider.dispose());
  const oldOnly = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal(oldOnly.codexQuotaCheckpointsComplete, false);
  assert.deepEqual((oldOnly as any).codexQuotaIncompleteResets, [oldReset]);
  assert.ok(oldOnly.codexQuotaCheckpoints!.some(row => row.resetAt === reset && row.complete));
  delete old.quotaCheckpoints;
  assert.deepEqual(((await provider.refresh()).snapshot.weeklyValueInputs! as any).codexQuotaIncompleteResets, [oldReset]);
  delete current.quotaCheckpoints;
  const currentMissing = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.deepEqual((currentMissing as any).codexQuotaIncompleteResets, [oldReset, reset]);
  delete current.aggregate.period;
  const unknown = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal((unknown as any).codexQuotaIncompleteResets, undefined);
});

test('a dated source without quota samples still withholds an overlapping known window', async t => {
  const f = await fixture(t);
  await writeFile(f.file, meta('paired') + context + record(1, null, 10) + record(3, 100, 11));
  const raw = JSON.parse(record(2, 50, 10)); delete raw.payload.rate_limits;
  await writeFile(path.join(f.root, 'sessions', 'unpaired.jsonl'), meta('unpaired') + context + JSON.stringify(raw) + '\n');
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const provider = new CodexProvider({ enabled: true, codexHome: f.root,
    indexPath: path.join(f.root, 'unused.json'), salt, timeZone: 'UTC' }, () => ({
      refresh: async () => ({ ...result, failedFiles: 0, metadataMs: 0, parseMs: 0 }), dispose() {},
    }));
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  t.after(() => provider.dispose());
  const inputs = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal(inputs.codexQuotaCheckpointsComplete, false);
  assert.deepEqual((inputs as any).codexQuotaIncompleteResets, [reset]);
  t.mock.method(provider, 'isAvailable', async () => false);
  const cached = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal((cached as any).codexQuotaIncompleteResets, undefined);
  assert.equal(cached.codexQuotaCheckpointsComplete, false);
});

test('a concurrent single baseline request is known evidence without an own delta interval', async t => {
  const f = await fixture(t);
  await writeFile(f.file, meta('paired') + context + record(1, null, 10) + record(3, 100, 12));
  await writeFile(path.join(f.root, 'sessions', 'baseline.jsonl'), meta('baseline') + context + record(2, 50, 11));
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await f.scan(), f.options);
  const provider = new CodexProvider({ enabled: true, codexHome: f.root,
    indexPath: path.join(f.root, 'unused.json'), salt, timeZone: 'UTC' }, () => ({
      refresh: async () => ({ ...result, failedFiles: 0, metadataMs: 0, parseMs: 0 }), dispose() {},
    }));
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  t.after(() => provider.dispose());
  const inputs = (await provider.refresh()).snapshot.weeklyValueInputs!;
  assert.equal(inputs.codexQuotaCheckpointsComplete, true);
  assert.deepEqual(inputs.codexQuotaIncompleteResets, []);
  const baseline = inputs.codexQuotaCheckpoints!.find(row => row.through === now + 2000)!;
  assert.deepEqual(baseline.byModel, {});
  assert.equal(baseline.baselineByModel!['gpt-5'].inputTotal, 50);
});
