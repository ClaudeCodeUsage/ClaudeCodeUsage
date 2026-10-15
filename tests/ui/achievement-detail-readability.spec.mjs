import {test,expect,openClaude,openCodex} from './support/app.mjs';
import AxeBuilder from '@axe-core/playwright';

for(const locale of ['en','zh-CN'])for(const theme of ['light','dark','highContrast']){
 test(`${locale} ${theme}: shared money reference and separated rank rules survive reload`,async({page},info)=>{
  await openClaude(page,{locale,theme,fixture:'achievement-management-full',claudeOnly:true,width:1280});
  await page.locator('#tab-achievements').click();
  const card=page.locator('[data-achievement-key="claude-api-total"]');
  await card.locator('summary').click();
  await expect(card).not.toContainText('api-reference-');
  const rows=card.locator('.achievement-level-rules > li');
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  const separated=await rows.evaluateAll(rows=>rows.every((row,index)=>!index||
    row.getBoundingClientRect().top-rows[index-1].getBoundingClientRect().bottom>=8));
  expect(separated).toBe(true);
  await card.locator('[data-achievement-reference]').click();
  const reference=page.locator('#achievementMoneyReference');
  await expect(reference).toBeVisible();await expect(reference).toBeFocused();
  await expect(reference.locator('[data-reference-provider="claude"] code')).toHaveCount(1);
  await expect(reference.locator('[data-reference-provider="codex"] code')).toHaveCount(0);
  await page.reload();await expect(reference).toBeVisible();
  const narrow=page.locator('[data-achievement-key="claude-api-total"]');
  await expect(narrow.locator('details')).toHaveAttribute('open','');
  await page.setViewportSize({width:360,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const audit=await new AxeBuilder({page}).include('.achievement-collection').analyze();
  expect(audit.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
  if(locale==='zh-CN')await narrow.screenshot({path:info.outputPath('rank-requirements-'+theme+'.png'),animations:'disabled'});
  expect(await page.evaluate(()=>window.__ccuPostedMessages.filter(row=>
    ['refresh','recalibrateAchievements','updateSetting'].includes(row.command)))).toEqual([]);
 });
}
test('independent root task copy explains counting without implying task completion',async({page})=>{
 await openCodex(page,{locale:'zh-CN'});await page.locator('#tab-achievements').click();
 const card=page.locator('[data-achievement-key="root-portfolio"]');
 await expect(card.locator('h4')).toHaveText('独立主任务');await card.locator('summary').click();
 await expect(card.locator('.achievement-common-conditions')).toContainText('只计一次');
 await expect(card.locator('.achievement-common-conditions')).toContainText('不表示任务完成');
 await expect(page.locator('#provider-tab-compare')).toHaveText('分享与对比');
 await expect(page.locator('#achievementMoneyReference [data-reference-provider="claude"] code')).toHaveCount(1);
 await expect(page.locator('#achievementMoneyReference [data-reference-provider="codex"] code')).toHaveCount(1);
});
test('both weekly API themes expose all five ranks with unchanged initial thresholds',async({page})=>{
 await openCodex(page,{locale:'zh-CN'});await page.locator('#tab-achievements').click();
 for(const provider of ['claude','codex']){
  const card=page.locator(`[data-achievement-key="${provider}-api-week"]`);await card.locator('summary').click();
  const rows=card.locator('.achievement-level-rules > li');await expect(rows).toHaveCount(5);
  await expect(rows.locator(':scope > strong')).toHaveText(['铜','银','金','铂金','传奇']);
  await expect(rows.locator(':scope > span')).toHaveText(['$100','$500','$2,500','$10,000','$25,000']);
  await expect(card).not.toContainText('api-reference-');
 }
});
