import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { I18n } from '../i18n';

/** An isolated Node process, synthetic aggregates, and a frozen clock only. */
async function withSystemZoneProvider(run: (provider: any) => Promise<void>): Promise<void> {
  const load = (Module as any)._load;
  const zone = I18n.getTimezone();
  const envZone = process.env.TZ;
  const now = Date.now;
  let provider: any;
  process.env.TZ = 'UTC';
  Date.now = () => Date.parse('2026-09-29T12:00:00Z');
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return { workspace: { workspaceFolders: [] } };
    return load.call(this, request, parent, isMain);
  };
  try {
    I18n.setTimezone('');
    const { resolveTimeZone } = require('../dateKeys');
    assert.equal(resolveTimeZone(''), 'UTC', 'this fixture uses an explicit system zone');
    const { UsageWebviewProvider } = require('../webview');
    provider = new UsageWebviewProvider({ globalState: {
      get: () => undefined, update: async () => undefined,
    } }) as any;
    await run(provider);
  } finally {
    if (provider) await Promise.all([
      provider.achievementWrite, provider.achievementHourWrite,
    ].map(write => Promise.resolve(write).catch(() => undefined)));
    (Module as any)._load = load;
    I18n.setTimezone(zone);
    Date.now = now;
    if (envZone === undefined) delete process.env.TZ; else process.env.TZ = envZone;
  }
}

test('system-zone preference retains the same verified night portrait as an explicit zone', async () => {
  await withSystemZoneProvider(async provider => {
    const start = Date.parse('2026-09-02T00:00:00Z') / 3_600_000;
    const hours = Array.from({ length: 14 }, (_, day) =>
      [0, 9, 22, 23].map(hour => start + day * 24 + hour)).flat();
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    provider.codexView = {
      currentManifestVerified: true,
      outputHourProof: { complete: true, hours },
      hourlyCoverage: { complete: true, timeZone: 'UTC' },
      periodCoverage: { last30Days: { complete: true } },
      coverage: { identity: { complete: true } }, last30DaysHourlyByDay: {},
    };
    assert.equal(provider.achievementHourSignals().nightPeak, true,
      'empty means the system zone, not an invalid Intl timeZone');
    I18n.setTimezone('UTC');
    assert.equal(provider.achievementHourSignals().nightPeak, true);
  });
});

test('system-zone preference accepts a complete current-zone rolling hour fallback', async () => {
  await withSystemZoneProvider(async provider => {
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    provider.codexView = {
      currentManifestVerified: true,
      outputHourProof: { complete: false, hours: [] },
      hourlyCoverage: { complete: true, timeZone: 'UTC' },
      periodCoverage: { last30Days: { complete: true } },
      coverage: { identity: { complete: true } },
      last30DaysHourlyByDay: { '2026-09-02': Array.from({ length: 12 }, (_, hour) => ({
        hour: String(hour).padStart(2, '0'), total: { output: 1 },
      })) },
    };
    assert.equal(provider.achievementHourSignals().streak, 12,
      'the resolved system zone must match the verified rolling projection');
    I18n.setTimezone('UTC');
    assert.equal(provider.achievementHourSignals().streak, 12);
    provider.codexView = { ...provider.codexView, currentManifestVerified: false };
    assert.equal(provider.achievementHourSignals().streak, 0,
      'normalizing the zone does not loosen the current-manifest fence');
  });
});
