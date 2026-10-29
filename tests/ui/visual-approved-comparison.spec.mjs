import {test,expect,openClaude,openCodex} from './support/app.mjs';
import {createRequire} from 'node:module';
import AxeBuilder from '@axe-core/playwright';
const require=createRequire(import.meta.url);
const {renderAchievementShareSvg}=require('../../out/achievementShare.js');
const {achievementCopyFor}=require('../../out/i18n.js');
const {ACHIEVEMENT_EXPORT_RANK_COLORS}=require('../../out/achievementAdornment.js');
const earned=[['cumulative-volume','gold','ten-billion-token-club'],['codex-api-total','platinum','codex-api-total-platinum'],
 ['codex-api-week','legendary','codex-api-week-legendary'],['claude-api-total','gold','claude-api-total-gold'],
 ['claude-api-session','silver','claude-api-session-silver'],['codex-api-task','gold','codex-api-task-gold'],
 ['active-days','platinum','active-days-platinum'],['settings-explorer','bronze','settings-explorer-bronze'],
 ['local-share-export','milestone','local-share-export']];
for(const provider of ['claude','codex'])for(const width of [320,960])test(`${provider}: approved comparison facts at ${width}px`,async({page},info)=>{
 await (provider==='claude'?openClaude:openCodex)(page,{fixture:'visual-correction-approved',locale:'zh-CN',theme:'dark',width,height:1000});
 await page.locator('#tab-achievements').click();await page.locator('#achievementSize').selectOption('medium');
 await expect.soft(page.locator('.achievement-grid'),'approved gallery uses one continuous grid').toHaveCount(1);
 for(const [key,rank,id]of earned){
  const card=page.locator(`[data-achievement-key="${key}"]`);
  await expect(card).toHaveAttribute('data-achievement-earned','true');
  await expect(card.locator('summary .achievement-framed-icon')).toHaveAttribute('data-achievement-frame',rank);
  await expect(card.locator('summary img')).toHaveAttribute('data-achievement-icon',id);
  await card.scrollIntoViewIfNeeded();await expect.poll(()=>card.locator('summary img').evaluate(im=>im.complete&&im.naturalWidth>0)).toBe(true);
  const geometry=await card.locator('summary .achievement-framed-icon').evaluate(el=>{const box=el.getBoundingClientRect(),art=el.querySelector('img').getBoundingClientRect();return {art:art.width,total:box.width,inset:art.left-box.left}});
  expect(geometry).toEqual({art:80,total:96,inset:8});
  await card.screenshot({path:info.outputPath(`${provider}-${width}-${key}.png`)});
 }
 for(const key of ['weekly-volume','claude-api-week'])await expect(page.locator(`[data-achievement-key="${key}"]`)).toHaveAttribute('data-achievement-proof','pending');
 const locked=page.locator('[data-achievement-key="output-hours"]');await expect(locked).toHaveAttribute('data-achievement-earned','false');
 await expect(locked.locator('summary')).toContainText('3');await expect(locked.locator('summary')).toContainText('12');
 await expect.soft(page.locator('[data-achievement-key="active-days"] .achievement-stage-target')).toContainText('1,500');
 const milestoneColors=await page.locator('[data-achievement-key="local-share-export"]').evaluate(card=>({rank:getComputedStyle(card.querySelector('.achievement-rank')).color,neutral:getComputedStyle(card).color}));
 expect.soft(milestoneColors.rank).toBe(milestoneColors.neutral);
 const legacyVisible=(await page.locator('[data-achievement-key="codex-api-week"] summary').innerText()).includes('旧自然周规则');
 await expect(page.locator('[data-achievement-key="cumulative-volume"] summary')).toContainText('15B');
 await expect(page.locator('[data-achievement-key="codex-api-total"] summary')).toContainText('$120,000');
 const overview=page.locator('.achievement-showcase');await overview.scrollIntoViewIfNeeded();await overview.screenshot({path:info.outputPath(`overview-${provider}-${width}.png`)});
 await page.locator('#achievementFilter').selectOption('earned');
 await expect(page.locator('.achievement-card:visible')).toHaveCount(9);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('.achievement-collection').screenshot({path:info.outputPath(`earned-gallery-${provider}-${width}.png`)});
 if(provider==='claude'&&width===960){
  const copy=achievementCopyFor('zh-CN');
  for(const count of [1,3,9]){
   const selected=earned.slice(0,count).map(row=>row[2]);
   const svg=renderAchievementShareSvg({selected,retainedCalendarIds:['codex-api-week-legendary'],titles:copy.titles,heading:copy.shareTitle,
    subtitle:copy.intro,groups:copy.groups,levels:copy.levels,milestone:copy.milestone,footer:copy.heading,locale:'zh-CN'});
   await page.setViewportSize({width:1000,height:1000});await page.setContent('<style>body{margin:0}body>svg{display:block;width:1000px;height:auto}</style>'+svg);
   await expect(page.locator('[data-achievement-share-badge]')).toHaveCount(count);
   if(count===9)await expect.soft(page.locator('[data-achievement-share-badge="local-share-export"] [data-share-field="rank"]')).toHaveAttribute('fill',ACHIEVEMENT_EXPORT_RANK_COLORS.milestone);
   await page.locator('body>svg').screenshot({path:info.outputPath(`approved-share-${count}.png`)});
  }
 }
 expect.soft(legacyVisible,'retained qualification stays visible on the closed card').toBe(true);
});

for(const theme of ['dark','light'])test(`${theme}: all earned rank labels have readable contrast`,async({page})=>{
 await openClaude(page,{fixture:'visual-correction-approved',locale:'zh-CN',theme,width:960});
 await page.locator('#tab-achievements').click();await page.locator('#achievementFilter').selectOption('earned');
 const results=await new AxeBuilder({page}).include('.achievement-card.earned .achievement-rank').withRules(['color-contrast']).analyze();
 expect(results.violations).toEqual([]);
});
