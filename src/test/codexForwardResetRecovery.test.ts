import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexForwardAccountEstimator } from '../codexForwardAccountEstimate';
import { classifyCodexSessionDuplicates } from '../providers/codex/codexDedup';
import { buildCodexForwardCalibration, CodexForwardCalibration, isCodexForwardAppend } from '../providers/codex/codexForwardCalibration';
import { CODEX_REFRESH_MIN_BYTES, createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex,
  CodexIndexUpdateResult, CodexIndexV1 } from '../providers/codex/codexIndex';
import { CodexIndexClient, CodexWorkerLike } from '../providers/codex/codexIndexClient';
import { runCodexWorkerRefresh } from '../providers/codex/codexIndexWorker';
import { defaultCodexJsonlReader } from '../providers/codex/codexJsonlScanner';
import { CodexManifest, scanCodexManifest } from '../providers/codex/codexManifest';
import { isCodexForwardHistoricalQualityFlag } from '../providers/codex/codexParser';
import { CodexProvider } from '../providers/codex/codexProvider';
import { CodexWorkerMessage, CodexWorkerRequest } from '../providers/codex/codexWorkerProtocol';

const T = Date.parse('2026-10-20T02:00Z'), R = T + 6 * 86400000;
const salt = 'synthetic-forward-reset-recovery';
const json = (value: object) => JSON.stringify(value) + '\n';
const header = json({ type: 'session_meta', payload: { id: 'synthetic-reset-root' } }) +
  json({ type: 'turn_context', payload: { model: 'gpt-5' } });
const request = (n: number) => json({ type: 'event_msg', timestamp: new Date(T + (2 * n - 1) * 1000).toISOString(),
  payload: { type: 'token_count', info: {
    last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 1 },
    total_token_usage: { input_tokens: 100 * n, cached_input_tokens: 0, output_tokens: n },
  }, rate_limits: { limit_id: 'codex', secondary: { used_percent: 10 + n * 10,
    window_minutes: 10080, resets_at: R } } } });
const body = (count: number) => header + Array.from({ length: count }, (_, i) => request(i + 1)).join('');
const sample = (n: number) => ({ accountScopeKey: 'a'.repeat(64), sourceScopeKey: 'b'.repeat(64),
  requestedAt: T + n * 2000 - 100, observedAt: T + n * 2000, resetAt: R, usedPercent: 10 + n * 10,
  quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' as const } });
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .01, cachedInput: .001, output: .1 }] };

function proof(result: CodexIndexUpdateResult, n = 1, previous?: CodexForwardCalibration) {
  const d = classifyCodexSessionDuplicates(result.index.files);
  return buildCodexForwardCalibration(result.index, true, d.canonicalFileKeys, d.ambiguousFileKeys,
    T + n * 2000 - 300, {}, previous, result.forwardSourcesCurrent);
}
function requiredProof(result: CodexIndexUpdateResult, n = 1, previous?: CodexForwardCalibration) {
  const p = proof(result, n, previous); assert.ok(p); return p;
}
const roundTrip = (index: CodexIndexV1) => normalizeCodexIndex(JSON.parse(JSON.stringify(index)))!;

async function fixture(t: TestContext, count = 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-forward-reset-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', 'synthetic.jsonl');
  let stamp = 0, dev: number | undefined;
  const touch = () => utimes(file, new Date(T), new Date(T + ++stamp * 1000));
  await writeFile(file, body(count)); await touch();
  const scan = async () => {
    // No host volume inspection: every path and byte belongs to this fixture.
    const manifest = await scanCodexManifest(root, salt, async () => undefined);
    if (dev !== undefined) for (const e of manifest.files) {
      e.dev = dev; manifest.persistable[e.fileKey].dev = dev;
    }
    return manifest;
  };
  const starts: number[] = [];
  const io = { read(entry: Parameters<typeof defaultCodexJsonlReader.read>[0], start: number, end: number,
    control?: Parameters<typeof defaultCodexJsonlReader.read>[3]) {
    starts.push(start); return defaultCodexJsonlReader.read(entry, start, end, control);
  } };
  const options = { salt, timeZone: 'UTC', now: () => T + 100000,
    allowHistoricalBackfill: false, allowAchievementHourProof: false, io };
  const refresh = async (index: CodexIndexV1, budget?: { maxFilePasses: number }) => {
    starts.length = 0; return updateCodexIndex(index, await scan(), { ...options,
      ...(budget ? { budget: { ...budget, maxBytes: CODEX_REFRESH_MIN_BYTES } } : {}) });
  };
  const first = await refresh(createEmptyCodexIndex('UTC'));
  const key = Object.keys(first.index.files)[0];
  return { root, file, key, first, scan, starts, options, refresh,
    renumber() { dev = (dev ?? first.index.files[key].dev!) + 10000; },
    async rewrite(text: string) { await writeFile(file, text); await touch(); },
    async append(text: string) { await appendFile(file, text); await touch(); },
  };
}

for (const kind of ['dev-renumber', 'truncate', 'same-inode-mtime'] as const) {
  test(`fresh ${kind} reparse permits only a new future baseline and later clean exact tails`, async t => {
    const f = await fixture(t, kind === 'truncate' ? 3 : 1);
    if (kind === 'dev-renumber') f.renumber();
    await f.rewrite(body(1));
    let result = await f.refresh(f.first.index);
    const row = result.index.files[f.key], flag = kind === 'truncate' ? 'truncated-jsonl' : 'replaced-jsonl';
    assert.deepEqual(f.starts, [0]); assert.equal(result.migration.bytesRead, Buffer.byteLength(body(1)));
    assert.ok(row.qualityFlags.includes(flag)); assert.deepEqual(row.parserState.qualityFlags, []);
    assert.equal(row.parserState.schemaVersion, 4); assert.equal(row.parserState.identityLocked, true);
    assert.equal(row.offset, row.size); assert.equal(row.identityChecked, true);
    assert.equal(row.lineage!.desiredPrefixEvents, row.lineage!.appliedPrefixEvents);
    assert.equal(row.calibrationAppend, undefined, 'a reset scan never gains initial/birth append authority');
    assert.equal(result.forwardSourcesCurrent, true);
    assert.equal(JSON.stringify(result.index).includes('forwardSourcesCurrent'), false);
    result = { ...result, index: roundTrip(result.index) };
    // Historical calendar/rolling sidecars are not future-baseline authority.
    delete result.index.files[f.key].aggregate.period; delete result.index.files[f.key].aggregate.today;
    result.index.coverage.period.allTime.complete = false;
    let previous = requiredProof(result), estimator = new CodexForwardAccountEstimator();
    assert.equal(previous.sources[0].eligible, true);
    assert.equal(estimator.observe(sample(1), previous, book), undefined);
    for (const n of [2, 3]) {
      const offset = result.index.files[f.key].offset;
      await f.append(request(n)); result = await f.refresh(result.index);
      assert.deepEqual(f.starts, [offset]); assert.equal(result.migration.bytesRead, Buffer.byteLength(request(n)));
      assert.equal(result.forwardSourcesCurrent, true);
      assert.equal(result.index.files[f.key].calibrationAppend?.complete, true);
      const after = requiredProof(result, n, previous);
      assert.equal(isCodexForwardAppend(previous.sources[0], after.sources[0]), true);
      const estimate = estimator.observe(sample(n), after, book);
      if (n === 2) {
        assert.equal(estimate, undefined); assert.equal(estimator.calibrationDiagnostics().reason, 'first-step-discarded');
      } else {
        assert.equal(estimate?.usedEquivalentUsd, 1.1);
        assert.equal(estimate.calibrationEvidence?.accumulated.intervals, 1);
      }
      assert.deepEqual(result.index.files[f.key].qualityFlags, row.qualityFlags);
      result = { ...result, index: roundTrip(result.index) }; previous = after;
    }
  });
}

test('only an explicit true current-source bit exempts file reset flags; parser and ownership flags stay fatal', async t => {
  const f = await fixture(t); f.renumber();
  const reset = await f.refresh(f.first.index);
  assert.equal(requiredProof({ ...reset, forwardSourcesCurrent: true }).sources[0].eligible, true);
  assert.equal(requiredProof({ ...reset, forwardSourcesCurrent: undefined }).sources[0].eligible, false);
  assert.equal(proof({ ...reset, forwardSourcesCurrent: false }), undefined);
  const bound = {}, d = classifyCodexSessionDuplicates(reset.index.files);
  assert.ok(buildCodexForwardCalibration(reset.index, true, d.canonicalFileKeys, d.ambiguousFileKeys, T, bound, undefined, true));
  assert.equal(buildCodexForwardCalibration(reset.index, true, d.canonicalFileKeys, d.ambiguousFileKeys, T, bound), undefined,
    'a cached proof issued with current authority cannot be recovered by omitting that authority');
  for (const flag of ['replaced-jsonl', 'truncated-jsonl']) {
    assert.equal(isCodexForwardHistoricalQualityFlag(flag), false, 'shared classification remains strict');
    const index = structuredClone(reset.index); index.files[f.key].parserState.qualityFlags.push(flag);
    assert.equal(requiredProof({ ...reset, index, forwardSourcesCurrent: true }).sources[0].eligible, false, flag);
  }
  for (const flag of ['stale-file', 'stale-reset-required', 'missing-parent', 'identity-conflict',
    'invalid-session-meta', 'missing-pseudonymizer', 'future-unreviewed-quality']) {
    const index = structuredClone(reset.index); index.files[f.key].qualityFlags.push(flag);
    assert.equal(requiredProof({ ...reset, index, forwardSourcesCurrent: true }).sources[0].eligible, false, flag);
  }
});

test('explicit current collection advertises slice version even before any slice window exists', async t => {
  const f = await fixture(t), index = roundTrip(f.first.index);
  assert.equal(index.files[f.key].calibrationAppend, undefined);
  const current = requiredProof({ ...f.first, index, forwardSourcesCurrent: true });
  assert.equal(current.slicesVersion, 1);
  assert.equal(current.sources[0].appendWindow, undefined);
  assert.deepEqual(current.sources[0].appendWindows, []);
  const legacy = requiredProof({ ...f.first, index, forwardSourcesCurrent: undefined });
  assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'slicesVersion'), false);
});

test('the replacement interval is rejected before the new baseline can collect two clean steps', async t => {
  const f = await fixture(t), estimator = new CodexForwardAccountEstimator();
  const before = requiredProof(f.first); estimator.observe(sample(1), before, book);
  f.renumber(); await f.rewrite(header + request(2));
  let result = await f.refresh(f.first.index), previous = requiredProof(result, 2, before);
  assert.equal(previous.sources[0].eligible, true);
  assert.equal(result.index.files[f.key].calibrationAppend, undefined);
  assert.equal(isCodexForwardAppend(before.sources[0], previous.sources[0]), false);
  assert.equal(estimator.observe(sample(2), previous, book), undefined);
  assert.equal(estimator.calibrationDiagnostics().reason, 'source-changed');
  for (const n of [3, 4]) {
    await f.append(request(n)); result = await f.refresh(result.index);
    const next = requiredProof(result, n, previous), estimate = estimator.observe(sample(n), next, book);
    if (n === 3) { assert.equal(estimate, undefined); assert.equal(estimator.calibrationDiagnostics().reason, 'first-step-discarded'); }
    else assert.equal(estimate?.usedEquivalentUsd, 1.1);
    previous = next;
  }
});

test('repeated reset with the same sticky flag and unpublished truncate/regrow cannot bridge old offsets', async t => {
  const f = await fixture(t, 3); await f.rewrite(body(1));
  const reset = await f.refresh(f.first.index); await f.append(request(2) + request(3));
  const grown = await f.refresh(reset.index), before = requiredProof(grown, 3);
  const estimator = new CodexForwardAccountEstimator(); estimator.observe(sample(3), before, book);
  await f.rewrite(body(1)); const truncated = await f.refresh(grown.index);
  assert.equal(truncated.index.files[f.key].calibrationAppend, undefined);
  await f.append(request(2) + request(3) + request(4)); const regrown = await f.refresh(truncated.index);
  assert.deepEqual(regrown.index.files[f.key].qualityFlags, grown.index.files[f.key].qualityFlags);
  const after = requiredProof(regrown, 4, before);
  assert.equal(isCodexForwardAppend(before.sources[0], after.sources[0]), true, 'primary prefix continuity alone is insufficient');
  assert.equal(after.sources[0].appendWindow?.complete, false);
  assert.equal(estimator.observe(sample(4), after, book), undefined);
  assert.equal(estimator.calibrationDiagnostics().reason, 'append-window-incomplete');
});

test('same-size cached EOF is not current when a second replacement is budget-deferred', async t => {
  const f = await fixture(t); f.renumber(); const reset = await f.refresh(f.first.index);
  await f.rewrite(body(1));
  const deferred = await f.refresh(reset.index, { maxFilePasses: 0 });
  assert.equal(deferred.bodyReads, 0); assert.equal(deferred.failedFiles, 0);
  assert.equal(deferred.index.files[f.key].offset, deferred.index.files[f.key].size);
  assert.notEqual(deferred.index.files[f.key].mtimeMs, (await f.scan()).files[0].mtimeMs);
  assert.equal(deferred.forwardSourcesCurrent, false);
  assert.equal(proof(deferred), undefined, 'current manifest verification alone cannot renew stale EOF');
  const caughtUp = await f.refresh(deferred.index);
  assert.equal(caughtUp.forwardSourcesCurrent, true); assert.equal(requiredProof(caughtUp).sources[0].eligible, true);
});

test('current-source result checks exact physical metadata, census, EOF and failures on warm and final paths', async t => {
  const f = await fixture(t);
  const warm = await f.refresh(f.first.index);
  assert.equal(warm.bodyReads, 0); assert.equal(warm.forwardSourcesCurrent, true);
  for (const [name, change] of [
    ['device', (m: CodexManifest) => { m.files[0].dev! += 1; }],
    ['inode', (m: CodexManifest) => { m.files[0].ino! += 1; }],
    ['mtime', (m: CodexManifest) => { m.files[0].mtimeMs += 1; }],
    ['size', (m: CodexManifest) => { m.files[0].size += 1; }],
    ['source-area', (m: CodexManifest) => { m.files[0].sourceArea = 'archive'; }],
    ['compression', (m: CodexManifest) => { m.files[0].compression = 'zstd'; }],
    ['volume', (m: CodexManifest) => { m.files[0].volumeKey = 'c'.repeat(64); }],
  ] as const) {
    const manifest = await f.scan(); change(manifest);
    const { absolutePath: _path, nonPersisted: _runtime, ...physical } = manifest.files[0];
    manifest.persistable[f.key] = physical;
    // A missing legacy volume key may be learned with matching dev/ino. Test
    // an actual conflicting known key rather than forbidding that adoption.
    const index = structuredClone(f.first.index);
    if (name === 'volume') index.files[f.key].volumeKey = 'd'.repeat(64);
    const result = await updateCodexIndex(index, manifest,
      { ...f.options, budget: { maxFilePasses: 0, maxBytes: CODEX_REFRESH_MIN_BYTES } });
    assert.equal(result.forwardSourcesCurrent, false, name);
    assert.equal(proof(result), undefined, name);
  }
  const partial = structuredClone(f.first.index); partial.files[f.key].offset--;
  assert.equal((await f.refresh(partial, { maxFilePasses: 0 })).forwardSourcesCurrent, false);
  const stale = structuredClone(f.first.index); stale.files[f.key].qualityFlags.push('stale-file');
  assert.equal((await f.refresh(stale, { maxFilePasses: 0 })).forwardSourcesCurrent, false);
  const unseen = await f.scan();
  const { absolutePath: _path, nonPersisted: _runtime, ...additional } = { ...unseen.files[0], fileKey: 'b'.repeat(64) };
  unseen.files.push({ ...unseen.files[0], fileKey: additional.fileKey });
  unseen.persistable[additional.fileKey] = additional;
  const incomplete = await updateCodexIndex(f.first.index, unseen,
    { ...f.options, budget: { maxFilePasses: 0, maxBytes: CODEX_REFRESH_MIN_BYTES } });
  assert.equal(incomplete.forwardSourcesCurrent, false, 'unread manifest members cannot be omitted from the census');
  assert.equal(proof(incomplete), undefined);
  f.renumber();
  const failed = await updateCodexIndex(f.first.index, await f.scan(), { ...f.options,
    io: { async *read() { throw new Error('synthetic read failure'); } } });
  assert.equal(failed.failedFiles, 1); assert.equal(failed.forwardSourcesCurrent, false);
  assert.equal(proof(failed), undefined);
});

test('real synthetic scanner transports the runtime bit through coordinator, client and provider without persisting it', async t => {
  const f = await fixture(t); let stored = roundTrip(f.first.index), zeroBudget = false;
  const messages: CodexWorkerMessage[] = [], serialized: string[] = [];
  class FixtureWorker extends EventEmitter {
    postMessage(message: CodexWorkerRequest): void {
      if (message.type !== 'refresh') return;
      void runCodexWorkerRefresh(message, {
        isCancelled: () => false,
        post: reply => { const transported = structuredClone(reply); messages.push(transported); this.emit('message', transported); },
        acquireCodexIndexLease: async () => ({ release: async () => undefined }),
        loadCodexIndex: async () => roundTrip(stored), scanCodexManifest: f.scan,
        updateCodexIndex: (index, manifest, options) => updateCodexIndex(index, manifest,
          { ...options, io: f.options.io, now: f.options.now,
            ...(zeroBudget ? { budget: { maxFilePasses: 0, maxBytes: CODEX_REFRESH_MIN_BYTES } } : {}) }),
        saveCodexIndexAtomic: async (_file, index) => { stored = roundTrip(index); serialized.push(JSON.stringify(stored)); },
      });
    }
    terminate() { return 0; }
  }
  const client = new CodexIndexClient(() => new FixtureWorker() as CodexWorkerLike);
  const provider = new CodexProvider({ enabled: true, codexHome: f.root,
    indexPath: path.join(f.root, 'derived', 'index.json'), salt, timeZone: 'UTC', allowAchievementHourProof: false }, () => client);
  t.after(() => provider.dispose());
  f.renumber();
  const recovered = await provider.refresh('foreground', undefined, false);
  const terminal = messages.filter((m): m is Extract<CodexWorkerMessage, { type: 'result' }> => m.type === 'result').slice(-1)[0];
  assert.equal(terminal.result.forwardSourcesCurrent, true);
  assert.equal(recovered.snapshot.weeklyValueInputs?.codexForwardCalibration?.sources[0].eligible, true);
  assert.equal(recovered.snapshot.weeklyValueInputs?.codexForwardCalibration?.slicesVersion, 1);
  assert.ok(serialized.length > 0); assert.ok(serialized.every(s => !s.includes('forwardSourcesCurrent')));
  await f.rewrite(body(1)); zeroBudget = true;
  const pending = await provider.refresh('foreground', undefined, false);
  const last = messages.filter((m): m is Extract<CodexWorkerMessage, { type: 'result' }> => m.type === 'result').slice(-1)[0];
  assert.equal(last.result.forwardSourcesCurrent, false);
  assert.equal(pending.snapshot.weeklyValueInputs?.codexForwardCalibration, undefined);
  const { forwardSourcesCurrent: _bit, ...legacyResult } = terminal.result;
  const legacy = new CodexProvider({ enabled: true, codexHome: f.root,
    indexPath: path.join(f.root, 'derived', 'index.json'), salt, timeZone: 'UTC', allowAchievementHourProof: false },
  () => ({ refresh: async () => legacyResult, dispose() {} }));
  t.after(() => legacy.dispose());
  assert.equal((await legacy.refresh('foreground', undefined, false)).snapshot.weeklyValueInputs
    ?.codexForwardCalibration?.sources[0].eligible, false, 'older worker results cannot recover reset eligibility');
});
