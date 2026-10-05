import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { I18n } from '../i18n';

const peakKey = 'ccu.achievements.calendarPeak.v1';
function state(): Map<string, unknown> {
  return new Map<string, unknown>(['structural', 'token', 'bucket', 'manifest', 'calendar', 'calibration']
    .map(name => [`ccu.achievements.${name}Audit.v1`, true]));
}
async function withProvider(values: Map<string, unknown>, run: (provider: any) => Promise<void>,
  save?: (key: string, value: unknown, persist: () => void) => Promise<void>): Promise<void> {
  const load = (Module as any)._load;
  const zone = I18n.getTimezone();
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? { workspace: { workspaceFolders: [] } } : load.call(this, request, parent, main);
  };
  try {
    I18n.setTimezone('UTC');
    const { UsageWebviewProvider } = require('../webview');
    const provider = new UsageWebviewProvider({ globalState: {
      get: (key: string) => values.get(key), update: async (key: string, value: unknown) => {
        const persist = () => value === undefined ? values.delete(key) : values.set(key, value);
        if (save) await save(key, value, persist); else persist();
      },
    } }) as any;
    await run(provider);
  } finally { I18n.setTimezone(zone); (Module as any)._load = load; }
}
function proof(provider: any, volume = 8_000_000_000): void {
  provider.providerAvailability = { claude: false, codex: true, codexData: true };
  provider.codexAchievementSignals = { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 },
    dayEvidence: { complete: true, timeZone: 'UTC', days: volume ? [{ day: '2026-08-31', processed: volume,
      output: 1, models: {} }] : [] } };
  provider.codexView = { currentManifestVerified: true, coverage: { complete: true, identity: { complete: true } },
    periodCoverage: { timeZone: 'UTC', allTime: { complete: true }, last30Days: { complete: false } },
    last30DaysHourlyByDay: {}, hourlyCoverage: { complete: false }, allTimeDaily: [],
    allTime: { total: { processed: volume } } };
}
const result = (provider: any, id = 'weekly-average-silver') => provider.achievementResults().find((r: any) => r.id === id);
async function settle(provider: any): Promise<void> {
  await Promise.all([provider.achievementWrite, provider.achievementHourWrite, provider.achievementCalendarWrite]
    .map(p => Promise.resolve(p).catch(() => undefined)));
  await new Promise<void>(resolve => setImmediate(resolve));
}

test('host saves verified weekly mean once and retains it after log retention without using stale-zone proof', async () => {
  const values = state(); let peakWrites = 0;
  await withProvider(values, async provider => {
    proof(provider); assert.equal(result(provider).unlocked, true); await settle(provider);
    assert.equal((values.get(peakKey) as any)?.peakFourWeekAverage, 2_000_000_000);
    for (let index = 0; index < 8; index++) result(provider);
    await settle(provider); assert.equal(peakWrites, 1, 'unchanged render does not persist repeatedly');
  }, async (key, value, persist) => { if (key === peakKey) peakWrites++; persist(); });
  await withProvider(values, async provider => {
    proof(provider, 0); assert.equal(result(provider).progress, 2_000_000_000);
    provider.codexView.currentManifestVerified = false;
    assert.equal(result(provider).progress, 0, 'cached manifest cannot unlock from a retained maximum');
    provider.codexView.currentManifestVerified = true;
    I18n.setTimezone('Europe/Istanbul'); assert.equal(result(provider).progress, 0);
    I18n.setTimezone('UTC'); await provider.clearAchievementGrants();
    assert.equal(values.has(peakKey), false);
    assert.equal(result(provider).progress, 0);
  });
});

test('failed or disabled calendar saves are retryable and clear fences in-flight writes', async () => {
  const values = state(); let failures = 1; let pause: Promise<void> | undefined; let release!: () => void;
  await withProvider(values, async provider => {
    proof(provider); result(provider); await settle(provider);
    assert.equal(values.has(peakKey), false, 'failed save is not retained optimistically');
    result(provider); await settle(provider); assert.equal(values.has(peakKey), true);
    await provider.clearAchievementGrants();
    pause = new Promise(resolve => { release = resolve; });
    proof(provider, 12_000_000_000); result(provider);
    await new Promise<void>(resolve => setImmediate(resolve));
    const clearing = provider.clearAchievementGrants(); release(); await clearing;
    assert.equal(values.has(peakKey), false, 'clear waits and deletes a write already in flight');
    provider.settings = { get: () => false }; proof(provider); result(provider); await settle(provider);
    assert.equal(values.has(peakKey), false);
  }, async (key, value, persist) => {
    if (key === peakKey && value !== undefined) {
      if (failures-- > 0) throw new Error('fixture storage unavailable');
      if (pause) await pause;
    }
    persist();
  });
});
