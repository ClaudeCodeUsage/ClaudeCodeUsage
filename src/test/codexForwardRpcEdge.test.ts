import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexForwardAccountEstimator } from '../codexForwardAccountEstimate';
import type { OfficialQuotaSample } from '../codexAccountEstimate';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { defaultCodexJsonlReader } from '../providers/codex/codexJsonlScanner';
import { buildCodexForwardCalibration, isCodexForwardAppend, isCodexForwardCalibration,
  CodexForwardCalibration, CodexForwardAppendWindow } from '../providers/codex/codexForwardCalibration';

const T = Date.parse('2026-10-20T02:00Z'), R = T + 6 * 86400000;
const salt = 'synthetic-rpc-edge';
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .001, cachedInput: .0001, output: .002 }] };
const json = (value: object) => JSON.stringify(value) + '\n';
interface Request { at: number; input: number; percent: number }
const request = ({ at, input, percent }: Request) => json({ type: 'event_msg',
  timestamp: new Date(at).toISOString(), payload: { type: 'token_count',
    info: { last_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 0 } },
    rate_limits: { limit_id: 'codex', secondary: {
      used_percent: percent, window_minutes: 10080, resets_at: R } } } });
const sample = (proof: CodexForwardCalibration, usedPercent: number): OfficialQuotaSample => ({
  accountScopeKey: 'a'.repeat(64), sourceScopeKey: 'b'.repeat(64),
  requestedAt: proof.verifiedAt + 100, observedAt: proof.verifiedAt + 7000,
  usedPercent, resetAt: R,
  quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' },
});

/** Only temporary synthetic JSONL is read. Use the production manifest, reader,
 * scanner and proof producer, carrying live proof authority across DTO reloads. */
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-forward-rpc-edge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', 'synthetic.jsonl');
  await writeFile(file, json({ type: 'session_meta', payload: { id: 'synthetic-rpc-edge-root' } }) +
    json({ type: 'turn_context', payload: { model: 'gpt-5' } }) +
    request({ at: T + 9000, input: 100, percent: 10 }));
  let disk = createEmptyCodexIndex('UTC'), previous: CodexForwardCalibration | undefined;
  const reads: Array<{ start: number; end: number }> = [];
  const snapshot = async (at: number) => {
    const result = await updateCodexIndex(disk, await scanCodexManifest(root, salt), {
      salt, timeZone: 'UTC', now: () => at,
      allowHistoricalBackfill: false, allowAchievementHourProof: false,
      io: { read(entry, start, end, control) {
        reads.push({ start, end });
        return defaultCodexJsonlReader.read(entry, start, end, control);
      } },
    });
    assert.equal(result.failedFiles, 0);
    const proof = buildCodexForwardCalibration(result.index, true,
      new Set(Object.keys(result.index.files)), new Set(), at, {}, previous);
    assert.ok(proof);
    assert.equal(isCodexForwardCalibration(proof), true);
    assert.equal(proof.sources.length, 1);
    assert.equal(proof.sources[0].eligible, true);
    assert.equal(proof.sources[0].uncertain, false);
    assert.deepEqual(Object.values(result.index.files)[0].qualityFlags, []);
    disk = normalizeCodexIndex(JSON.parse(JSON.stringify(result.index)))!;
    assert.ok(disk);
    assert.equal(Object.values(disk.files)[0].calibrationAppend, undefined);
    previous = proof;
    return proof;
  };
  const append = async (...requests: Request[]) => {
    await appendFile(file, requests.map(request).join(''));
  };
  return { append, snapshot, reads };
}

function appendBounds(window: CodexForwardAppendWindow | undefined) {
  assert.ok(window);
  const { beforeOffset, throughOffset, minUsageAt, maxUsageAt, complete } = window;
  return { beforeOffset, throughOffset, minUsageAt, maxUsageAt, complete };
}

function assertAppend(before: CodexForwardCalibration, after: CodexForwardCalibration,
  minUsageAt: number, maxUsageAt: number) {
  const prior = before.sources[0], source = after.sources[0];
  assert.equal(isCodexForwardAppend(prior, source), true);
  assert.deepEqual(appendBounds(source.appendWindow), { beforeOffset: prior.offset, throughOffset: source.offset,
    minUsageAt, maxUsageAt, complete: true });
  assert.equal(source.quotaWitness?.observedAt, maxUsageAt);
}

test('r18 withholds the entire interval when a legitimate request lands in the preceding official RPC', async t => {
  const f = await fixture(t), estimator = new CodexForwardAccountEstimator();
  const before = await f.snapshot(T + 10000), first = sample(before, 10);
  assert.equal(first.observedAt - before.verifiedAt, 7000);
  assert.equal(estimator.observe(first, before, book), undefined);
  assert.equal(estimator.calibrationDiagnostics().reason, 'baseline-empty');

  const edge = { at: T + 14000, input: 1000, percent: 10 };
  const interior = { at: T + 30000, input: 9000, percent: 20 };
  assert.ok(first.requestedAt < edge.at && edge.at < first.observedAt);
  await f.append(edge, interior);
  const after = await f.snapshot(T + 60000), last = sample(after, 20);
  assert.ok(first.observedAt < interior.at && interior.at < last.requestedAt);
  assertAppend(before, after, edge.at, interior.at);
  assert.deepEqual(f.reads[1], { start: before.sources[0].offset, end: after.sources[0].offset });
  assert.equal(after.sources[0].byModel!['gpt-5'].inputTotal -
    before.sources[0].byModel!['gpt-5'].inputTotal, edge.input + interior.input);
  assert.equal(after.sources[0].quotaWitness?.usedPercent, last.usedPercent);

  assert.equal(estimator.observe(last, after, book), undefined,
    'neither the complete append USD nor its interior subset may become an estimate');
  assert.deepEqual(estimator.calibrationDiagnostics(), { state: 'append-incomplete',
    reason: 'usage-before-baseline', deltaPercent: 0, intervals: 0,
    proofAgeMs: 7000, bracketGapMs: 50000 });
  assert.equal(isCodexForwardCalibration({ ...after }), false, 'copied evidence has no runtime authority');
});

test('a quiet RPC edge permits a fit only after discarding the first measurable step', async t => {
  const f = await fixture(t), estimator = new CodexForwardAccountEstimator();
  const initial = await f.snapshot(T + 10000);
  assert.equal(estimator.observe(sample(initial, 10), initial, book), undefined);
  await f.append({ at: T + 30000, input: 9000, percent: 20 });
  const aligned = await f.snapshot(T + 60000), firstStep = sample(aligned, 20);
  assertAppend(initial, aligned, T + 30000, T + 30000);
  assert.equal(firstStep.observedAt - aligned.verifiedAt, 7000, 'the same RPC latency is safe when quiet');
  assert.equal(estimator.observe(firstStep, aligned, book), undefined);
  assert.deepEqual(estimator.calibrationStatus(), { state: 'first-step-discarded', deltaPercent: 0, intervals: 0 });

  await f.append({ at: T + 90000, input: 2000, percent: 30 });
  const after = await f.snapshot(T + 110000), last = sample(after, 30);
  assertAppend(aligned, after, T + 90000, T + 90000);
  const estimate = estimator.observe(last, after, book);
  assert.ok(estimate);
  assert.equal(estimator.calibrationDiagnostics().reason, 'calibrated');
  assert.equal(estimate.usedEquivalentUsd, 2, 'the discarded first-step USD is excluded');
  assert.equal(estimate.fullEquivalentUsd, 20);
  assert.equal(estimate.calibrationStart, firstStep.observedAt);
  assert.equal(estimate.calibrationEvidence?.interval.from, firstStep.observedAt);
  assert.equal(estimate.calibrationEvidence?.interval.through, last.observedAt);
  assert.deepEqual(estimate.calibrationEvidence?.accumulated, {
    intervals: 1, deltaPercent: 10, deltaUsd: 2, pricedTokens: 2000, totalTokens: 2000,
  });
});

test('equal append min/max and aggregate tokens cannot identify the interior USD allocation', async t => {
  const traces = [];
  for (const [edgeInput, interiorInput] of [[1000, 9000], [9000, 1000]]) {
    const f = await fixture(t), estimator = new CodexForwardAccountEstimator();
    const before = await f.snapshot(T + 10000), first = sample(before, 10);
    assert.equal(estimator.observe(first, before, book), undefined);
    const requests = [{ at: T + 14000, input: edgeInput, percent: 10 },
      { at: T + 30000, input: interiorInput, percent: 20 }];
    await f.append(...requests);
    const after = await f.snapshot(T + 60000);
    assertAppend(before, after, requests[0].at, requests[1].at);
    assert.equal(estimator.observe(sample(after, 20), after, book), undefined);
    assert.equal(estimator.calibrationDiagnostics().reason, 'usage-before-baseline');
    assert.deepEqual(estimator.calibrationStatus(), { state: 'append-incomplete', deltaPercent: 0, intervals: 0 });
    traces.push({ before: before.sources[0], after: after.sources[0],
      // An oracle over these authored requests, never estimator input. The
      // aggregate and time bounds alone have no per-request price partition.
      interiorUsd: requests.filter(r => r.at > first.observedAt)
        .reduce((usd, r) => usd + r.input * book.rates[0].input, 0) });
  }
  const [a, b] = traces;
  assert.deepEqual(a.before.byModel, b.before.byModel);
  assert.deepEqual(a.after.byModel, b.after.byModel);
  assert.deepEqual(appendBounds(a.after.appendWindow), appendBounds(b.after.appendWindow));
  const aSlices = a.after.appendWindow?.slices, bSlices = b.after.appendWindow?.slices;
  if (aSlices !== undefined || bSlices !== undefined) {
    assert.ok(aSlices && bSlices, 'optional numeric detail must be captured for both equivalent scans');
    assert.notDeepEqual(aSlices, bSlices, 'per-request numeric detail distinguishes the two USD allocations');
  }
  assert.deepEqual(a.after.quotaWitness, b.after.quotaWitness);
  assert.equal(a.after.incrementFrom, null);
  assert.equal(b.after.incrementFrom, null);
  assert.equal(a.after.byModel!['gpt-5'].inputTotal - a.before.byModel!['gpt-5'].inputTotal, 10000);
  assert.equal(a.interiorUsd, 9);
  assert.equal(b.interiorUsd, 1);
  assert.notEqual(a.interiorUsd, b.interiorUsd,
    'identical aggregate USD and time bounds cannot justify clipping or prorating an RPC edge');
});
