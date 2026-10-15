import { test, expect } from './support/app.mjs';

const baseUrl = `http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}`;
const iconRoute = '/__achievement_icons__/';

async function openSharing(page, provider, nativeResources = true) {
  const query = new URLSearchParams({ provider, locale: 'zh-CN', theme: 'dark', fixture: 'achievement-share-resources',
    commandTemplate: 'achievements', nativeResources: String(nativeResources),
    claudeOnly: String(provider === 'claude') });
  await page.goto(`${baseUrl}/?${query}`);
  await expect(page.locator('#sharingTemplate')).toHaveValue('achievements');
  await expect(page.locator(`#provider-tab-${provider}`)).toHaveAttribute('aria-selected', 'true');
}

async function expectLoadedThumbnails(page) {
  const images = page.locator('.achievement-share-choice-icon');
  expect(await images.count()).toBeGreaterThan(9);
  // Lazy images must enter the viewport before judging their loaded state.
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  }
}

for (const provider of ['compare', 'claude']) {
  test(`${provider} loads selected and unselected bundled thumbnails with a narrow image CSP`, async ({ page }, info) => {
    await openSharing(page, provider);
    const choices = page.locator('.achievement-share-choice');
    await choices.first().check();
    await expect(page.locator('.achievement-share-choice:checked')).toHaveCount(1);
    expect(await page.locator('.achievement-share-choice:not(:checked)').count()).toBeGreaterThan(0);
    for (const image of await page.locator('.achievement-share-choice-icon').all()) {
      expect(await image.getAttribute('src')).toMatch(/^\/__achievement_icons__\/[a-z0-9-]+\.png$/);
    }
    // This is the red regression on the original Compare CSP: URLs exist and
    // return PNGs, but img-src data: blocks every resource thumbnail.
    await expectLoadedThumbnails(page);
    if(provider==='compare')await page.locator('.achievement-share-options').screenshot({path:info.outputPath('share-selection-dark.png')});
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    const imageSources = csp.split(';').map(part => part.trim()).find(part => part.startsWith('img-src '));
    expect(imageSources.split(/\s+/).slice(1).sort()).toEqual(["'self'", 'data:'].sort());
  });

  test(`${provider} keyboard choices enforce nine and survive a panel update and reload`, async ({ page }) => {
    await openSharing(page, provider);
    const choices = page.locator('.achievement-share-choice');
    expect(await choices.count()).toBeGreaterThan(9);
    await expect(page.locator('.achievement-share-choice:checked')).toHaveCount(0);
    for (let index = 0; index < 9; index += 1) {
      await choices.nth(index).focus();
      await choices.nth(index).press('Space');
    }
    await expect(page.locator('#achievementShareCount')).toHaveText('9/9');
    await expect(choices.nth(9)).toBeDisabled();
    // A tenth checkbox cannot take keyboard focus while the limit is reached.
    await choices.nth(9).focus();
    await expect(choices.nth(9)).not.toBeFocused();
    await expect(page.locator('.achievement-share-choice:checked')).toHaveCount(9);
    await choices.first().focus();
    await choices.first().press('Space');
    await expect(choices.nth(9)).toBeEnabled();
    await choices.nth(9).focus();
    await choices.nth(9).press('Space');
    const selected = await page.locator('.achievement-share-choice:checked').evaluateAll(inputs => inputs.map(input => input.value));
    expect(selected).toHaveLength(9);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ccu.sharing.achievementBadges')))).toEqual(selected);
    const response = await page.request.get(page.url());
    expect(response.ok()).toBe(true);
    await page.evaluate(({ html, provider }) => {
      const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
      window.dispatchEvent(new MessageEvent('message', { data: { command: 'dashboardDataPatch',
        provider, tab: 'all', revision: 1, html: next.innerHTML,
        claudeLast30HoursByDay: {}, adviceSnapshotIds: {} } }));
    }, { html: await response.text(), provider });
    await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.filter(message =>
      message.command === 'dashboardDataPatchAck'))).toEqual([{ command: 'dashboardDataPatchAck', revision: 1, ok: true }]);
    const expectSelection = async () => {
      await expect(page.locator('#sharingTemplate')).toHaveValue('achievements');
      expect(await page.locator('.achievement-share-choice:checked').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(selected);
      await expect(page.locator('#achievementShareCount')).toHaveText('9/9');
      for (const unchecked of await page.locator('.achievement-share-choice:not(:checked)').all()) await expect(unchecked).toBeDisabled();
    };
    await expectSelection();
    await page.reload();
    await expectSelection();
    await expectLoadedThumbnails(page);
  });
}

test('resource mode is opt-in and the image route rejects non-catalog paths', async ({ page, request }) => {
  await openSharing(page, 'compare', false);
  for (const image of await page.locator('.achievement-share-choice-icon').all()) {
    expect(await image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  }
  await expectLoadedThumbnails(page);
  await openSharing(page, 'claude');
  const src = await page.locator('.achievement-share-choice-icon').first().getAttribute('src');
  const response = await request.get(baseUrl + src);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/png');
  expect((await response.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  for (const path of ['unknown.png', 'package.json', '%2e%2e%2fpackage.json',
    '%2Fetc%2Fpasswd', 'claude-sonnet-main.png/extra', 'claude-sonnet-main.svg']) {
    expect((await request.get(baseUrl + iconRoute + path)).status()).toBe(404);
  }
  expect((await request.get(`${baseUrl}/?provider=compare&fixture=combined-heatmap`)).status()).toBe(200);
  expect((await request.get(`${baseUrl}/health`)).status()).toBe(200);
});
