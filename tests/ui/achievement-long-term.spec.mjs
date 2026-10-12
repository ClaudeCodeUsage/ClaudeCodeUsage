import AxeBuilder from '@axe-core/playwright';
import {test,expect,openClaude} from './support/app.mjs';

async function upgrade(page,rank,revision) {
  const url=new URL(page.url());url.searchParams.set('fixture','achievement-long-term-'+rank);
  const response=await page.context().request.get(url.href);
  expect(response.ok()).toBe(true);
  await page.evaluate(({html,revision,url})=>{
    const next=new DOMParser().parseFromString(html,'text/html').getElementById('provider-panel');
    dispatchEvent(new MessageEvent('message',{data:{command:'dashboardDataPatch',provider:'claude',
      tab:'achievements',revision,html:next.innerHTML,claudeLast30HoursByDay:{},adviceSnapshotIds:{}}}));
    history.replaceState(null,'',url);
  },{html:await response.text(),revision,url:url.href});
  await page.clock.runFor(200);
}

for(const locale of ['en','zh-CN','zh-TW','de-DE','ja','ko','pt-BR','id']) for(const theme of ['dark','light','highContrast']) {
  test(`${locale} ${theme}: Gold to Platinum to Legendary preserves details and explicit sharing`,async({page},testInfo)=>{
    await openClaude(page,{locale,theme,fixture:'achievement-long-term-gold',claudeOnly:true,width:320});
    await page.locator('#tab-achievements').click();
    const card=page.locator('.achievement-card[data-achievement-key="sonnet-main"]');
    await expect(card).toHaveAttribute('data-achievement-tier','gold');
    await card.locator('summary').focus();await page.keyboard.press('Enter');
    await expect(card.locator('details')).toHaveAttribute('open','');
    await expect(card.locator('[data-achievement-level]')).toHaveCount(5);
    await page.evaluate(()=>localStorage.setItem('ccu.sharing.achievementBadges',JSON.stringify(['sonnet-main-gold'])));
    for(const [index,rank] of ['platinum','legendary'].entries()) {
      await upgrade(page,rank,index+1);
      await expect(card).toHaveAttribute('data-achievement-tier',rank);
      await expect(card.locator('details')).toHaveAttribute('open','');
      expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ccu.sharing.achievementBadges')))).toEqual(['sonnet-main-gold']);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(await card.locator('h4').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({path:testInfo.outputPath(rank+'.png'),animations:'disabled'});
    }
    const accessibility=await new AxeBuilder({page}).include('.achievement-collection').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.reload();
    await expect(card).toHaveAttribute('data-achievement-tier','legendary');
    await expect(card.locator('details')).toHaveAttribute('open','');
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ccu.sharing.achievementBadges')))).toEqual(['sonnet-main-gold']);
  });
}
