import AxeBuilder from '@axe-core/playwright';
import {test,expect,openCodex} from './support/app.mjs';
for (const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id']) {
  for (const theme of ['light','dark','highContrast']) {
    test(`${locale} ${theme} calendar bounds preserve unknown means, disclosure and local restoration`,async({page},testInfo)=>{
      await openCodex(page,{locale,theme,fixture:'achievement-calendar-subset',width:locale==='en'?1280:360});
      await page.locator('#tab-achievements').click();
      const card=key=>page.locator(`.achievement-card[data-achievement-key="${key}"]`);
      for(const [key,text] of [['sol-days',/≥4/],['weekly-volume',/≥500M/],['codex-api-week',/≥\$1[,.]000/]]) {
        await expect(card(key)).toHaveAttribute('data-achievement-proof','ready');
        await expect(card(key).locator('.achievement-next-target')).toContainText(text);
      }
      await expect(card('weekly-average')).toHaveAttribute('data-achievement-proof','pending');
      // Existing cumulative volume admits one maximal counter per identity;
      // dates/money require the separately sound root. Preserve these scopes.
      await expect(card('cumulative-volume').locator('.achievement-next-target')).toContainText('≥1B');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await card('sol-days').locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(card('sol-days').locator('details')).toHaveAttribute('open');
      await page.reload();
      await expect(card('sol-days').locator('details')).toHaveAttribute('open');
      await expect(card('sol-days')).toHaveAttribute('data-achievement-proof','ready');
      await page.setViewportSize({width:320,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const violations=(await new AxeBuilder({page}).include('.achievement-collection').analyze()).violations;
      expect(violations).toEqual([]);
      expect((await page.evaluate(()=>window.__ccuPostedMessages)).filter(m=>
        /refresh|updateSetting|previewAchievementShare|exportAchievementShare|setAchievementPinned/.test(m.command))).toEqual([]);
      if(locale==='zh-CN'&&theme==='dark') {
        await page.setViewportSize({width:1280,height:900});
        await card('codex-api-week').scrollIntoViewIfNeeded();
        await page.screenshot({path:testInfo.outputPath('calendar-lower-bounds.png'),animations:'disabled'});
      }
    });
  }
}
