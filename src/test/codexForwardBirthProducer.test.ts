import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex, CodexIndexV1 } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { CODEX_MAX_JSONL_LINE_BYTES } from '../providers/codex/codexJsonlScanner';
import { buildCodexForwardCalibration, isCodexForwardBirth, CodexForwardCalibration } from '../providers/codex/codexForwardCalibration';

const T = Date.parse('2026-10-20T02:00Z'), R = T + 6 * 86400000, salt = 'synthetic-forward-birth';
const json = (value: object) => JSON.stringify(value) + '\n';
const meta = (id: string, parent?: string) => json({ type: 'session_meta', payload: { id,
  ...(parent ? { forked_from_id: parent } : {}) } });
const context = json({ type: 'turn_context', payload: { model: 'gpt-5' } });
const taskStarted = json({ type: 'event_msg', timestamp: new Date(T + 150).toISOString(), payload: { type: 'task_started' } });
function request(n: number, at: number): string {
  return json({ type: 'event_msg', timestamp: new Date(at).toISOString(), payload: { type: 'token_count',
    info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 1 },
      total_token_usage: { input_tokens: 100 * n, cached_input_tokens: 0, output_tokens: n } },
    rate_limits: { limit_id: 'codex', secondary: { used_percent: 20 + n, window_minutes: 10080, resets_at: R } },
  } });
}
const build = (index: CodexIndexV1, at: number, previous?: unknown) => buildCodexForwardCalibration(index, true,
  new Set(Object.keys(index.files)), new Set(), at, {}, previous)!;
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-forward-birth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  await writeFile(path.join(root, 'sessions', 'old.jsonl'), meta('old-synthetic-root') + context + request(1, T + 10));
  const options = { salt, timeZone: 'UTC', now: () => T + 10000,
    allowHistoricalBackfill: false, allowAchievementHourProof: false };
  const refresh = async (previous: CodexIndexV1) => updateCodexIndex(previous, await scanCodexManifest(root, salt), options);
  const initial = (await refresh(createEmptyCodexIndex('UTC'))).index;
  const before = build(initial, T + 100), file = path.join(root, 'sessions', 'new.jsonl');
  return { initial, before, file, refresh };
}
function added(after: CodexForwardCalibration, before: CodexForwardCalibration) {
  const source = after.sources.find(s => !before.sources.some(old => old.sourceKey === s.sourceKey));
  assert.ok(source); return source;
}

test('new root gets offset-zero birth authority tied to a branded prior census and live append chain', async t => {
  const f = await fixture(t);
  const absentWarm = build(normalizeCodexIndex(f.initial)!, T + 150, f.before);
  await writeFile(f.file, meta('new-synthetic-root') + taskStarted + context + request(1, T + 200));
  const born = (await f.refresh(f.initial)).index, after = build(born, T + 300, absentWarm);
  const source = added(after, f.before), key = source.sourceKey;
  assert.equal(born.files[key].calibrationAppend?.beforeOffset, 0);
  assert.equal(born.files[key].calibrationAppend?.complete, true);
  assert.equal(born.files[key].calibrationAppend?.minUsageAt, T + 200);
  assert.equal(isCodexForwardBirth(f.before, source), true);
  assert.equal(isCodexForwardBirth(absentWarm, source), true);
  assert.equal(isCodexForwardBirth(structuredClone(f.before), source), false);
  assert.equal(isCodexForwardBirth(f.before, { ...source }), false);
  assert.equal(isCodexForwardBirth(after, source), false, 'an existing source is not a birth');
  const warm = build(normalizeCodexIndex(born)!, T + 400, after);
  assert.equal(isCodexForwardBirth(f.before, added(warm, f.before)), true);
  await appendFile(f.file, request(2, T + 500));
  const appended = (await f.refresh(normalizeCodexIndex(born)!)).index;
  const live = build(appended, T + 600, warm), final = added(live, f.before);
  assert.deepEqual(final.appendWindows?.map(w => w.beforeOffset), [0, born.files[key].offset]);
  assert.equal(isCodexForwardBirth(f.before, final), true);
  const reset = build(normalizeCodexIndex(appended)!, T + 700);
  assert.equal(isCodexForwardBirth(f.before, added(reset, f.before)), false, 'restart restores no runtime authority');
  const copiedPrevious = build(normalizeCodexIndex(appended)!, T + 800, structuredClone(live));
  assert.equal(isCodexForwardBirth(f.before, added(copiedPrevious, f.before)), false);
});

test('startup initial scans cannot retrospectively acquire birth authority', async t => {
  const f = await fixture(t);
  await writeFile(f.file, meta('startup-synthetic-root') + context + request(1, T + 200));
  const born = (await f.refresh(f.initial)).index, startup = build(born, T + 300);
  assert.equal(isCodexForwardBirth(f.before, added(startup, f.before)), false);
  const reused = build(born, T + 400, f.before);
  assert.equal(isCodexForwardBirth(f.before, added(reused, f.before)), false, 'same initial scan cannot be reissued later');
  const normalized = normalizeCodexIndex(born)!;
  const later = build(normalized, T + 500, f.before);
  assert.equal(isCodexForwardBirth(f.before, added(later, f.before)), false);
});

test('root birth denies children, unsafe initial input, missing identity and later identity changes', async t => {
  for (const kind of ['child', 'unknown-child', 'unknown-role', 'unknown', 'missing-identity', 'identity-change',
    'late-child-metadata', 'usage-before-identity', 'repeated-task', 'late-task', 'quota-only', 'bad-json', 'cumulative', 'reversal'] as const) {
    const f = await fixture(t);
    let body = meta('new-synthetic-root', kind === 'child' ? 'old-synthetic-root' : undefined) + context;
    if (kind === 'unknown-child') body = json({ type: 'session_meta', payload: { id: 'new-synthetic-root',
      source: { subagent: { other: 'unknown-worker' } } } }) + context;
    if (kind === 'unknown-role') body = json({ type: 'session_meta', payload: { id: 'new-synthetic-root', agent_role: 'unknown-worker' } }) + context;
    if (kind === 'missing-identity') body = context;
    if (kind === 'unknown') body += json({ type: 'unknown-future-event' });
    if (kind === 'bad-json') body += 'invalid-json\n';
    if (kind === 'identity-change') body += meta('another-synthetic-root');
    if (kind === 'late-child-metadata') body += json({ type: 'session_meta', payload: {
      id: 'new-synthetic-root', source: { subagent: null } } });
    if (kind === 'usage-before-identity') body = context + request(1, T + 180) + meta('new-synthetic-root');
    if (kind === 'repeated-task') body += taskStarted + taskStarted;
    if (kind === 'late-task') body += request(1, T + 180) + taskStarted;
    if (kind === 'quota-only') { const raw = JSON.parse(request(1, T + 180)); delete raw.payload.info; body += JSON.stringify(raw) + '\n'; }
    if (kind === 'cumulative') {
      const raw = JSON.parse(request(1, T + 200)); delete raw.payload.info.last_token_usage;
      body += JSON.stringify(raw) + '\n';
    } else if (kind === 'reversal') body += request(1, T + 210) + request(2, T + 200);
    else body += request(1, T + 200);
    await writeFile(f.file, body);
    const born = (await f.refresh(f.initial)).index, after = build(born, T + 300, f.before);
    assert.equal(isCodexForwardBirth(f.before, added(after, f.before)), false, kind);
  }
});

test('metadata-only root birth is explicitly known zero and can retain an ensuing usage append', async t => {
  const f = await fixture(t);
  await writeFile(f.file, meta('metadata-only-root') + context);
  const born = (await f.refresh(f.initial)).index, after = build(born, T + 300, f.before);
  const source = added(after, f.before);
  assert.equal(source.eligible, true);
  assert.equal(source.appendWindow?.complete, true);
  assert.equal(source.appendWindow?.minUsageAt, null); assert.equal(source.appendWindow?.maxUsageAt, null);
  assert.equal(isCodexForwardBirth(f.before, source), true);
  await appendFile(f.file, request(1, T + 500));
  const next = (await f.refresh(normalizeCodexIndex(born)!)).index;
  assert.equal(isCodexForwardBirth(f.before, added(build(next, T + 600, after), f.before)), true);
});

test('generation/replacement/unsafe append and evicted initial windows retire birth authority', async t => {
  const f = await fixture(t);
  await writeFile(f.file, meta('new-synthetic-root') + context + request(1, T + 200));
  const born = (await f.refresh(f.initial)).index, after = build(born, T + 300, f.before), key = added(after, f.before).sourceKey;
  for (const kind of ['generation', 'replacement', 'unknown', 'prefix-rewrite'] as const) {
    const i = structuredClone(born);
    if (kind === 'generation') i.indexGeneration!++;
    if (kind === 'replacement') i.files[key].ino = 999;
    if (kind === 'unknown') { i.files[key].size++; i.files[key].offset++; delete i.files[key].calibrationAppend; }
    if (kind === 'prefix-rewrite') i.files[key].lineage!.fingerprintBlocks[0] = Buffer.alloc(16, 255).toString('base64');
    assert.equal(isCodexForwardBirth(f.before, added(build(i, T + 400, after), f.before)), false, kind);
  }
  let index = born, proof = after;
  for (let n = 2; n <= 34; n++) {
    await appendFile(f.file, request(n, T + 200 + n * 100));
    index = (await f.refresh(normalizeCodexIndex(index)!)).index;
    proof = build(index, T + 500 + n * 100, proof);
  }
  assert.equal(isCodexForwardBirth(f.before, added(proof, f.before)), false, 'bounded history lost offset zero');
});

test('birth requires bounded continuous source absence, not an earlier unrelated or pre-removal census', async t => {
  const f = await fixture(t);
  let absent = f.before;
  for (let n = 0; n < 34; n++) absent = build(normalizeCodexIndex(f.initial)!, T + 110 + n, absent);
  await writeFile(f.file, meta('new-synthetic-root') + context + request(1, T + 200));
  const born = (await f.refresh(f.initial)).index, after = build(born, T + 300, absent);
  assert.equal(isCodexForwardBirth(f.before, added(after, f.before)), false, 'absence lookback is bounded');
  assert.equal(isCodexForwardBirth(absent, added(after, absent)), true);
  await rm(f.file);
  const removed = (await f.refresh(born)).index, gap = build(removed, T + 400, after);
  await writeFile(f.file, meta('new-synthetic-root') + context + request(1, T + 500));
  const reborn = (await f.refresh(removed)).index, fresh = build(reborn, T + 600, gap);
  assert.equal(isCodexForwardBirth(absent, added(fresh, absent)), false, 'intervening presence breaks absence');
  assert.equal(isCodexForwardBirth(gap, added(fresh, gap)), true);
});

test('partial initial scan and resumed tail cannot manufacture complete birth evidence', async t => {
  const f = await fixture(t);
  const padding = json({ type: 'world_state', padding: 'x'.repeat(500000) });
  await writeFile(f.file, meta('new-synthetic-root') + taskStarted + context + request(1, T + 200) +
    padding + padding + padding + request(2, T + 250));
  const manifest = await scanCodexManifest(path.dirname(path.dirname(f.file)), salt);
  const partial = (await updateCodexIndex(f.initial, manifest, { salt, timeZone: 'UTC', now: () => T + 10000,
    allowHistoricalBackfill: false, allowAchievementHourProof: false,
    budget: { maxFilePasses: 1, maxBytes: CODEX_MAX_JSONL_LINE_BYTES + 1 } })).index;
  const pending = build(partial, T + 300, f.before), s = added(pending, f.before);
  assert.equal(s.eligible, false); assert.equal(isCodexForwardBirth(f.before, s), false);
  const caughtUp = (await f.refresh(partial)).index, after = build(caughtUp, T + 400, pending);
  assert.equal(isCodexForwardBirth(f.before, added(after, f.before)), false);
});
