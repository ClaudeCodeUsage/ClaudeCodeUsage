import {test,expect,openClaude} from './support/app.mjs';
import AxeBuilder from '@axe-core/playwright';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {I18n}=require('../../out/i18n.js');
const locales=['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'];
async function confirmedUpdate(page){
 const response=await page.context().request.get(page.url());
 expect(response.ok()).toBe(true);
 await page.evaluate(html=>{
  const panel=new DOMParser().parseFromString(html,'text/html').getElementById('provider-panel');
  dispatchEvent(new MessageEvent('message',{data:{command:'dashboardDataPatch',provider:'claude',tab:'achievements',
   revision:71,html:panel.innerHTML,claudeLast30HoursByDay:{},adviceSnapshotIds:{}}}));
 },await response.text());
 await expect.poll(()=>page.evaluate(()=>window.__ccuPostedMessages.some(r=>r.command==='dashboardDataPatchAck'&&r.revision===71&&r.ok))).toBe(true);
 await page.clock.runFor(200);
}
for(const locale of locales)for(const theme of ['light','dark','highContrast']){
 test(locale+' '+theme+': batch disclosures persist through update/reload without affecting evidence or grants',async({page},info)=>{
  I18n.setLanguage(locale);
  const copy=I18n.achievementManagement;
  await openClaude(page,{locale,theme,fixture:'achievement-pins',claudeOnly:true,width:1280});
  await page.locator('#tab-achievements').click();
  const cards=page.locator('details.achievement-disclosure');
  expect(await cards.count()).toBeGreaterThan(20);
  const actions=['achievementExpandAll','achievementCollapseAll','achievementRecalibrate'];
  for(const id of actions){
   await expect(page.locator('#'+id)).toBeVisible();
   await expect(page.locator('#'+id)).toHaveAccessibleName(/\S/);
   await expect(page.locator('#'+id+' svg')).toHaveAttribute('aria-hidden','true');
  }
  await page.locator('#achievementExpandAll').focus();await page.keyboard.press('Enter');
  await expect.poll(()=>cards.evaluateAll(rows=>rows.every(r=>r.open))).toBe(true);
  await expect(page.locator('#achievementExpandAll')).toBeFocused();
  await expect(page.locator('.achievement-evidence-note')).not.toHaveAttribute('open','');
  await confirmedUpdate(page);
  await expect.poll(()=>cards.evaluateAll(rows=>rows.every(r=>r.open))).toBe(true);
  await page.reload();await expect.poll(()=>cards.evaluateAll(rows=>rows.every(r=>r.open))).toBe(true);
  await page.locator('#achievementFilter').selectOption('earned');
  await page.locator('#achievementCollapseAll').focus();await page.keyboard.press('Enter');
  await expect.poll(()=>cards.evaluateAll(rows=>rows.every(r=>!r.open))).toBe(true);
  await page.reload();await expect.poll(()=>cards.evaluateAll(rows=>rows.every(r=>!r.open))).toBe(true);
  await expect(page.locator('#achievementFilter')).toHaveValue('earned');
  await page.setViewportSize({width:320,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.locator('#achievementExpandAll')).toHaveText(copy.expandAll);
  const audit=await new AxeBuilder({page}).include('.achievement-filter-toolbar').include('.achievement-intro').analyze();
  expect(audit.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
  if(locale==='zh-CN')await page.screenshot({path:info.outputPath('management-'+theme+'-320.png'),animations:'disabled'});
  const forbidden=await page.evaluate(()=>window.__ccuPostedMessages.filter(r=>/^(refresh|updateSetting|setAchievementPinned|recalibrateAchievements|achievementNoticeAck|markAchievementGroupRead)$/.test(r.command)));
  expect(forbidden).toEqual([]);
 });
}
test('different levels display their retained-log crossing date without replacing original records',async({page})=>{
 await openClaude(page,{locale:'zh-CN',fixture:'achievement-management-history',claudeOnly:true,timeZone:'UTC'});
 await page.locator('#tab-achievements').click();
 const card=page.locator('[data-achievement-key="sonnet-main"]');
 await card.locator('summary').click();
 await expect(card.locator('[data-achievement-level="sonnet-main"] time')).toHaveAttribute('datetime','2026-06-01');
 await expect(card.locator('[data-achievement-level="sonnet-main-silver"] time')).toHaveAttribute('datetime','2026-06-03');
 await expect(card.locator('[data-achievement-level="sonnet-main-gold"] time')).toHaveCount(0);
 await expect(card.locator('.achievement-common-conditions')).toHaveCount(1);
 await expect(card.locator('[data-achievement-level="sonnet-main"] strong')).toHaveText('铜');
 await expect(card.locator('[data-achievement-level="sonnet-main-silver"] strong')).toHaveText('银');
 await expect(card.locator('[data-achievement-level="sonnet-main-gold"] strong')).toHaveText('金');
 await page.reload();await expect(card.locator('[data-achievement-level="sonnet-main-silver"] time')).toHaveAttribute('datetime','2026-06-03');
});
test('highest earned rank retains its actual current value above the final threshold',async({page})=>{
 await openClaude(page,{locale:'en',fixture:'achievement-management-full',claudeOnly:true});
 await page.locator('#tab-achievements').click();
 const card=page.locator('[data-achievement-key="sonnet-main"]');
 await expect(card.locator('.achievement-current-value')).toContainText('60B');
 await expect(card.locator('.achievement-current-value')).not.toContainText('50B');
 await card.locator('summary').click();
 await expect(card.locator('.achievement-progress-label')).toContainText('60B');
 await expect(card.locator('.achievement-progress-label')).not.toContainText('60B / 50B');
});
test('explicit recalibration is generation-bound and pending cannot double-submit',async({page})=>{
 await openClaude(page,{locale:'en',fixture:'achievement-pins',claudeOnly:true});
 await page.locator('#tab-achievements').click();
 await page.locator('#achievementRecalibrate').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#achievementRecalibrate')).toBeDisabled();
 const requests=await page.evaluate(()=>window.__ccuPostedMessages.filter(r=>r.command==='recalibrateAchievements'));
 expect(requests).toHaveLength(1);expect(requests[0].documentId).toMatch(/^[a-f0-9]{48}$/);
 await page.evaluate(request=>dispatchEvent(new MessageEvent('message',{data:{command:'achievementCalibrationState',
  documentId:'wrong',pending:false,failed:false,text:'not accepted'}})),requests[0]);
 await expect(page.locator('#achievementRecalibrate')).toBeDisabled();
 await page.evaluate(request=>dispatchEvent(new MessageEvent('message',{data:{command:'achievementCalibrationState',
  documentId:request.documentId,pending:false,failed:true,text:'Could not recalibrate.'}})),requests[0]);
 await expect(page.locator('#achievementRecalibrate')).toBeEnabled();
 await expect(page.locator('#achievementCalibrationStatus')).toHaveText('Could not recalibrate.');
});
