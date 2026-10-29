import {test,expect,openClaude} from './support/app.mjs';
for(const theme of ['light','dark','highContrast'])for(const locale of ['zh-CN','en']){
 test(`closed rolling windows preserve old awards and dates at 320px: ${theme} ${locale}`,async({page},info)=>{
  await openClaude(page,{fixture:'achievement-rolling-seven',theme,locale,width:320,timeZone:'UTC'});
  await page.locator('#tab-achievements').click();
  const tokens=page.locator('[data-achievement-key="weekly-volume"]');
  await expect(tokens).toContainText('600M');
  await expect(tokens.locator('.achievement-window')).toContainText('2026-07-09 – 2026-07-15');
  await expect(tokens).not.toContainText('9.6B');
  await tokens.locator('summary').click();
  await expect(tokens.locator('[data-award-rule-version="1"]')).toBeVisible();
  await expect(tokens.locator('[data-date-source="first-recorded"]')).toContainText('2026-06-10');
  await expect(tokens.locator('[data-date-source="retained-logs"]')).toContainText('2026-07-16');
  await expect(tokens.locator('[data-date-source="retained-logs"]')).toContainText('2026-07-09 – 2026-07-15');
  const money=page.locator('[data-achievement-key="claude-api-week"]');
  await expect(money.locator('.achievement-window')).toContainText('2026-07-09 – 2026-07-15');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await tokens.scrollIntoViewIfNeeded();await tokens.screenshot({path:info.outputPath(`rolling-${locale}-${theme}.png`),animations:'disabled'});
  await page.reload();
  await expect(tokens.locator('details')).toHaveAttribute('open');
  await expect(tokens.locator('[data-date-source="first-recorded"]')).toContainText('2026-06-10');
  await expect(tokens.locator('.achievement-window')).toContainText('2026-07-09 – 2026-07-15');
 });
}
