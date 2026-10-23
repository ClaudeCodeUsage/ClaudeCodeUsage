import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { CodexProvider } from '../providers/codex/codexProvider';
import { CodexFileContribution, CodexIndexV1, createEmptyCodexIndex } from '../providers/codex/codexIndex';
import * as codexIndex from '../providers/codex/codexIndex';
import { createCodexQuotaCheckpointState, CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT } from '../providers/codex/codexQuotaCheckpoints';
import type { CodexWitnessCycle } from '../codexWitnessCycles';

const T = Date.parse('2026-01-01T00:00:00Z'), R = T + 604800000;
const MODEL = 'gpt-5.6-sol';
const tokens = (n: number) => ({ inputTotal: n, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 });

function file(id: number, model = MODEL, count = 2): CodexFileContribution {
  const fileKey = id.toString(16).padStart(64, '0');
  const state = createCodexQuotaCheckpointState(0);
  state.indexedThrough = 100;
  state.rows = Array.from({ length: count }, (_, i) => ({
    segment: 0, from: T, through: T + i * 1000, resetAt: R,
    usedPercent: i / (count - 1) * 50, baseline: i === 0,
    byModel: i ? { [model]: tokens(i) } : {},
    ...(i === 0 ? { baselineByModel: {} } : {}), complete: true,
  }));
  return {
    fileKey, sourceArea: 'sessions', size: 100, offset: 100, mtimeMs: 1,
    discardingOversizedLine: false, identityChecked: true,
    parserState: { schemaVersion: 4, fileKey, sessionKey: fileKey, role: 'root', qualityFlags: [] },
    qualityFlags: [], quotaCheckpoints: state,
    aggregate: {
      total: tokens(count - 1), byModel: { [model]: tokens(count - 1) }, byDay: {}, byEffort: {},
      session: { sessionKey: fileKey, role: 'root', startedAt: T, endedAt: T + (count - 1) * 1000 },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 },
    },
  };
}

function indexOf(files: CodexFileContribution[]): CodexIndexV1 {
  const index = createEmptyCodexIndex('UTC');
  index.files = Object.fromEntries(files.map(f => [f.fileKey, f]));
  index.coverage.complete = true;
  index.coverage.totalFiles = files.length;
  return index;
}

async function project(t: TestContext, index: CodexIndexV1, cachedOnly = false) {
  const before = JSON.stringify(index);
  const provider = new CodexProvider({ enabled: true, codexHome: '/synthetic-not-read',
    indexPath: '/synthetic-not-written/index.json', salt: 'synthetic', timeZone: 'UTC' }, () => ({
    refresh: async () => ({ index, indexChanged: false, bodyReads: 0, failedFiles: 0,
      metadataMs: 0, parseMs: 0, migration: { filePasses: 0, bytesRead: 0, pending: false } }),
    dispose() {},
  }));
  t.mock.method(provider, 'isAvailable', async () => true);
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  if (cachedOnly) t.mock.method(codexIndex, 'loadCodexIndex', async () => index);
  // The facade receives retained state: neither a scan nor a cache write is
  // necessary. Any filesystem access beyond the mocked existing boundary fails.
  for (const name of ['readFile', 'writeFile', 'open', 'rename', 'mkdir', 'unlink'] as const) {
    t.mock.method(fs, name, async () => { throw new Error(`unexpected ${name}`); });
  }
  t.after(async () => {
    assert.equal(JSON.stringify(index), before, 'primary/cache DTO must stay unchanged');
    for (const name of ['readFile', 'writeFile', 'open', 'rename', 'mkdir', 'unlink'] as const) {
      assert.equal((fs[name] as any).mock.callCount(), 0, `no ${name}`);
    }
    await provider.dispose();
  });
  const snapshot = cachedOnly ? await provider.loadPersistedSnapshot() : (await provider.refresh()).snapshot;
  assert.ok(snapshot);
  return { provider, snapshot };
}

// Structural access lets the first red test compile before the runtime field exists.
const cycles = (inputs: unknown): readonly CodexWitnessCycle[] =>
  (inputs as { codexWitnessCycles?: readonly CodexWitnessCycle[] })?.codexWitnessCycles ?? [];

test('witness aggregation uses all retained per-file rows before the global snapshot cap', async t => {
  const { snapshot } = await project(t, indexOf(Array.from({ length: 129 }, (_, i) => file(i + 1, MODEL, 512))));
  assert.equal(snapshot.weeklyValueInputs?.codexQuotaCheckpoints?.length, CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT);
  const result = cycles(snapshot.weeklyValueInputs);
  assert.equal(result.length, 1);
  assert.equal(result[0].knownTokens, 129 * 511);
  assert.equal(result[0].sources, 129);
  assert.equal(result[0].partial, false, 'global snapshot selection does not erase retained evidence');
});

test('unpriced retained tokens preserve priced known amounts and cache-only reads become partial', async t => {
  const { provider, snapshot } = await project(t, indexOf([file(1), file(2, 'unknown-witness-model')]));
  const current = cycles(snapshot.weeklyValueInputs)[0];
  assert.ok(current);
  assert.equal(current.knownTokens, 1);
  assert.equal(current.unpricedTokens, 1);
  assert.equal(current.pricingCoverage, 0.5);
  assert.equal(current.partial, true);
  const rate = snapshot.weeklyValueInputs!.calibrationPricebook!.rates.find(r => r.model === MODEL)!;
  assert.equal(current.knownUsd, rate.input);
  const cached = await provider.loadPersistedSnapshot();
  assert.equal(cached?.currentManifestVerified, false);
  assert.equal(cycles(cached?.weeklyValueInputs)[0].knownUsd, current.knownUsd);
  assert.equal(cycles(cached?.weeklyValueInputs)[0].partial, true);
});

test('unverified cached witnesses keep amounts while dropping completeness', async t => {
  const { provider, snapshot } = await project(t, indexOf([file(1)]));
  assert.equal(cycles(snapshot.weeklyValueInputs)[0]?.partial, false);
  const cached = await provider.loadPersistedSnapshot();
  assert.equal(cycles(cached?.weeklyValueInputs)[0]?.knownTokens, 1);
  assert.equal(cycles(cached?.weeklyValueInputs)[0]?.partial, true);
  assert.equal(cached?.weeklyValueInputs?.codexForwardCalibration, undefined);
});

test('initial cache hydration builds partial witnesses without manifest verification or source reads', async t => {
  const { snapshot } = await project(t, indexOf([file(1)]), true);
  assert.equal(snapshot.currentManifestVerified, false);
  assert.equal(cycles(snapshot.weeklyValueInputs)[0]?.knownTokens, 1);
  assert.equal(cycles(snapshot.weeklyValueInputs)[0]?.partial, true);
  assert.ok(cycles(snapshot.weeklyValueInputs)[0]?.knownUsd > 0);
  assert.equal(snapshot.weeklyValueInputs?.codexForwardCalibration, undefined);
});

test('pending lineage and stale primary contributions never supply witness amounts', async t => {
  const pending = file(2), stale = file(3);
  pending.lineage = { fingerprintBlocks: [], pendingFingerprints: [], tokenEvents: 2,
    appliedPrefixEvents: 0, desiredPrefixEvents: 1 };
  pending.quotaCheckpoints!.prefixEvents = 1;
  stale.qualityFlags = ['stale-reset-required'];
  const { snapshot } = await project(t, indexOf([file(1), pending, stale]));
  const result = cycles(snapshot.weeklyValueInputs)[0];
  assert.equal(result?.knownTokens, 1);
  assert.equal(result?.unavailableSources, 2);
  assert.equal(result?.partial, true);
});

test('an unread tail preserves the retained primary prefix as partial evidence', async t => {
  const retained = file(1);
  retained.size += 100;
  retained.qualityFlags = ['stale-file'];
  const { snapshot } = await project(t, indexOf([retained]));
  const result = cycles(snapshot.weeklyValueInputs)[0];
  assert.equal(result?.knownTokens, 1);
  assert.equal(result?.partial, true);
  assert.equal(result?.unavailableSources, 0);
});

test('missing or mismatched checkpoint prefixes omit only affected sources and disclose coverage', async t => {
  const missing = file(2), mismatched = file(3);
  delete missing.quotaCheckpoints;
  mismatched.quotaCheckpoints!.prefixEvents = 1;
  const { snapshot } = await project(t, indexOf([file(1), missing, mismatched]));
  const result = cycles(snapshot.weeklyValueInputs)[0];
  assert.ok(result);
  assert.equal(result.knownTokens, 1);
  assert.equal(result.unavailableSources, 2);
  assert.equal(result.partial, true);
  assert.equal(snapshot.total.inputTotal, 3, 'primary accounting remains intact');
});

test('canonical duplicates count once and genuinely ambiguous duplicates are excluded', async t => {
  const own = file(1), active = file(2), archive = structuredClone(active);
  archive.fileKey = 'a'.repeat(64); archive.sourceArea = 'archive';
  const ambiguous = file(3), other = structuredClone(ambiguous);
  other.fileKey = 'b'.repeat(64); other.aggregate.total.inputTotal += 1;
  const { snapshot } = await project(t, indexOf([own, active, archive, ambiguous, other]));
  const result = cycles(snapshot.weeklyValueInputs)[0];
  assert.ok(result);
  assert.equal(result.sources, 2);
  assert.equal(result.knownTokens, 2);
  assert.equal(result.unavailableSources, 2);
  assert.equal(result.partial, true);
});

test('zero-row primary usage survives an empty ledger as unlocated priced and unpriced coverage', async t => {
  const priced = file(1), unpriced = file(2, 'unknown-witness-model');
  priced.quotaCheckpoints!.rows = [];
  unpriced.quotaCheckpoints!.rows = [];
  const { provider, snapshot } = await project(t, indexOf([priced, unpriced]));
  const inputs = snapshot.weeklyValueInputs!;
  const rate = inputs.calibrationPricebook!.rates.find(r => r.model === MODEL)!;
  assert.deepEqual(cycles(inputs), []);
  assert.deepEqual(inputs.codexWitnessCoverage, {
    unplacedSources: 2, unlocatedPrimaryUsd: rate.input,
    unlocatedUnpricedTokens: 1, rejectedSources: 0,
  });
  const cached = await provider.loadPersistedSnapshot();
  assert.deepEqual(cached?.weeklyValueInputs?.codexWitnessCoverage, inputs.codexWitnessCoverage);
  assert.equal(snapshot.total.inputTotal, 2);
});

test('unlocated primary amounts never enter the numerator of a located cycle', async t => {
  const unlocated = file(2, MODEL, 5);
  unlocated.quotaCheckpoints!.rows = [];
  const { snapshot } = await project(t, indexOf([file(1), unlocated]));
  const inputs = snapshot.weeklyValueInputs!;
  const rate = inputs.calibrationPricebook!.rates.find(r => r.model === MODEL)!;
  assert.equal(cycles(inputs)[0].knownTokens, 1);
  assert.equal(cycles(inputs)[0].knownUsd, rate.input);
  assert.equal(cycles(inputs)[0].partial, true);
  assert.deepEqual(inputs.codexWitnessCoverage, {
    unplacedSources: 1, unlocatedPrimaryUsd: 4 * rate.input,
    unlocatedUnpricedTokens: 0, rejectedSources: 0,
  });
});

test('excluded-source coverage survives when no cycle or assignable primary amount remains', async t => {
  const missing = file(1), mismatched = file(2);
  delete missing.quotaCheckpoints;
  mismatched.quotaCheckpoints!.prefixEvents = 1;
  const { snapshot } = await project(t, indexOf([missing, mismatched]));
  assert.deepEqual(cycles(snapshot.weeklyValueInputs), []);
  assert.deepEqual(snapshot.weeklyValueInputs?.codexWitnessCoverage, {
    unplacedSources: 0, unlocatedPrimaryUsd: 0,
    unlocatedUnpricedTokens: 0, rejectedSources: 2,
  });
});
