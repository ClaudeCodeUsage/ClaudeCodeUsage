'use strict';

const { mkdtemp, realpath, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore } = require('../../../out/settings.js');
const { CodexAccountEstimator } = require('../../../out/codexAccountEstimate.js');
const { WeeklyEstimateCoordinator } = require('../../../out/weeklyEstimateCoordinator.js');
const { buildLocalWeeklyEstimates } = require('../../../out/weeklyEstimate.js');
const sessions = new Map();
let prepared;

function historyInputs(snapshot, now) {
  const day = 86_400_000, resetAt = now + day, observedAt = now - 7 * day - 2 * 3_600_000;
  return { ...snapshot.weeklyValueInputs,
    observations: [{ provider: 'codex', sourceKey: 'synthetic-history', seriesKey: 'synthetic-history',
      observedAt, resetAt: resetAt - 7 * day, usedPercent: 25 }],
    usage: [...snapshot.weeklyValueInputs.usage, { sourceKey: 'synthetic-history', timestamp: observedAt - 1000,
      equivalentUsd: 10, pricedTokens: 100, totalTokens: 100 }] };
}

function calibrated(accountScopeKey, observedAt, resetAt, increment) {
  const estimator = new CodexAccountEstimator(), sourceScopeKey = 'c'.repeat(64), sourceKey = 'synthetic-delta';
  const before = observedAt - 120_000;
  const quotaEpoch = { startedAt: before, resetAnchorAt: resetAt, startLowerAt: null, reason: 'initial' };
  const sample = (time, percent) => ({ accountScopeKey, sourceScopeKey, requestedAt: time - 10,
    observedAt: time, resetAt, usedPercent: percent, quotaEpoch });
  const inputs = (time, percent, usd, tokens) => ({ localHistoryComplete: true,
    observations: [{ provider: 'codex', sourceKey, seriesKey: sourceKey, observedAt: time, resetAt, usedPercent: percent }],
    usage: [{ sourceKey, timestamp: time, equivalentUsd: usd, pricedTokens: tokens, totalTokens: tokens }] });
  estimator.observe(sample(before, 20), inputs(before, 20, 10, 100), 'openai-v1');
  const result = estimator.observe(sample(observedAt, 40), inputs(observedAt, 40, 10 + increment, 200), 'openai-v1');
  if (!result) throw new Error('Synthetic account calibration failed');
  return result;
}

async function publicProjection(inputs, now) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-weekly-accounts-')));
  const coordinator = new WeeklyEstimateCoordinator(path.join(root, 'weekly-estimates-v1.json'), 'synthetic-weekly-account-salt');
  const resetAt = now + 86_400_000, observedAt = now - 2 * 3_600_000;
  const first = calibrated('a'.repeat(64), observedAt - 120_000, resetAt, 30);
  const second = calibrated('b'.repeat(64), observedAt, resetAt, 40);
  const options = { sourceNamespace: 'synthetic-weekly-accounts', pricingVersion: 'openai-v1', now };
  try {
    coordinator.project('codex', inputs, { ...options, accountEstimates: [first], activeAccountScopeKey: first.accountScopeKey,
      activeQuotaEpochStartedAt: first.quotaEpoch.startedAt });
    await coordinator.flush();
    const next = { ...options, accountEstimates: [first, second], activeAccountScopeKey: second.accountScopeKey,
      activeQuotaEpochStartedAt: second.quotaEpoch.startedAt };
    coordinator.project('codex', inputs, next); await coordinator.flush();
    const projection = coordinator.project('codex', inputs, next);
    if (projection.status !== 'ready' || projection.activeAccountNumber !== 2 ||
      projection.entries.find(entry => entry.accountNumber === 1)?.fullEquivalentUsd !== 150 ||
      projection.entries.find(entry => entry.accountNumber === 2)?.fullEquivalentUsd !== 200 ||
      JSON.stringify(projection).includes('accountScopeKey')) throw new Error('Synthetic public projection invalid');
    return { projection, quota: { status: 'ready', accountNumber: projection.activeAccountNumber,
      usedPercent: 40, resetAt, observedAt, quotaEpochStartedAt: second.quotaEpoch.startedAt } };
  } finally {
    coordinator.dispose();
    // The only disk writes belong to this freshly generated isolated fixture root.
    await rm(root, { recursive: true, force: true });
  }
}

exports.weeklyAccountFixture = async (snapshot, now) => {
  const inputs = historyInputs(snapshot, now);
  prepared ??= publicProjection(inputs, now);
  const { projection, quota } = await prepared;
  return { snapshot: { ...snapshot, weeklyValueInputs: inputs },
    projector: enabled => (provider, values, time) => provider === 'codex'
      ? { ...projection, officialQuota: enabled ? quota : { status: 'disabled' } }
      : { entries: buildLocalWeeklyEstimates(provider, values, { now: time }), status: 'ready' } };
};

exports.weeklyAccountSettings = (id, defaults) => {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid synthetic settings session');
  let store = sessions.get(id);
  if (!store) {
    if (sessions.size >= 64) throw new Error('Synthetic settings sessions full');
    const values = new Map(defaults.snapshot().filter(row => row.storage === 'state').map(row => ['ccu.setting.' + row.key, row.value]));
    const settings = new SettingsStore({ globalState: {
      get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
      update: async (key, value) => { values.set(key, value); },
    } });
    store = { get: key => settings.get(key) ?? defaults.get(key),
      snapshot: () => settings.snapshot().map(row => ({ ...row, value: row.value ?? row.default })),
      set: value => settings.set('codex.officialQuota.enabled', value) };
    sessions.set(id, store);
  }
  return store;
};

exports.updateWeeklyAccountSetting = async message => {
  const store = sessions.get(message?.session);
  if (!store || message.command !== 'updateSetting' || message.key !== 'codex.officialQuota.enabled' ||
    typeof message.value !== 'boolean') return false;
  await store.set(message.value);
  return true;
};
