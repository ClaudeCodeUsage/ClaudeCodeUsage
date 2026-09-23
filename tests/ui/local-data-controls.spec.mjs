import { test, expect, openClaude, openCodex } from './support/app.mjs';

test('Settings stays concise: repository privacy controls are not rendered in the plugin', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-settings').click();

  await expect(page.locator('#localDataTitle')).toHaveCount(0);
  await expect(page.locator('.local-data-controls')).toHaveCount(0);
  await expect(page.locator('#localDataQuotaScope')).toHaveCount(0);
  await expect(page.getByText('Enable sharing workspace', { exact: true })).toBeVisible();
  await expect(page.locator('#set_enableShareCard')).toBeChecked();
  expect(await page.evaluate(() => window.__ccuPostedMessages.some(
    (message) => message.command === 'requestLocalDataInventory',
  ))).toBe(false);
});

test('an inventory reply cannot materialize the removed settings UI', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-settings').click();
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataInventoryResult',
        ok: true,
        inventory: {
          schemaVersion: 1,
          generatedAt: Date.now(),
          rows: [{
            id: 'P2',
            category: '<img src=x onerror="window.__inventoryInjected=true">P2 quota observations',
            locationClass: 'Extension global storage / quota observations',
            schema: 'schema 2',
            approximateBytes: 512,
            itemCount: 3,
            oldestAt: Date.parse('2026-07-01T00:00:00Z'),
            newestAt: Date.parse('2026-07-03T00:00:00Z'),
            networkInteraction: 'Structured observations only',
            clearability: 'Scoped clear',
          }],
          quotaScopes: [{
            token: '0123456789abcdef0123456789abcdef0123',
            label: 'Codex local anonymous account epoch 1 (3)',
            provider: 'codex',
            itemCount: 3,
            oldestAt: null,
            newestAt: null,
          }],
          exclusions: ['provider-owned source logs', 'provider credentials'],
        },
      },
    }));
  });

  await expect(page.locator('#localDataInventoryBody')).toHaveCount(0);
  expect(await page.evaluate(() => window.__inventoryInjected === true)).toBe(false);
});

test('UI and sharing resets are independent and preserve unrelated localStorage', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-settings').click();
  await page.evaluate(() => {
    localStorage.setItem('ccu.activeTab', 'settings');
    localStorage.setItem('ccu.sessionRange', '30');
    localStorage.setItem('ccu.sharing.template', 'claudeShareCard');
    localStorage.setItem('ccu.combinedHeatmap.title', 'Synthetic title');
    localStorage.setItem('ccu.combinedHeatmap.range', '90d');
    localStorage.setItem('unrelated-private-canary', 'preserve');
    acquireVsCodeApi().setState({ scrollPositions: { settings: 10 } });
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataClientAction',
        action: 'reset-ui-state',
        requestId: 'opaque-reset-request-1',
      },
    }));
  });
  expect(await page.evaluate(() => window.__ccuPostedMessages.findLast(
    (message) => message.command === 'localDataClientActionAck',
  ))).toEqual({
    command: 'localDataClientActionAck',
    requestId: 'opaque-reset-request-1',
    ok: true,
  });
  expect(await page.evaluate(() => ({
    active: localStorage.getItem('ccu.activeTab'),
    range: localStorage.getItem('ccu.sessionRange'),
    sharingTemplate: localStorage.getItem('ccu.sharing.template'),
    shareTitle: localStorage.getItem('ccu.combinedHeatmap.title'),
    state: JSON.parse(localStorage.getItem('__ccu-vscode-state') || '{}'),
    unrelated: localStorage.getItem('unrelated-private-canary'),
  }))).toEqual({
    active: null,
    range: null,
    sharingTemplate: 'claudeShareCard',
    shareTitle: 'Synthetic title',
    state: {},
    unrelated: 'preserve',
  });

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { command: 'localDataClientAction', action: 'reset-sharing-preferences' },
    }));
  });
  expect(await page.evaluate(() => ({
    sharingTemplate: localStorage.getItem('ccu.sharing.template'),
    title: localStorage.getItem('ccu.combinedHeatmap.title'),
    range: localStorage.getItem('ccu.combinedHeatmap.range'),
    unrelated: localStorage.getItem('unrelated-private-canary'),
  }))).toEqual({ sharingTemplate: null, title: null, range: null, unrelated: 'preserve' });
});

test('sharing reset refreshes the visible master switch without browser command-coordination state', async ({ page }) => {
  await openClaude(page);
  await page.locator('#tab-settings').click();
  const masterSwitch = page.locator('#set_enableShareCard');
  await masterSwitch.evaluate((element) => {
    element.checked = false;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(() => {
    localStorage.setItem('ccu.sharing.template', 'claudeShareCard');
    sessionStorage.setItem('unrelated-session-canary', 'preserve');
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataClientAction',
        action: 'reset-sharing-preferences',
        requestId: 'sharing-reset-runtime-1',
      },
    }));
  });

  await expect(masterSwitch).toBeChecked();
  expect(await page.evaluate(() => ({
    template: localStorage.getItem('ccu.sharing.template'),
    unrelated: sessionStorage.getItem('unrelated-session-canary'),
    ack: window.__ccuPostedMessages.findLast(
      (message) => message.requestId === 'sharing-reset-runtime-1',
    ),
  }))).toEqual({
    template: null,
    unrelated: 'preserve',
    ack: {
      command: 'localDataClientActionAck',
      requestId: 'sharing-reset-runtime-1',
      ok: true,
    },
  });
});

test('client reset ACK is false when allowlisted browser storage cannot be deleted', async ({ page }) => {
  await openCodex(page);
  await page.locator('#tab-settings').click();
  await page.evaluate(() => {
    localStorage.setItem('ccu.activeTab', 'settings');
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function failingRemoveItem() {
      throw new Error('synthetic-storage-failure');
    };
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        command: 'localDataClientAction',
        action: 'reset-ui-state',
        requestId: 'opaque-reset-failure-1',
      },
    }));
    Storage.prototype.removeItem = original;
  });

  expect(await page.evaluate(() => window.__ccuPostedMessages.findLast(
    (message) => message.command === 'localDataClientActionAck',
  ))).toEqual({
    command: 'localDataClientActionAck',
    requestId: 'opaque-reset-failure-1',
    ok: false,
  });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ccu.activeTab')))
    .toBe('settings');
});
