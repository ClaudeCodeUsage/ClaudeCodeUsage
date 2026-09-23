import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');

test('sharing renders only the active presentation and reuses materialized daily aggregates', () => {
  const originalLoad = (Module as any)._load;
  const activeColorTheme = { kind: 1 };
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') {
      return {
        ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
        window: { activeColorTheme },
        workspace: { getConfiguration: () => ({ get: () => undefined }) },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let shareBuilds = 0;

  try {
    const { UsageWebviewProvider } = require('../webview') as typeof import('../webview');
    const { I18n } = require('../i18n') as typeof import('../i18n');
    const provider = new UsageWebviewProvider({
      globalState: { get: () => undefined, update: async () => undefined },
    } as any) as any;
    provider.buildShareCardSvgFor = () => {
      shareBuilds += 1;
      return '<svg></svg>';
    };
    const initialRecords: any[] = [];
    const usage = {
      totalInputTokens: 100,
      totalOutputTokens: 20,
      totalCacheCreationTokens: 30,
      totalCacheReadTokens: 50,
      totalCost: 1.25,
      costBreakdown: { input: 0.1, output: 0.2, cacheWrite: 0.3, cacheRead: 0.65 },
      messageCount: 2,
      modelBreakdown: {},
    };
    const initialDaily = [{ date: '2026-09-22', data: usage }];
    provider.updateData(
      null, null, null, null, [], [], [], undefined, undefined, initialRecords,
      [], [], null, [], [], [], {}, null, initialDaily,
    );
    provider.providerAvailability = { claude: true, codex: true, codexData: true };

    const firstDaily = provider.getClaudeDailyUsageMap(I18n.getTimezone());
    assert.deepEqual(firstDaily, {
      '2026-09-22': { tokens: 200, cost: 1.25, sessions: 0 },
    });
    assert.strictEqual(
      provider.getClaudeDailyUsageMap(I18n.getTimezone()),
      firstDaily,
      'unchanged materialized days reuse the daily projection',
    );

    provider.sharingTemplate = 'combinedHeatmap';
    provider.renderSharingWorkspace();
    assert.equal(shareBuilds, 0, 'the hidden Share Card is not generated');

    provider.sharingTemplate = 'claudeShareCard';
    provider.renderSharingWorkspace();
    assert.equal(shareBuilds, 1, 'selecting Share Card generates one preview');
    provider.renderSharingWorkspace();
    assert.equal(shareBuilds, 1, 'unchanged Share Card preview is cached');

    const nextRecords: any[] = [];
    const nextDaily = [{ date: '2026-09-23', data: { ...usage, totalInputTokens: 300 } }];
    provider.updateData(
      null, null, null, null, [], [], [], undefined, undefined, nextRecords,
      [], [], null, [], [], [], {}, null, nextDaily,
    );
    const secondDaily = provider.getClaudeDailyUsageMap(I18n.getTimezone());
    assert.notStrictEqual(secondDaily, firstDaily);
    assert.equal(secondDaily['2026-09-23'].tokens, 400);
    provider.renderSharingWorkspace();
    assert.equal(shareBuilds, 2, 'changed indexed records invalidate the active Share Card once');

    const alternateZone = I18n.getTimezone() === 'Pacific/Auckland'
      ? 'America/Los_Angeles' : 'Pacific/Auckland';
    const alternateDaily = provider.getClaudeDailyUsageMap(alternateZone);
    assert.strictEqual(provider.getClaudeDailyUsageMap(alternateZone), alternateDaily);
    assert.notStrictEqual(alternateDaily, secondDaily, 'timezone remains part of the cache identity');

    activeColorTheme.kind = 2;
    provider.renderSharingWorkspace();
    assert.equal(shareBuilds, 3, 'theme changes rebuild the active theme-aware card');

    provider.invalidateShareCardPreview();
    provider.renderSharingWorkspace();
    assert.equal(shareBuilds, 4, 'formatting changes invalidate the active preview once');
  } finally {
    (Module as any)._load = originalLoad;
  }
});
