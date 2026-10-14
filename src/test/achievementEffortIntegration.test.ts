import { test, type TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import type { AchievementEffortStatistics } from '../achievementEffortStatistics';
import type { CodexProviderSnapshot } from '../providers/codex/codexProvider';
import { buildCodexUsageView } from '../providers/codex/codexUsage';
import { createEmptyQuotaObservationStore } from '../quotaObservationStore';
import { snapshotFixture } from './codexFixtures';
import { immutableCodexAchievementFiles } from '../codexAchievementRevision';
import * as crypto from 'node:crypto';

// Same module shim / bare-prototype pattern as extensionWindowActivity.test.
// Loading the class does not construct or activate a second extension instance.
function loadExtensionModule(): typeof import('../extension') {
  const loader = require('node:module');
  const original = loader._load;
  const vscode: any = new Proxy(function () {}, {
    get: (_target, property) => property === 'then' || property === 'workspaceFolders' ? undefined : vscode,
    apply: () => vscode,
    construct: () => vscode,
  });
  loader._load = function (request: string, parent: unknown, isMain: boolean): unknown {
    return request === 'vscode' ? vscode : Reflect.apply(original, this, [request, parent, isMain]);
  };
  try { return require('../extension'); }
  finally { loader._load = original; }
}

const { ClaudeCodeUsageExtension } = loadExtensionModule();
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const HOME_A = 'C:\\synthetic\\effort-integration\\home-a';
const HOME_B = 'C:\\synthetic\\effort-integration\\home-b';

function forbidRecords(target: object): void {
  for (const name of ['records', 'fullRecords', 'rawRecords']) {
    Object.defineProperty(target, name, { configurable: true, get: () => {
      assert.fail(`effort adoption must not access ${name}`);
    } });
  }
}

function completeCurrentSnapshot(): CodexProviderSnapshot {
  const snapshot = snapshotFixture();
  snapshot.currentManifestVerified = true;
  Object.assign(snapshot.coverage, {
    complete: true, indexedFiles: snapshot.files.length, totalFiles: snapshot.files.length,
    indexedBytes: 1_300, totalBytes: 1_300,
  });
  // Period/hour coverage, lineage migration and request money provenance
  // retain the real fixture's values. This is only an
  // indexed current canonical census, not proof of whole-award scope authority.
  forbidRecords(snapshot);
  return snapshot;
}

function harness(): { extension: any; config: any; withdrawals: string[] } {
  const extension = Object.create(ClaudeCodeUsageExtension.prototype) as any;
  const config = { enableAchievements: true, codexDataDirectory: HOME_A, timezone: 'UTC',
    pricingBackend: 'anthropic', dataDirectory: '', dashboardAutoRefresh: false };
  const withdrawals: string[] = [];
  Object.assign(extension, {
    getConfiguration: () => config,
    settings: { get: () => false },
    codexView: null,
    codexInsights: {},
    disposed: false,
    configurationGeneration: 0,
    providerRefreshStates: { claude: { failed: false }, codex: { failed: false } },
    deliveredRefreshStates: {},
    quotaObservationStore: createEmptyQuotaObservationStore(),
    quotaFingerprintSalt: 'public-synthetic-effort-integration-salt',
    // The quota sink is unrelated to snapshot/proof adoption; no repository,
    // OAuth, worker, timer, watcher, provider log or filesystem is constructed.
    recordCodexQuotaObservations: async () => undefined,
    statusBar: { clearCodex: () => undefined, setVisibility: () => undefined },
    webviewProvider: {
      invalidateAchievementEvidence: (provider: string) => withdrawals.push(provider),
      updateRefreshState: () => undefined,
      invalidatePreparedAiRequests: () => undefined,
    },
    cache: {},
  });
  forbidRecords(extension.cache);
  return { extension, config, withdrawals };
}

function adopt(extension: any, snapshot: CodexProviderSnapshot): void {
  // Use the production owner; tolerate the owner's planned method rename.
  const prototype = ClaudeCodeUsageExtension.prototype as any;
  const method = prototype.adoptCodexSnapshot ?? prototype.applyCodexSnapshot;
  assert.equal(typeof method, 'function');
  method.call(extension, snapshot);
}

function instrument(t: TestContext) {
  const effort = require('../achievementEffortStatistics') as typeof import('../achievementEffortStatistics');
  const proof = require('../codexAchievementRevision') as typeof import('../codexAchievementRevision');
  const originalEffort = effort.codexAchievementEffortStatistics;
  const originalProof = proof.codexAchievementProofRevision;
  const calls = { effort: 0, proof: 0, files: [] as Array<readonly unknown[]> };
  effort.codexAchievementEffortStatistics = (files) => {
    calls.effort++;
    calls.files.push(files);
    return originalEffort(files);
  };
  proof.codexAchievementProofRevision = (...args) => {
    calls.proof++;
    return originalProof(...args);
  };
  t.after(() => {
    effort.codexAchievementEffortStatistics = originalEffort;
    proof.codexAchievementProofRevision = originalProof;
  });
  t.mock.method(Date, 'now', () => NOW);
  return calls;
}

function dto(extension: any): AchievementEffortStatistics {
  const result = extension.codexAchievementSignals?.effortStatistics;
  assert.ok(result, 'real snapshot owner must publish indexed effort statistics');
  assert.deepEqual(result.rows.map((row: any) => row.effort), EFFORTS);
  return result;
}

test('actual Codex snapshot owner publishes six bounded effort rows from canonical files', (t) => {
  const calls = instrument(t);
  const { extension } = harness();
  const snapshot = completeCurrentSnapshot();
  adopt(extension, snapshot);
  const result = dto(extension);
  assert.equal(calls.effort, 1);
  assert.equal(calls.files[0], snapshot.files, 'reuse the canonical aggregate census');
  assert.deepEqual(Object.keys(result).sort(), ['pricingVersion', 'referenceDate', 'rows']);
  assert.equal(result.referenceDate, '2026-10-09');
  assert.equal(typeof result.pricingVersion, 'string');
  assert.ok(result.pricingVersion.length > 0);
  const keys = ['effort', 'processed', 'output', 'qualifyingRoots', 'microUsd', 'amountPositive',
    'pricedTokens', 'unpricedTokens', 'pricingCoverage', 'status', 'valid', 'boundState'].sort();
  for (const row of result.rows) assert.deepEqual(Object.keys(row).sort(), keys);
  const high = result.rows.find(row => row.effort === 'high')!;
  assert.deepEqual(high, { effort: 'high', processed: 1_200, output: 200, qualifyingRoots: 1,
    microUsd: 7_400, amountPositive: true, pricedTokens: 1_200, unpricedTokens: 0,
    pricingCoverage: 1, status: 'complete', valid: true, boundState: 'exact' });
  const medium = result.rows.find(row => row.effort === 'medium')!;
  assert.equal(medium.processed, 120, 'unattached approval reviewer is not a qualifying root');
  assert.equal(medium.output, 20);
  assert.equal(medium.qualifyingRoots, 1);
  assert.equal(medium.microUsd, 404);
  const json = JSON.stringify(result);
  assert.ok(Buffer.byteLength(json) < 16 * 1_024);
  assert.deepEqual(JSON.parse(json), result);
  for (const file of snapshot.files) {
    for (const value of [file.session.sessionKey, file.session.parentSessionKey, file.session.projectKey,
      file.session.sessionTitle, ...Object.keys(file.byModel)]) {
      if (value) assert.equal(json.includes(value), false, `source metadata escaped into effort DTO: ${value}`);
    }
  }
  assert.equal(extension.codexView.currentManifestVerified, true);
  assert.equal(extension.codexAchievementSignals.dayEvidence.complete, false,
    'effort census does not upgrade unrelated historical proof');
});

test('unchanged cloned proof reuses identical effort DTO with zero extra helper calls across quota/title changes', (t) => {
  const calls = instrument(t);
  const { extension } = harness();
  const snapshot = completeCurrentSnapshot();
  adopt(extension, snapshot);
  const first = dto(extension);
  const firstRevision = extension.codexAchievementRevision;
  const firstView = extension.codexView;
  for (const change of ['clone', 'title', 'quota'] as const) {
    const next = structuredClone(snapshot);
    forbidRecords(next);
    if (change === 'title') next.files[0].session.sessionTitle = 'Public synthetic renamed task';
    if (change === 'quota') {
      next.limit!.observedAt = NOW - 1_000;
      next.limit!.windows[0].usedPercent = 67;
      next.limit!.windows[0].resetsAt = NOW + 60_000;
    }
    adopt(extension, next);
    assert.equal(dto(extension), first, `${change} must reuse the exact DTO object`);
    assert.equal(extension.codexAchievementRevision, firstRevision);
    assert.equal(calls.effort, 1, `${change} must not call the statistics helper again`);
    if (change === 'clone') assert.equal(extension.codexView, firstView);
    else assert.notEqual(extension.codexView, firstView, `${change} really changed the display contract`);
  }
});

test('actual host performs no additional history hash or effort evaluation on an immutable warm publication', (t) => {
  const calls = instrument(t), { extension, config } = harness();
  const snapshot = completeCurrentSnapshot();
  snapshot.files = immutableCodexAchievementFiles(snapshot.files);
  let hashes = 0, insideRevision = false;
  const proof = require('../codexAchievementRevision') as typeof import('../codexAchievementRevision');
  const calculateRevision = proof.codexAchievementProofRevision;
  proof.codexAchievementProofRevision = (...args) => {
    insideRevision = true;
    try { return calculateRevision(...args); } finally { insideRevision = false; }
  };
  const createHash = crypto.createHash;
  t.mock.method(crypto, 'createHash', (...args: Parameters<typeof createHash>) => {
    if (insideRevision) hashes++;
    return createHash(...args);
  });
  adopt(extension, snapshot);
  const first = extension.codexAchievementSignals, afterCold = hashes;
  assert.equal(afterCold, 1, 'host revision, calendar and money share one digest');
  adopt(extension, { ...snapshot });
  assert.equal(hashes, afterCold);
  assert.equal(calls.effort, 1);
  assert.equal(extension.codexAchievementSignals, first);
  config.enableAchievements = false;
  adopt(extension, snapshot);
  assert.equal(extension.codexAchievementRevision, undefined);
  config.enableAchievements = true;
  adopt(extension, snapshot);
  assert.notEqual(extension.codexAchievementSignals, first);
  assert.equal(calls.effort, 2, 're-enable reevaluates current authority even for immutable input');
});

test('effort-only counter proof change recomputes all six rows even when the rendered view remains equal', (t) => {
  const calls = instrument(t);
  const { extension } = harness();
  const snapshot = completeCurrentSnapshot();
  adopt(extension, snapshot);
  const first = dto(extension);
  const firstView = extension.codexView;
  const revision = extension.codexAchievementRevision;
  const changed = structuredClone(snapshot);
  forbidRecords(changed);
  changed.files[0].byEffort.high.cacheWriteInput = -1;
  assert.deepEqual(buildCodexUsageView(changed, NOW), buildCodexUsageView(snapshot, NOW),
    'the invalid optional effort proof counter must not change the display contract');
  adopt(extension, changed);
  const second = dto(extension);
  assert.equal(extension.codexView, firstView);
  assert.notEqual(extension.codexAchievementRevision, revision);
  assert.notEqual(second, first);
  assert.equal(calls.effort, 2);
  assert.equal(second.rows.find(row => row.effort === 'high')!.processed, 600);
  assert.equal(first.rows.find(row => row.effort === 'high')!.processed, 1_200,
    'previously published DTOs remain immutable');
  adopt(extension, structuredClone(changed));
  assert.equal(dto(extension), second);
  assert.equal(calls.effort, 2);
});

test('achievements OFF drops effort DTO and reads files only during existing canonical view construction', (t) => {
  const calls = instrument(t);
  const { extension, config } = harness();
  const snapshot = completeCurrentSnapshot();
  adopt(extension, snapshot);
  dto(extension);
  const previousCalls = { effort: calls.effort, proof: calls.proof };
  config.enableAchievements = false;
  const usage = require('../providers/codex/codexUsage') as typeof import('../providers/codex/codexUsage');
  const original = usage.buildCodexUsageView;
  let insideExistingViewWork = false;
  let fileReads = 0;
  usage.buildCodexUsageView = (...args) => {
    insideExistingViewWork = true;
    try { return original(...args); }
    finally { insideExistingViewWork = false; }
  };
  t.after(() => { usage.buildCodexUsageView = original; });
  const guarded = structuredClone(snapshot);
  const files = guarded.files;
  Object.defineProperty(guarded, 'files', { get: () => {
    fileReads++;
    assert.ok(insideExistingViewWork, 'OFF must not add an achievement census or fingerprint');
    return files;
  } });
  forbidRecords(guarded);
  adopt(extension, guarded);
  assert.ok(fileReads > 0, 'existing production display work still runs');
  assert.equal(calls.effort, previousCalls.effort);
  assert.equal(calls.proof, previousCalls.proof);
  assert.equal(extension.codexAchievementSignals.effortStatistics, undefined);
  assert.equal(extension.codexAchievementRevision, undefined);
  config.enableAchievements = true;
  adopt(extension, snapshot);
  dto(extension);
  assert.equal(calls.effort, previousCalls.effort + 1, 're-enable adopts current census');
});

for (const fence of ['unverified-manifest', 'incomplete-index'] as const) {
  test(`actual snapshot owner withholds effort DTO for ${fence}, including withdrawal of old rows`, (t) => {
    const calls = instrument(t);
    const { extension } = harness();
    const snapshot = completeCurrentSnapshot();
    const incomplete = structuredClone(snapshot);
    if (fence === 'unverified-manifest') incomplete.currentManifestVerified = false;
    else incomplete.coverage.complete = false;
    forbidRecords(incomplete);
    adopt(extension, incomplete);
    assert.equal(extension.codexAchievementSignals.effortStatistics, undefined,
      'unknown census is unavailable, never six invented zero rows');
    assert.equal(calls.effort, 0);
    adopt(extension, snapshot);
    const previous = dto(extension);
    assert.equal(calls.effort, 1);
    adopt(extension, incomplete);
    assert.equal(extension.codexAchievementSignals.effortStatistics, undefined,
      'a previously verified DTO must be withdrawn when current census proof is lost');
    assert.equal(calls.effort, 1);
    assert.equal(previous.rows.find(row => row.effort === 'high')!.processed, 1_200);
    adopt(extension, snapshot);
    assert.notEqual(dto(extension), previous);
    assert.equal(calls.effort, 2);
  });
}

test('actual source-home retirement clears effort DTO before another source is adopted', (t) => {
  const calls = instrument(t);
  const { extension, config, withdrawals } = harness();
  const snapshot = completeCurrentSnapshot();
  adopt(extension, snapshot);
  const previous = dto(extension);
  const oldHome = extension.codexSnapshotHome;
  extension.selectCodexSnapshotHome(oldHome);
  assert.equal(dto(extension), previous, 'same-source selection retains proof');
  config.codexDataDirectory = HOME_B;
  // Windows-style synthetic names are identity inputs only. The production
  // selector resets in-memory state without reading or creating either home.
  extension.selectCodexSnapshotHome(extension.codexHome(config));
  assert.notEqual(extension.codexSnapshotHome, oldHome);
  assert.equal(extension.codexView, null);
  assert.equal(extension.codexAchievementSignals.effortStatistics, undefined);
  assert.equal(extension.codexAchievementRevision, undefined);
  assert.equal(extension.codexSkipPersistedHydration, true);
  assert.deepEqual(withdrawals, ['codex']);
  assert.equal(calls.effort, 1, 'retiring a source does not compute its statistics');
  const unverified = structuredClone(snapshot);
  unverified.currentManifestVerified = false;
  adopt(extension, unverified);
  assert.equal(extension.codexAchievementSignals.effortStatistics, undefined);
  assert.equal(calls.effort, 1);
  adopt(extension, snapshot);
  assert.notEqual(dto(extension), previous);
  assert.equal(calls.effort, 2);
});

test('actual configuration replacement revokes old-view effort DTO before provider retirement', (t) => {
  const calls = instrument(t);
  const { extension, config } = harness();
  adopt(extension, completeCurrentSnapshot());
  const previous = dto(extension);
  const verifiedView = extension.codexView;
  extension.activePricingBackend = config.pricingBackend;
  extension.windowActivity = { focused: false };
  extension.codexProvider = { cancel: () => undefined };
  // Run the real configuration owner, isolating its unrelated lifecycle I/O.
  for (const method of ['cancelAdviceNetworks', 'cancelQuotaNetworks', 'stopQuotaColdRetry',
    'startAutoRefresh', 'stopFileWatching', 'stopCodexWatching', 'stopCredentialsWatching',
    'selectClaudeProfile', 'applyFormattingConfiguration', 'trackCodexProviderRetirement']) {
    extension[method] = () => undefined;
  }
  extension.createCodexProvider = () => ({ cancel: () => undefined });
  const publications: Array<{ verified: boolean; effort: unknown }> = [];
  extension.syncProviderUi = () => publications.push({
    verified: extension.codexView.currentManifestVerified,
    effort: extension.codexAchievementSignals.effortStatistics,
  });
  extension.onConfigurationChanged();
  assert.equal(extension.codexView.currentManifestVerified, false);
  assert.equal(verifiedView.currentManifestVerified, true);
  assert.ok(publications.length > 0);
  for (const publication of publications) {
    assert.equal(publication.verified, false);
    assert.equal(publication.effort, undefined, 'revoked view must not deliver the old verified effort DTO');
  }
  assert.equal(extension.codexAchievementSignals.effortStatistics, undefined);
  assert.equal(calls.effort, 1, 'revocation cannot invoke a census helper');
  assert.equal(previous.rows.find(row => row.effort === 'high')!.processed, 1_200);
});
