import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { I18n } from '../i18n';

test('host connects Token output/cache and calendar proof with independent coverage fences', async () => {
  const originalLoad = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return { workspace: { workspaceFolders: [] } };
    return originalLoad.call(this, request, parent, isMain);
  };
  const oldZone = I18n.getTimezone();
  try {
    I18n.setTimezone('UTC');
    const { UsageWebviewProvider } = require('../webview');
    const state = new Map<string, unknown>([
      ['ccu.achievements.grants.v5', []], ...['structural', 'token', 'bucket', 'manifest', 'calendar', 'calibration'].map(name =>
        [`ccu.achievements.${name}Audit.v1`, true] as [string, unknown]),
    ]);
    const provider = new UsageWebviewProvider({ globalState: {
      get: (key: string) => state.get(key), update: async (key: string, value: unknown) => state.set(key, value),
    } }) as any;
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    provider.codexAchievementSignals = { modelCount: 0, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 },
      tokenEvidence: { complete: true, output: 50_000_000, cachedInput: 1_000_000_000 },
      dayEvidence: { complete: true, timeZone: 'UTC', days: Array.from({ length: 7 }, (_, index) => ({
        day: `2026-09-0${index + 1}`, processed: 1_000_000, output: 1,
        models: { 'gpt-6-astra': { processed: 1_000_000, output: 1 } },
      })) } };
    provider.codexView = { currentManifestVerified: true,
      coverage: { complete: true, identity: { complete: true } },
      periodCoverage: { timeZone: 'UTC', allTime: { complete: true }, last30Days: { complete: false } },
      allTime: { total: { processed: 200_000_000, output: 50_000_000, cachedInput: 100_000_000 } },
      allTimeDaily: Array.from({ length: 7 }, (_, index) => ({
        day: `2026-09-0${index + 1}`, total: { processed: 100_000_000 },
      })), last30DaysHourlyByDay: {}, hourlyCoverage: { complete: false },
    };
    const read = () => new Map<string, any>(provider.achievementResults().map((row: any) => [row.id, row]));
    assert.equal(read().get('codex-output-silver')?.unlocked, true);
    assert.equal(read().get('codex-cache-read-bronze')?.unlocked, true);
    assert.equal(read().get('astra-days-bronze')?.unlocked, true);
    assert.equal(read().get('weekly-volume-bronze')?.unlocked, false,
      'legacy display-day totals must not replace smaller canonical calendar proof');
    const calendar = provider.achievementCalendarCache.value;
    read();
    assert.equal(provider.achievementCalendarCache.value, calendar, 'unchanged renders reuse numeric calendar signals');
    provider.codexView.periodCoverage.allTime.complete = false;
    assert.equal(read().get('codex-output-silver')?.unlocked, true, 'output does not depend on calendar migration');
    assert.equal(read().get('astra-days-bronze')?.unlocked, false);
    provider.codexView.periodCoverage.allTime.complete = true;
    for (const mutate of [
      () => provider.codexView.currentManifestVerified = false,
      () => provider.codexView.coverage.complete = false,
      () => provider.codexView.coverage.identity.complete = false,
    ]) {
      mutate();
      assert.equal(read().get('codex-output-bronze')?.unlocked, false);
      assert.equal(read().get('astra-days-bronze')?.unlocked, false);
      provider.codexView.currentManifestVerified = true;
      provider.codexView.coverage.complete = true;
      provider.codexView.coverage.identity.complete = true;
    }
    provider.codexAchievementSignals.tokenEvidence.complete = false;
    assert.equal(read().get('codex-output-bronze')?.unlocked, false);
    assert.equal(read().get('codex-cache-read-bronze')?.unlocked, false);
    provider.codexAchievementSignals.dayEvidence.timeZone = 'Europe/Istanbul';
    assert.equal(read().get('astra-days-bronze')?.unlocked, false, 'old-zone daily projection cannot prove current-zone days');
    provider.codexAchievementSignals.dayEvidence.timeZone = 'UTC';
    provider.codexAchievementSignals.dayEvidence = {
      ...provider.codexAchievementSignals.dayEvidence,
      days: provider.codexAchievementSignals.dayEvidence.days.map((day: any) => ({
        ...day, processed: 100_000_000,
        models: { 'gpt-6-astra': { processed: 100_000_000, output: 1 } },
      })),
    };
    assert.equal(read().get('weekly-volume-bronze')?.unlocked, true);
    const validDays = provider.codexAchievementSignals.dayEvidence.days;
    provider.codexAchievementSignals.dayEvidence = { ...provider.codexAchievementSignals.dayEvidence,
      days: [...validDays, validDays[0]] };
    assert.equal(read().get('weekly-volume-bronze')?.unlocked, false,
      'duplicate normalized rows cannot bypass validation through legacy weekly rules');
    assert.equal(read().get('active-day-streak')?.unlocked, false);
    provider.codexAchievementSignals.dayEvidence = { ...provider.codexAchievementSignals.dayEvidence, days: validDays };
    I18n.setTimezone('America/New_York');
    assert.equal(read().get('astra-days-bronze')?.unlocked, false);
    assert.equal(read().get('weekly-volume-bronze')?.unlocked, false,
      'a configured-zone change fences older weekly-volume rules too');
    assert.equal(read().get('active-day-streak')?.unlocked, false,
      'old-zone activity dates cannot prove a configured-zone streak');
    I18n.setTimezone('UTC');
    provider.providerAvailability = { claude: true, codex: false, codexData: false };
    const usage = {
      totalInputTokens: 999_999, totalOutputTokens: 1,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
      modelBreakdown: { 'claude-sonnet-5': { inputTokens: 999_999, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 } },
    };
    provider.allTimeData = usage;
    provider.dailyDataForEveryDay = Array.from({ length: 7 }, (_, index) => ({ date: `2026-09-0${index + 1}`, data: usage }));
    assert.equal(read().get('sonnet-days-bronze')?.unlocked, false, 'unattributed calendar data is not current-zone proof');
    provider.achievementCalendarTimeZone = 'UTC';
    assert.equal(read().get('sonnet-days-bronze')?.unlocked, true);
    await Promise.all([provider.achievementWrite, provider.achievementHourWrite]);
  } finally {
    I18n.setTimezone(oldZone);
    (Module as any)._load = originalLoad;
  }
});
