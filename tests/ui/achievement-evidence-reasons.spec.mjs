import {createRequire} from 'node:module';
import {test,expect,openCodex} from './support/app.mjs';
const require=createRequire(import.meta.url);
const {achievementEvidenceHintCopyFor}=require('../../out/i18n.js');
for(const locale of ['en','zh-CN','zh-TW','de-DE','ja','ko','pt-BR','id'])for(const theme of ['dark','light']){
  test(locale+' '+theme+': proof requirements stay readable and persistent without fabricated progress',async({page},testInfo)=>{
    const copy=achievementEvidenceHintCopyFor(locale);
    for(const [fixture,state,reason] of [['default','pending','calendar'],['achievement-proof-stale','stale','stale']]){
      await openCodex(page,{locale,theme,width:320,fixture});
      await page.locator('#tab-achievements').click();
      const card=page.locator('[data-achievement-key="astra-days"]');
      await expect(card).toHaveAttribute('data-achievement-proof',state);
      await card.locator('summary').focus();
      if(!await card.locator('details').evaluate(element=>element.open))await card.locator('summary').press('Enter');
      const hint=card.locator('[data-proof-explanation]');
      await expect(hint).toHaveAttribute('data-proof-explanation',reason);
      await expect(hint).toBeVisible();
      await expect(hint).toContainText(copy[reason]);
      await expect(hint.locator('svg')).toHaveAttribute('aria-hidden','true');
      await expect(card.locator('progress,.achievement-current-progress')).toHaveCount(0);
      await page.clock.runFor(200);await page.reload();
      await expect(card.locator('details')).toHaveAttribute('open');
      await expect(hint).toContainText(copy[reason]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(locale==='zh-CN')await card.screenshot({path:testInfo.outputPath('proof-'+state+'-'+theme+'.png'),animations:'disabled'});
      expect(await page.evaluate(()=>window.__ccuPostedMessages.some(row=>['refresh','updateSetting','exportAchievementShare','previewAchievementShare'].includes(row.command)))).toBe(false);
    }
  });
}
