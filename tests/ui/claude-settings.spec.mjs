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
