import { test, expect, openClaude } from './support/app.mjs';
import AxeBuilder from '@axe-core/playwright';

for (const theme of ['dark','light','highContrast']) {
  test(`showcase pairs badges with goals and uses accessible illustrated controls: ${theme}`, async ({page},testInfo) => {
    await openClaude(page,{locale:'zh-CN',theme,fixture:'achievement-pins',width:1440});
    await page.locator('#tab-achievements').click();
    const showcase=page.locator('.achievement-showcase');
    await expect(showcase.locator(':scope > [data-achievement-overview]')).toHaveCount(2);
    const badges=showcase.locator('[data-achievement-overview="badges"]');
    const next=showcase.locator('[data-achievement-overview="next"]');
    const a=await badges.boundingBox(),b=await next.boundingBox();
    expect(Math.abs(a.y-b.y)).toBeLessThanOrEqual(1);
    expect(b.x-a.x-a.width).toBeLessThanOrEqual(20);
    for(const command of ['openAchievementShare()','openAchievementSettings()']) {
      const button=page.locator('.achievement-intro button[onclick="'+command+'"]');
      await expect(button).toBeVisible();
      await expect(button).toHaveAccessibleName(/\S/);
      await expect(button.locator('svg')).toHaveAttribute('aria-hidden','true');
    }
    if(theme==='light'){
      const audit=await new AxeBuilder({page}).include('.achievement-filter-toolbar').analyze();
      expect(audit.violations.filter(row=>['serious','critical'].includes(row.impact))).toEqual([]);
    }
    await page.screenshot({path:testInfo.outputPath('compact-showcase-desktop.png'),animations:'disabled'});
    await page.setViewportSize({width:320,height:900});
    const narrowA=await badges.boundingBox(),narrowB=await next.boundingBox();
    expect(narrowB.y-narrowA.y-narrowA.height).toBeLessThanOrEqual(16);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#achievementSize').selectOption('small');
    await page.locator('#achievementFilter').selectOption('earned');
    await page.reload();
    await expect(page.locator('#achievementSize')).toHaveValue('small');
    await expect(page.locator('#achievementFilter')).toHaveValue('earned');
    await expect(page.locator('.achievement-showcase > [data-achievement-overview]')).toHaveCount(2);
    await page.screenshot({path:testInfo.outputPath('compact-showcase-narrow.png'),animations:'disabled'});
    expect(await page.evaluate(()=>window.__ccuPostedMessages.some(row=>['refresh','updateSetting'].includes(row.command)))).toBe(false);
  });
}

for (const theme of ['dark', 'light', 'highContrast']) {
  test(`overview uses bounded horizontal cards rather than sparse columns: ${theme}`, async ({page}, testInfo) => {
    await openClaude(page, {locale:'zh-CN', theme, fixture:'achievement-pins', width:1920});
    await page.locator('#tab-achievements').click();
    const items = page.locator('.achievement-overview-item');
    expect(await items.count()).toBeGreaterThan(0);
    const geometry = await items.evaluateAll(rows => rows.map(row => {
      const card = row.getBoundingClientRect();
      const image = row.querySelector('img').getBoundingClientRect();
      const name = row.querySelector('.achievement-overview-name').getBoundingClientRect();
      const pin = row.querySelector('.achievement-pin')?.getBoundingClientRect();
      return {width:card.width,height:card.height,horizontal:name.left>=image.right,
        pinInside:!pin || pin.right<=card.right && pin.left>=card.left};
    }));
    for (const card of geometry) {
      expect(card.width).toBeLessThanOrEqual(400);
      expect(card.height).toBeLessThanOrEqual(180);
      expect(card.horizontal).toBe(true);
      expect(card.pinInside).toBe(true);
    }
    await expect(page.locator('[data-achievement-overview="next"] .achievement-overview-track').first()).toBeVisible();
    await page.locator('.achievement-collection').scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath('overview-desktop.png'),animations:'disabled'});
    await items.first().locator('.achievement-overview-badge').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.achievement-disclosure[open]').first()).toBeVisible();
  });
}

test('compact overview remains readable at 320px and preserves size after reload', async ({page},testInfo) => {
  await openClaude(page,{locale:'de-DE',theme:'dark',fixture:'achievement-six-pins',width:320});
  await page.locator('#tab-achievements').click();
  for (const size of ['small','medium','large']) {
    await page.locator('#achievementSize').selectOption(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.achievement-overview-name').evaluateAll(rows => rows.every(row => row.scrollWidth<=row.clientWidth+1))).toBe(true);
  }
  await page.reload();
  await expect(page.locator('#achievementSize')).toHaveValue('large');
  await page.locator('.achievement-collection').scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('overview-narrow.png'),animations:'disabled'});
  expect(await page.evaluate(() => window.__ccuPostedMessages.some(row => ['refresh','updateSetting'].includes(row.command)))).toBe(false);
});

test.describe('touch overview', () => {
  test.use({hasTouch:true});
  test('pin hit areas never cover the adjacent badge title', async ({page}) => {
    await openClaude(page,{locale:'de-DE',theme:'dark',fixture:'achievement-six-pins',width:320});
    await page.locator('#tab-achievements').click();
    for (const size of ['small','medium','large']) {
      await page.locator('#achievementSize').selectOption(size);
      const gaps = await page.locator('[data-achievement-overview="badges"] .achievement-overview-item').evaluateAll(rows => rows.map(row => {
        const pin = row.querySelector('.achievement-pin')?.getBoundingClientRect();
        const name = row.querySelector('.achievement-overview-name').getBoundingClientRect();
        return pin ? pin.left-name.right : 0;
      }));
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps.every(gap => gap >= 0)).toBe(true);
    }
  });
});
