import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { formatRefreshDiagnostic, formatCodexIndexDiagnostic } from '../refreshDiagnostics';

const native = (): any => require(path.resolve(__dirname, '../../tests/native/runner.cjs'));
const claude = (bodyReads: number | null, bytesRead: number | null): string => formatRefreshDiagnostic({
  trigger: 'manual', filesDiscovered: 3, filesChanged: 0, filesReused: 3, filesRemoved: 0,
  filesFailed: 0, bytesRead, linesParsed: 0, bodyReads, aggregateMutations: 0,
  watcherEvents: 0, coalescedTriggers: 0, quotaWatcherMissingFilenameEvents: 0,
  manifestMs: 1, readParseMs: 0, aggregateRenderMs: 0, totalMs: 1,
});
const codex = (bodyReads: number | null): string => formatCodexIndexDiagnostic({
  trigger: 'manual', outcome: 'success', watcherEvents: 0, coalescedTriggers: 0,
  backfillMode: 'steady', workerMode: 'foreground', indexedFiles: 3, totalFiles: 3,
  indexedBytes: 1024, totalBytes: 1024, periodMigratedBytes: 1024, periodTotalBytes: 1024,
  migrationPending: false, bodyReads, failedFiles: 0, metadataMs: 1, parseMs: 0, qualityFlags: {},
});

test('native I/O probe reads only known counts from actual production diagnostic formats', () => {
  const probe = native().createRefreshIoProbe();
  probe.observe(claude(0, 0)); probe.observe(codex(0));
  assert.deepEqual(probe.snapshot(), {
    claude: { records: 1, bodyReads: 0, unknownBodyReads: 0, bytesRead: 0, unknownBytesRead: 0 },
    codex: { records: 1, bodyReads: 0, unknownBodyReads: 0 },
  });
});

test('native I/O probe keeps unknown counts distinct from proven zero', () => {
  const probe = native().createRefreshIoProbe();
  probe.observe(claude(null, null)); probe.observe(codex(null));
  const state = probe.snapshot();
  assert.equal(state.claude.unknownBodyReads, 1);
  assert.equal(state.claude.unknownBytesRead, 1);
  assert.equal(state.codex.unknownBodyReads, 1);
  assert.throws(() => native().assertZeroBodyWarmRefreshes(state, 1), /known warm I\/O/);
});

test('native I/O probe rejects body reads and insufficient observed refreshes', () => {
  const probe = native().createRefreshIoProbe();
  probe.observe(claude(0, 0)); probe.observe(codex(1));
  assert.throws(() => native().assertZeroBodyWarmRefreshes(probe.snapshot(), 1), /zero warm body reads/);
  assert.throws(() => native().assertZeroBodyWarmRefreshes(probe.snapshot(), 20), /observed warm refreshes/);
});

test('native I/O probe discards unrelated output and keeps copied fixed-size numeric summaries', () => {
  const probe = native().createRefreshIoProbe();
  probe.observe('private user path and exception text'); probe.observe(undefined);
  probe.observe('refresh: '.repeat(1000));
  probe.observe(claude(1, 100));
  const snapshot = probe.snapshot(); snapshot.claude.bodyReads = 999;
  assert.equal(probe.snapshot().claude.bodyReads, 1);
  for (let i = 0; i < 10_000; i++) probe.observe(codex(0));
  assert.equal(probe.snapshot().codex.records, 10_000);
  assert.ok(JSON.stringify(probe.snapshot()).length < 300);
  assert.ok(!JSON.stringify(probe.snapshot()).includes('private'));
});

test('native I/O probe treats unsafe numeric sums as unknown instead of false exact counts', () => {
  const probe = native().createRefreshIoProbe();
  probe.observe(claude(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER));
  probe.observe(claude(1, 1));
  assert.equal(probe.snapshot().claude.unknownBodyReads, 1);
  assert.equal(probe.snapshot().claude.unknownBytesRead, 1);
});

test('native settle waits for actual provider retirements, not only refresh gates', async () => {
  const retirements = new Set<Promise<void>>();
  const retirement = new Promise<void>(resolve => setTimeout(() => { retirements.delete(retirement); resolve(); }, 30));
  retirements.add(retirement);
  const instance = { initializationWrites: Promise.resolve(), initializationWriteFailure: null,
    refreshGate: { active: false }, activeCodexRefreshes: new Set(), codexCheckpointHydration: null,
    pendingResourceStops: new Set(), codexProviderRetirements: retirements,
    codexProviderRetirementFailure: null, codexBackgroundStateWrite: Promise.resolve() };
  await native().settle(instance);
  assert.equal(retirements.size, 0);
});

test('native settle does not turn a retirement failure into a passing resource assertion', async () => {
  const instance = { initializationWrites: Promise.resolve(), initializationWriteFailure: null,
    refreshGate: { active: false }, activeCodexRefreshes: new Set(), codexCheckpointHydration: null,
    pendingResourceStops: new Set(), codexProviderRetirements: new Set(),
    codexProviderRetirementFailure: new Error('test-only'), codexBackgroundStateWrite: Promise.resolve() };
  await assert.rejects(native().settle(instance), /native-test-runner:provider-retirement/);
});
