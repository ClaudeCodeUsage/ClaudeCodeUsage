import {test,expect,openClaude,openCodex} from './support/app.mjs';

for(const provider of ['claude','codex'])for(const width of [320,960]) {
 test(`${provider}: approved achievement layout at ${width}px`,async({page},info)=>{
  await (provider==='claude'?openClaude:openCodex)(page,{locale:'zh-CN',theme:'dark',fixture:'achievement-share-resources',width,height:1000});
  await page.locator('#tab-achievements').click();
  await page.locator('#achievementSize').selectOption('medium');
  await page.locator('.achievement-showcase').screenshot({path:info.outputPath(`overview-${provider}-${width}.png`)});
  const firstCard=page.locator('.achievement-card').first();await firstCard.scrollIntoViewIfNeeded();
  await expect.poll(()=>firstCard.locator('img').evaluate(im=>im.complete&&im.naturalWidth>0)).toBe(true);
  await firstCard.screenshot({path:info.outputPath(`card-${provider}-${width}.png`)});
  await page.locator('.achievement-collection').screenshot({path:info.outputPath(`achievements-${provider}-${width}.png`)});
  const geometry=await page.locator('.achievement-card summary .achievement-framed-icon').first().evaluate(el=>{
   const box=el.getBoundingClientRect(),image=el.querySelector('img').getBoundingClientRect();
   return {box:box.width,image:image.width,inset:image.left-box.left};
  });
  expect(geometry).toEqual({box:96,image:80,inset:8});
  await expect(page.locator('.achievement-card summary .achievement-tier-pips')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
}

for(const provider of ['claude','codex'])test(`${provider}: closed cards show short units while full qualifications stay in details`,async({page})=>{
 await (provider==='claude'?openClaude:openCodex)(page,{fixture:'visual-correction-approved',locale:'zh-CN',theme:'dark',width:320});await page.locator('#tab-achievements').click();
 const card=page.locator('[data-achievement-key="fable-days"]');
 await expect(card.locator('summary .achievement-next-target')).not.toContainText('100万');
 await card.locator('summary').click();await expect(card.locator('.achievement-card-detail')).toContainText('100万');
 await expect(page.locator('[data-achievement-key="local-share-export"] summary')).toContainText('已完成');
});
