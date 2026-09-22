import { test, expect, openClaude, openCodex } from './support/app.mjs';

test('Claude pricing backend is available only in Claude settings', async ({ page }) => {
  await openClaude(page);
  await page.locator('#tab-settings').click();

  const backend = page.locator('#set_pricingBackend');
  await expect(backend).toBeVisible();
  await expect(page.locator('label[for="set_pricingBackend"]')).toHaveText('Claude pricing backend');
  await expect(backend.locator('option')).toHaveText([
    'Anthropic direct API',
    'AWS Bedrock (in-region)',
  ]);
  await expect(backend).toHaveValue('anthropic');

  await openCodex(page);
  await page.locator('#tab-settings').click();
  await expect(page.locator('#set_pricingBackend')).toHaveCount(0);
});

test('Claude pricing backend dropdown posts the selected Bedrock backend', async ({ page }) => {
  await openClaude(page);
  await page.locator('#tab-settings').click();

  await page.locator('#set_pricingBackend').selectOption('aws-bedrock-in-region');

  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.at(-1))).toEqual({
    command: 'updateSetting',
    key: 'pricingBackend',
    value: 'aws-bedrock-in-region',
  });
});

test('quota format offers compact presets and reveals template syntax only for custom layouts', async ({ page }) => {
  await openClaude(page);
  await page.locator('#tab-settings').click();

  const preset = page.locator('#set_statusBarQuotaFormat_preset');
  const custom = page.locator('#set_statusBarQuotaFormat');
  await expect(preset).toBeVisible();
  await expect(preset).toHaveValue('');
  await expect(custom).toBeHidden();
  await expect(preset.locator('option')).toHaveCount(4);

  await preset.selectOption('{wk.label} {wk.pct}');
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.at(-1))).toEqual({
    command: 'updateSetting',
    key: 'statusBarQuotaFormat',
    value: '{wk.label} {wk.pct}',
  });
  await expect(custom).toBeHidden();

  await preset.selectOption('custom');
  await expect(custom).toBeVisible();
  await expect(custom).toHaveAttribute('maxlength', '120');
  await custom.fill('{5h.pct} | {wk.pct}');
  await custom.dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.at(-1))).toEqual({
    command: 'updateSetting',
    key: 'statusBarQuotaFormat',
    value: '{5h.pct} | {wk.pct}',
  });

  await preset.selectOption('');
  await expect(custom).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.at(-1))).toEqual({
    command: 'updateSetting',
    key: 'statusBarQuotaFormat',
    value: '',
  });
});

for (const locale of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id']) {
  test(`${locale} quota format remains usable at narrow width`, async ({ page }) => {
    await openClaude(page, { locale, width: 360, height: 800 });
    await page.locator('#tab-settings').click();
    const preset = page.locator('#set_statusBarQuotaFormat_preset');
    await expect(preset).toBeVisible();
    await preset.selectOption('custom');
    await expect(page.locator('#set_statusBarQuotaFormat')).toBeVisible();
    const bounds = await page.locator('.settings-panel').evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
  });
}
