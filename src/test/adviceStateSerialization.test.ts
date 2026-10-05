import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');

import {
  ADVICE_LOCAL_STATE_KEY,
  AdviceLocalState,
  AdviceLocalStateStorage,
  createClosedAdviceLocalState,
  snoozeAdviceRecommendation,
} from '../adviceEffectiveness/versionedPersistence';
import { I18n } from '../i18n';
import { prepareStructuredAdviceInvocation } from '../adviceEffectiveness/remoteAdvice';
import { payloadInputFixture } from './adviceTestFixtures';

class ControlledStorage implements AdviceLocalStateStorage {
  public value: AdviceLocalState | undefined;
  public readonly pending: Array<{
    value: AdviceLocalState | undefined;
    resolve: () => void;
  }> = [];

  constructor(value: AdviceLocalState) {
    this.value = value;
  }

  get<T>(key: string): T | undefined {
    return key === ADVICE_LOCAL_STATE_KEY ? this.value as T : undefined;
  }

  update(key: string, value: unknown): Promise<void> {
    assert.equal(key, ADVICE_LOCAL_STATE_KEY);
    return new Promise((resolve) => {
      this.pending.push({
        value: value as AdviceLocalState | undefined,
        resolve: () => {
          this.value = value as AdviceLocalState | undefined;
          resolve();
        },
      });
    });
  }

  releaseNext(): void {
    const next = this.pending.shift();
    assert.ok(next, 'expected a pending state write');
    next.resolve();
  }
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function createProvider(storage: AdviceLocalStateStorage): Promise<any> {
  const originalLoad = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') {
      return { workspace: { workspaceFolders: [] } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let UsageWebviewProvider: typeof import('../webview').UsageWebviewProvider;
  try {
    ({ UsageWebviewProvider } = require('../webview') as typeof import('../webview'));
  } finally {
    (Module as any)._load = originalLoad;
  }
  // The real globalState is keyed. Keep advice's controlled writer isolated
  // from unrelated achievement migration keys used by the same provider.
  const otherState = new Map<string, unknown>();
  const keyedStorage = {
    get<T>(key: string): T | undefined {
      return key === ADVICE_LOCAL_STATE_KEY ? storage.get<T>(key) : otherState.get(key) as T | undefined;
    },
    update(key: string, value: unknown): Promise<void> {
      if (key === ADVICE_LOCAL_STATE_KEY) return Promise.resolve(storage.update(key, value));
      if (value === undefined) otherState.delete(key); else otherState.set(key, value);
      return Promise.resolve();
    },
  };
  const provider = new UsageWebviewProvider({ globalState: keyedStorage } as any) as any;
  await nextTurn();
  provider.settings = { get: (key: string) => key === 'advice.effectiveness.enabled' };
  provider.adviceLocalStateStatus = 'ready';
  provider.postAdviceMessage = () => undefined;
  return provider;
}

function grantedState(promptSamples = false): AdviceLocalState {
  const state = createClosedAdviceLocalState();
  state.featureMode = 'enabled';
  state.aggregateConsent = 'explicit';
  state.promptSampleConsent = promptSamples ? 'explicit' : 'not-granted';
  return state;
}

async function preparedProvider(storage: AdviceLocalStateStorage, initial: AdviceLocalState) {
  const provider = await createProvider(storage);
  const input = payloadInputFixture();
  const messages: Array<Record<string, unknown>> = [];
  provider.adviceLocalState = initial;
  provider.postAdviceMessage = (message: Record<string, unknown>) => messages.push(message);
  provider.adviceEffectivenessStates = {
    claude: {
      provider: 'claude', remotePreviewEligible: true, aggregate: input.aggregate,
      promptSamples: [{ text: 'synthetic consent fixture' }],
      contract: {
        adviceId: 'advice-consent-test', recommendations: [],
        observations: input.observations, evidence: input.evidence,
        provenance: { locale: input.locale, sources: input.sources },
      },
    },
  };
  provider.onPrepareAdviceInvocation = (snapshot: any, sourceRevision: string, consentGeneration: number) =>
    prepareStructuredAdviceInvocation(snapshot.prepared, {
      apiFormat: 'openai', apiUrl: 'https://example.invalid/v1', model: 'fixture',
      sourceRevision, consentGeneration, createdAtEpochMs: 1_000,
    });
  provider.handlePrepareAdviceSnapshotMessage({
    provider: 'claude', aggregateConsent: 'explicit',
    promptSampleConsent: initial.promptSampleConsent,
  });
  assert.equal(provider.preparedAdviceSnapshots.size, 1);
  const snapshotId = [...provider.preparedAdviceSnapshots.keys()][0];
  return { provider, snapshotId, messages };
}

test('live dashboard patches expose only host-current sealed preview IDs', async () => {
  const initial = grantedState(true);
  const storage = new ControlledStorage(initial);
  const { provider, snapshotId } = await preparedProvider(storage, initial);
  provider.currentProvider = 'claude';
  provider.currentTab = 'content';
  provider.hourlyDataForRolling30DaysByDay = {};

  const documentHtml = [
    '<!DOCTYPE html>',
    '<!-- ccu-live-panel:start --><section>fresh</section><!-- ccu-live-panel:end -->',
    '<script>const hours = /* ccu-live-hours:start */{}/* ccu-live-hours:end */;</script>',
  ].join('');
  const validPatch = provider.dashboardLivePatchFor(documentHtml);
  assert.ok(validPatch);
  assert.deepEqual(validPatch.adviceSnapshotIds, { claude: snapshotId });

  provider.adviceConsentWritesPending = 1;
  const pendingConsentPatch = provider.dashboardLivePatchFor(documentHtml);
  assert.ok(pendingConsentPatch);
  assert.deepEqual(pendingConsentPatch.adviceSnapshotIds, {});
  provider.adviceConsentWritesPending = 0;

  const stored = provider.preparedAdviceSnapshots.get(snapshotId);
  assert.ok(stored);
  const duplicateSnapshotId = 'snapshot-111111111111111111111111';
  provider.preparedAdviceSnapshots.set(duplicateSnapshotId, stored);
  const ambiguousPatch = provider.dashboardLivePatchFor(documentHtml);
  assert.ok(ambiguousPatch);
  assert.deepEqual(ambiguousPatch.adviceSnapshotIds, {});
  provider.preparedAdviceSnapshots.delete(duplicateSnapshotId);

  const originalState = provider.adviceEffectivenessStates.claude;
  assert.ok(originalState);
  provider.adviceEffectivenessStates = {
    claude: {
      ...originalState,
      contract: {
        ...originalState.contract,
        observations: originalState.contract.observations.map((observation: any, index: number) =>
          index === 0 ? { ...observation, value: Number(observation.value) + 1 } : observation),
      },
    },
  };
  const changedSourcePatch = provider.dashboardLivePatchFor(documentHtml);
  assert.ok(changedSourcePatch);
  assert.deepEqual(changedSourcePatch.adviceSnapshotIds, {});
  provider.adviceEffectivenessStates = { claude: originalState };

  provider.adviceConsentGeneration += 1;
  const stalePatch = provider.dashboardLivePatchFor(documentHtml);
  assert.ok(stalePatch);
  assert.deepEqual(stalePatch.adviceSnapshotIds, {});
});

test('prompt sample boundaries cannot collide in the sealed source revision', async () => {
  const initial = grantedState(true);
  const storage = new ControlledStorage(initial);
  const { provider, messages } = await preparedProvider(storage, initial);
  provider.currentProvider = 'claude';
  provider.currentTab = 'content';
  provider.hourlyDataForRolling30DaysByDay = {};

  const providerState = provider.adviceEffectivenessStates.claude;
  providerState.promptSamples = [{ text: 'alpha\u0000beta' }, { text: 'gamma' }];
  provider.handlePrepareAdviceSnapshotMessage({
    provider: 'claude', aggregateConsent: 'explicit', promptSampleConsent: 'explicit',
  });
  const snapshotId = [...provider.preparedAdviceSnapshots.keys()][0];
  assert.ok(snapshotId);

  // The concatenated bytes are identical if sample boundaries are represented
  // by a NUL delimiter, while the sealed JSON payloads are different.
  providerState.promptSamples = [{ text: 'alpha' }, { text: 'beta\u0000gamma' }];
  const documentHtml = [
    '<!DOCTYPE html>',
    '<!-- ccu-live-panel:start --><section>fresh</section><!-- ccu-live-panel:end -->',
    '<script>const hours = /* ccu-live-hours:start */{}/* ccu-live-hours:end */;</script>',
  ].join('');
  const patch = provider.dashboardLivePatchFor(documentHtml);
  assert.ok(patch);
  assert.deepEqual(patch.adviceSnapshotIds, {}, 'the old payload must not remain restorable');

  let sends = 0;
  provider.onSendAdviceInvocation = async () => {
    sends += 1;
    return { ok: false, code: 'transport-error' };
  };
  messages.length = 0;
  await provider.handleSendAdviceSnapshotMessage({ provider: 'claude', snapshotId });
  assert.equal(sends, 0, 'the old payload must not remain sendable');
  assert.equal(messages[messages.length - 1]?.reason, 'stale-preview');
});

test('arbitrary user-context strings cannot collide in the sealed source revision', async () => {
  const initial = grantedState(true);
  const storage = new ControlledStorage(initial);
  const { provider, messages } = await preparedProvider(storage, initial);
  provider.currentProvider = 'claude';
  provider.currentTab = 'content';
  provider.hourlyDataForRolling30DaysByDay = {};

  const providerState = provider.adviceEffectivenessStates.claude;
  providerState.userContext = '\uD800';
  provider.preparedAdviceSnapshots.clear();
  provider.handlePrepareAdviceSnapshotMessage({
    provider: 'claude', aggregateConsent: 'explicit', promptSampleConsent: 'explicit',
  });
  const surrogateSnapshotId = [...provider.preparedAdviceSnapshots.keys()][0];
  assert.ok(surrogateSnapshotId);

  // TextEncoder replaces a lone surrogate with U+FFFD, so hashing the raw
  // string bytes alone collides even though the canonical request JSON differs.
  providerState.userContext = '\uFFFD';
  const documentHtml = [
    '<!DOCTYPE html>',
    '<!-- ccu-live-panel:start --><section>fresh</section><!-- ccu-live-panel:end -->',
    '<script>const hours = /* ccu-live-hours:start */{}/* ccu-live-hours:end */;</script>',
  ].join('');
  const patch = provider.dashboardLivePatchFor(documentHtml);
  assert.ok(patch);
  assert.deepEqual(patch.adviceSnapshotIds, {}, 'the old context must not remain restorable');

  let sends = 0;
  provider.onSendAdviceInvocation = async () => {
    sends += 1;
    return { ok: false, code: 'transport-error' };
  };
  messages.length = 0;
  await provider.handleSendAdviceSnapshotMessage({
    provider: 'claude', snapshotId: surrogateSnapshotId,
  });
  assert.equal(sends, 0, 'the old context must not remain sendable');
  assert.equal(messages[messages.length - 1]?.reason, 'stale-preview');
});

test('host clear invalidates browser previews before durable storage settles', async () => {
  const initial = grantedState();
  const storage = new ControlledStorage(initial);
  const { provider, messages } = await preparedProvider(storage, initial);

  messages.length = 0;
  const clear = provider.clearAdviceLocalData();
  assert.deepEqual(messages[0], { command: 'advicePreviewsInvalidated' });
  await nextTurn();
  assert.equal(storage.pending.length, 1);
  storage.releaseNext();
  await clear;
});

test('withdrawal rejects an old preview before its durable consent write completes', async () => {
  const initial = grantedState();
  const storage = new ControlledStorage(initial);
  const { provider, snapshotId } = await preparedProvider(storage, initial);
  let sends = 0;
  provider.onSendAdviceInvocation = async () => {
    sends += 1;
    return { ok: false, code: 'transport-error' };
  };
  const withdrawal = provider.handleAdviceConsentMessage({
    provider: 'claude', aggregateConsent: 'not-granted', promptSampleConsent: 'not-granted',
  });
  await nextTurn();
  assert.equal(storage.pending.length, 1);
  await provider.handleSendAdviceSnapshotMessage({ provider: 'claude', snapshotId });
  assert.equal(sends, 0, 'a pending disk write must not extend revoked permission');
  storage.releaseNext();
  await withdrawal;
});

test('prompt withdrawal blocks fresh previews until all queued consent writes settle', async () => {
  const initial = grantedState(true);
  const storage = new ControlledStorage(initial);
  const { provider, messages } = await preparedProvider(storage, initial);
  const change = { provider: 'claude', aggregateConsent: 'explicit', promptSampleConsent: 'not-granted' };
  const first = provider.handleAdviceConsentMessage(change);
  const second = provider.handleAdviceConsentMessage(change);
  await nextTurn();
  messages.length = 0;
  provider.handlePrepareAdviceSnapshotMessage({ ...change, promptSampleConsent: 'explicit' });
  assert.equal(messages[messages.length - 1]?.ok, false, 'cannot recreate the old personalized request');
  assert.equal(provider.preparedAdviceSnapshots.size, 0);
  storage.releaseNext();
  await nextTurn();
  assert.equal(storage.pending.length, 1);
  provider.handlePrepareAdviceSnapshotMessage(change);
  assert.equal(messages[messages.length - 1]?.ok, false, 'one settled write does not unlock another pending write');
  storage.releaseNext();
  await Promise.all([first, second]);
  provider.handlePrepareAdviceSnapshotMessage(change);
  assert.equal(messages[messages.length - 1]?.ok, true, 'fresh aggregate-only preview works after withdrawal settles');
});

for (const kind of ['aggregate', 'prompt'] as const) {
  test(`${kind} withdrawal cancels an active send before storage settles`, async () => {
    const initial = grantedState(true);
    const storage = new ControlledStorage(initial);
    const { provider, snapshotId, messages } = await preparedProvider(storage, initial);
    let finish!: (value: unknown) => void;
    let cancelled = false;
    provider.onSendAdviceInvocation = () => new Promise((resolve) => { finish = resolve; });
    provider.onAdviceConsentWithdrawn = async () => {
      cancelled = true;
      finish({ ok: false, code: 'transport-error' });
    };
    const send = provider.handleSendAdviceSnapshotMessage({ provider: 'claude', snapshotId });
    await nextTurn();
    const withdrawal = provider.handleAdviceConsentMessage({
      provider: 'claude', aggregateConsent: kind === 'aggregate' ? 'not-granted' : 'explicit',
      promptSampleConsent: 'not-granted',
    });
    await nextTurn();
    assert.equal(storage.pending.length, 1);
    assert.equal(cancelled, true, 'host cancellation cannot wait for disk persistence');
    await send;
    assert.equal(messages.some((m) => m.command === 'adviceSendResult' && m.ok === true), false);
    storage.releaseNext();
    await withdrawal;
  });
}

test('failed consent persistence cannot revive an old preview or create a new one', async () => {
  const initial = grantedState();
  const { provider, snapshotId, messages } = await preparedProvider({
    get: <T>() => initial as T,
    update: async () => { throw new Error('synthetic storage failure'); },
  }, initial);
  let sends = 0;
  provider.onSendAdviceInvocation = async () => {
    sends += 1;
    return { ok: false, code: 'transport-error' };
  };
  await provider.handleAdviceConsentMessage({
    provider: 'claude', aggregateConsent: 'not-granted', promptSampleConsent: 'not-granted',
  });
  await provider.handleSendAdviceSnapshotMessage({ provider: 'claude', snapshotId });
  provider.handlePrepareAdviceSnapshotMessage({
    provider: 'claude', aggregateConsent: 'explicit', promptSampleConsent: 'not-granted',
  });
  assert.equal(sends, 0);
  assert.equal(provider.preparedAdviceSnapshots.size, 0);
  assert.equal(messages[messages.length - 1]?.ok, false);
});

test('clear is serialized after an older consent write and remains the final durable state', async () => {
  const initial = createClosedAdviceLocalState();
  initial.featureMode = 'enabled';
  const storage = new ControlledStorage(initial);
  const provider = await createProvider(storage);
  provider.adviceLocalState = initial;
  provider.adviceEffectivenessStates = {
    claude: {
      provider: 'claude',
      remotePreviewEligible: true,
      aggregate: { windowDays: 30 },
      promptSamples: [],
      contract: { adviceId: 'advice-claude-test', recommendations: [] },
    },
  };
  provider.onAdviceDataCleared = async () => undefined;

  const consent = provider.handleAdviceConsentMessage({
    provider: 'claude',
    aggregateConsent: 'explicit',
    promptSampleConsent: 'not-granted',
  });
  await nextTurn();
  assert.equal(storage.pending.length, 1);

  const clear = provider.handleClearAdviceLocalDataMessage();
  await nextTurn();
  assert.equal(
    storage.pending.length,
    1,
    'clear must share the one state-writer queue instead of racing the consent write',
  );

  storage.releaseNext();
  await nextTurn();
  assert.equal(storage.pending.length, 1, 'clear should begin after consent settles');
  storage.releaseNext();
  await Promise.all([consent, clear]);

  assert.equal(storage.value, undefined, 'the current ledger key is removed');
  assert.equal(provider.adviceLocalState.featureMode, 'enabled');
  assert.equal(provider.adviceLocalState.aggregateConsent, 'not-granted');
  assert.equal(provider.adviceLocalState.promptSampleConsent, 'not-granted');
  assert.deepEqual(provider.adviceLocalState.feedback, []);
  assert.deepEqual(provider.adviceLocalState.suppression, []);
  assert.deepEqual(provider.adviceLocalState.comparablePairs, []);
  assert.deepEqual(provider.adviceLocalState.comparisonResults, []);
});

test('discarded optimizer request cannot install a stale result after await', async () => {
  const provider = await createProvider({
    get: () => undefined,
    update: async () => undefined,
  });
  provider.settings = {
    get: (key: string) => key === 'advice.optimizer.enabled',
  };
  const snapshotId = 'optimizer-stale-test';
  provider.optimizerConsentGeneration = 7;
  provider.optimizerState = {
    draft: 'old draft',
    resolve: true,
    distil: false,
    aesthetic: false,
  };
  const stored = {
    prepared: {},
    draft: 'old draft',
    sourceRevision: 'optimizer-source',
    consentGeneration: 7,
  };
  provider.preparedOptimizerRequests.set(snapshotId, stored);
  const messages: Array<Record<string, unknown>> = [];
  provider.postAdviceMessage = (message: Record<string, unknown>) => messages.push(message);
  let finish!: (value: unknown) => void;
  provider.onSendOptimizerInvocation = () => new Promise((resolve) => {
    finish = resolve;
  });

  const send = provider.handleSendOptimizerMessage({ snapshotId, draft: 'old draft' });
  await nextTurn();
  provider.discardPreparedOptimizer();
  finish({ ok: true, value: { prompt: 'STALE RESULT', settings: 'stale' } });
  await send;

  assert.equal(provider.optimizerState.prompt, undefined);
  assert.equal(messages.some((message) => message.prompt === 'STALE RESULT'), false);
  const lastMessage = messages[messages.length - 1];
  assert.equal(lastMessage?.command, 'optimizeResult');
  assert.equal(typeof lastMessage?.error, 'string');
});

test('optimizer feedback uses the same retractable local ledger and rendered controls', async () => {
  let durable = createClosedAdviceLocalState();
  const provider = await createProvider({
    get: <T>() => durable as T,
    update: async (_key: string, value: unknown) => {
      durable = value as AdviceLocalState;
    },
  });
  provider.settings = {
    get: (key: string) =>
      key === 'advice.effectiveness.enabled' || key === 'advice.optimizer.enabled',
  };
  provider.adviceLocalState = durable;
  provider.optimizerState = {
    draft: 'host-only draft',
    resolve: false,
    distil: false,
    aesthetic: false,
    prompt: 'Paste-ready result',
    settings: 'Effort: high',
    adviceId: 'advice-optimizer-0123456789abcdef01234567',
  };

  await provider.handleAdviceFeedbackMessage({
    provider: 'optimizer',
    adviceId: provider.optimizerState.adviceId,
    recommendationId: 'recommendation-optimizer-result-v1',
    kind: 'helpful',
  });

  assert.equal(durable.feedback.length, 1);
  assert.equal(durable.feedback[0].rating, 'helpful');
  assert.equal(durable.feedback[0].applied, 'not-applied');
  assert.doesNotMatch(JSON.stringify(durable), /host-only draft|Paste-ready result|Effort: high/);
  const html = provider.renderOptimizerCard();
  assert.equal((html.match(/data-advice-action="feedback"/g) ?? []).length, 3);
  assert.match(html, /data-provider="optimizer"/);
  assert.match(html, /recommendation-optimizer-result-v1/);
  await provider.handleAdviceSnoozeMessage({
    provider: 'optimizer',
    adviceId: provider.optimizerState.adviceId,
    recommendationId: 'recommendation-optimizer-result-v1',
    mode: 'snooze',
  });
  assert.equal(durable.suppression.length, 1);
  const snoozedHtml = provider.renderOptimizerCard();
  assert.match(snoozedHtml, /id="optDraft"/);
  assert.match(snoozedHtml, /id="optRunBtn"/);
  assert.doesNotMatch(snoozedHtml, /id="optResult"|id="optSendBtn"|id="optFeedback"/);
  assert.match(snoozedHtml, /data-snooze-mode="resume"/);
  provider.optimizerState.adviceId = 'advice-optimizer-reloaded-dynamic';
  provider.adviceLocalState = durable;
  const reloadedHtml = provider.renderOptimizerCard();
  assert.match(reloadedHtml, /data-snooze-mode="resume"/);
});

test('optimizer snooze date uses the configured timezone instead of the host timezone', async () => {
  const previousLanguage = I18n.getCurrentLanguage();
  const previousTimezone = I18n.getTimezone();
  const previousHostTimezone = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    I18n.setLanguage('en');
    I18n.setTimezone('Pacific/Honolulu');
    const snoozedUntilEpochMs = Date.parse('2099-01-01T00:30:00.000Z');
    const durable = createClosedAdviceLocalState();
    durable.suppression = [{
      provider: 'optimizer',
      surface: 'optimizer',
      recommendationId: 'recommendation-optimizer-result-v1',
      updatedAtEpochMs: snoozedUntilEpochMs - 60_000,
      snoozedUntilEpochMs,
    }];
    const provider = await createProvider({
      get: <T>() => durable as T,
      update: async () => undefined,
    });
    provider.settings = { get: (key: string) => key === 'advice.optimizer.enabled' };
    provider.adviceLocalState = durable;
    provider.optimizerState = {
      draft: 'host-only draft',
      resolve: false,
      distil: false,
      aesthetic: false,
      prompt: 'Paste-ready result',
      settings: 'Effort: high',
      adviceId: 'advice-optimizer-timezone-test',
    };

    const html = provider.renderOptimizerCard();
    assert.match(html, /Snoozed until 12\/31\/2098/);
    assert.doesNotMatch(html, /Snoozed until 1\/1\/2099/);
  } finally {
    I18n.setLanguage(previousLanguage);
    I18n.setTimezone(previousTimezone);
    if (previousHostTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousHostTimezone;
    }
  }
});

test('snoozed advice leaves a closed, on-demand resume control instead of the default recommendation summary', async () => {
  let durable = createClosedAdviceLocalState();
  const provider = await createProvider({
    get: <T>() => durable as T,
    update: async (_key: string, value: unknown) => {
      durable = value as AdviceLocalState;
    },
  });
  provider.settings = { get: (key: string) => key === 'advice.effectiveness.enabled' };
  provider.adviceLocalState = durable;
  provider.adviceEffectivenessStates = {
    claude: {
      provider: 'claude',
      remotePreviewEligible: false,
      aggregate: { windowDays: 30 },
      promptSamples: [],
      contract: {
        schemaVersion: 1,
        adviceId: 'advice-claude-snooze-test',
        observations: [{
          id: 'observation-1',
          metric: 'long-session-share',
          value: 0.5,
          unit: 'ratio',
          method: 'measured',
          sourceId: 'source-1',
          summary: 'local',
        }],
        evidence: [{
          id: 'evidence-1',
          observationIds: ['observation-1'],
          strength: 'direct',
          summary: 'local',
          limitations: [],
        }],
        recommendations: [{
          id: 'recommendation-claude-snooze',
          title: 'Boundary',
          evidenceIds: ['evidence-1'],
          explanation: { summary: 'local', proxyMetricObservationIds: [], limitations: [] },
          conditionalActions: [{ when: 'next task', action: 'try', evidenceIds: ['evidence-1'] }],
          successCriteria: [],
        }],
        privacy: {
          dataMode: 'local-only',
          promptSampleConsent: 'not-applicable',
          promptSampleCount: 0,
          feedbackStorage: 'local-only',
        },
        provenance: {
          generatedBy: { kind: 'local-rules' },
          generatedAt: new Date(1_777_000_000_000).toISOString(),
          locale: 'en',
          sources: [{
            id: 'source-1',
            kind: 'claude-local-insight',
            scope: 'overall',
            window: { kind: 'rolling-days', days: 30 },
            confidence: 'high',
            qualityFlags: [],
          }],
        },
      },
    },
  };
  const snoozeNow = Date.now();
  const result = snoozeAdviceRecommendation(durable, {
    provider: 'claude',
    surface: 'advice',
    recommendationId: 'recommendation-claude-snooze',
    updatedAtEpochMs: snoozeNow,
    snoozedUntilEpochMs: snoozeNow + 86_400_000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  provider.adviceLocalState = result.value;
  const html = provider.renderAdviceEffectivenessBody('claude');
  assert.doesNotMatch(html, /advice-recommendation-boundary/);
  assert.match(html, /advice-recommendation-snoozed/);
  assert.match(html, /data-snooze-mode="resume"/);
});

test('a failed feedback save returns the validated target identity so only its controls unlock', async () => {
  const durable = createClosedAdviceLocalState();
  const provider = await createProvider({
    get: <T>() => durable as T,
    update: async () => {
      throw new Error('simulated storage failure');
    },
  });
  provider.settings = {
    get: (key: string) => key === 'advice.optimizer.enabled',
  };
  provider.adviceLocalState = durable;
  provider.optimizerState = {
    draft: 'host-only draft',
    resolve: false,
    distil: false,
    aesthetic: false,
    prompt: 'Paste-ready result',
    settings: 'Effort: high',
    adviceId: 'advice-optimizer-0123456789abcdef01234567',
  };
  const messages: Array<Record<string, unknown>> = [];
  provider.postAdviceMessage = (message: Record<string, unknown>) => messages.push(message);

  await provider.handleAdviceFeedbackMessage({
    provider: 'optimizer',
    adviceId: 'advice-optimizer-0123456789abcdef01234567',
    recommendationId: 'recommendation-optimizer-result-v1',
    kind: 'helpful',
  });

  assert.deepEqual(messages[messages.length - 1], {
    command: 'adviceFeedbackResult',
    ok: false,
    provider: 'optimizer',
    adviceId: 'advice-optimizer-0123456789abcdef01234567',
    recommendationId: 'recommendation-optimizer-result-v1',
  });
});

test('optimizer host seam fails closed while its feature is disabled', async () => {
  const provider = await createProvider({
    get: () => undefined,
    update: async () => undefined,
  });
  provider.settings = { get: () => false };
  let prepares = 0;
  let sends = 0;
  provider.onPrepareOptimizerInvocation = async () => {
    prepares += 1;
    return { error: 'must not run' };
  };
  provider.onSendOptimizerInvocation = async () => {
    sends += 1;
    return { ok: false, code: 'transport-error', issues: [] };
  };

  await provider.handlePrepareOptimizerMessage({ draft: 'private draft' });
  provider.preparedOptimizerRequests.set('optimizer-disabled', {
    prepared: {},
    draft: 'private draft',
    sourceRevision: 'disabled',
    consentGeneration: provider.optimizerConsentGeneration,
  });
  await provider.handleSendOptimizerMessage({
    snapshotId: 'optimizer-disabled',
    draft: 'private draft',
  });

  assert.equal(prepares, 0);
  assert.equal(sends, 0);
});

test('explicit optimizer rerun resumes the stable recommendation scope without touching feedback', async () => {
  let durable = createClosedAdviceLocalState();
  durable.suppression = [{
    provider: 'optimizer',
    surface: 'optimizer',
    recommendationId: 'recommendation-optimizer-result-v1',
    snoozedUntilEpochMs: Date.now() + 60_000,
    updatedAtEpochMs: Date.now(),
  }];
  const provider = await createProvider({
    get: <T>() => durable as T,
    update: async (_key: string, value: unknown) => { durable = value as AdviceLocalState; },
  });
  provider.settings = { get: (key: string) => key === 'advice.optimizer.enabled' };
  provider.adviceLocalState = durable;
  provider.onPrepareOptimizerInvocation = async () => ({ error: 'no prepared result' });

  await provider.handlePrepareOptimizerMessage({ draft: 'explicit rerun' });

  assert.deepEqual(durable.suppression, []);
});

test('successful optimizer send creates an opaque feedback target without deriving it from content', async () => {
  const provider = await createProvider({
    get: () => undefined,
    update: async () => undefined,
  });
  provider.settings = { get: (key: string) => key === 'advice.optimizer.enabled' };
  provider.optimizerConsentGeneration = 3;
  provider.optimizerState = {
    draft: 'SENSITIVE_DRAFT',
    resolve: false,
    distil: false,
    aesthetic: false,
  };
  const snapshotId = 'optimizer-success';
  provider.preparedOptimizerRequests.set(snapshotId, {
    prepared: {},
    draft: 'SENSITIVE_DRAFT',
    sourceRevision: 'optimizer-source',
    consentGeneration: 3,
  });
  provider.onSendOptimizerInvocation = async () => ({
    ok: true,
    value: { prompt: 'SENSITIVE_RESULT', settings: 'SENSITIVE_SETTINGS' },
  });
  const messages: Array<Record<string, unknown>> = [];
  provider.postAdviceMessage = (message: Record<string, unknown>) => messages.push(message);

  await provider.handleSendOptimizerMessage({ snapshotId, draft: 'SENSITIVE_DRAFT' });

  assert.match(provider.optimizerState.adviceId, /^advice-optimizer-[a-f0-9]{24}$/);
  assert.doesNotMatch(provider.optimizerState.adviceId, /SENSITIVE/i);
  const lastMessage = messages[messages.length - 1];
  assert.equal(lastMessage.recommendationId, 'recommendation-optimizer-result-v1');
  assert.equal(lastMessage.adviceId, provider.optimizerState.adviceId);
});
