import {test,expect} from './support/app.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {renderAchievementShareSvg}=require('../../out/achievementShare.js');
const {achievementCopyFor}=require('../../out/i18n.js');
const ids=['claude-api-week-legendary','codex-api-week-legendary','claude-api-total-platinum',
 'codex-api-total-platinum','claude-api-session-gold','codex-api-task-gold','sonnet-main','model-rainbow','root-portfolio-gold'];
for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'])for(const count of [1,3,9]){
 test(`${locale} exported ${count}-badge SVG keeps labels and repository link inside the artifact`,async({page},info)=>{
  const copy=achievementCopyFor(locale);
  const svg=renderAchievementShareSvg({selected:ids.slice(0,count),titles:copy.titles,heading:copy.shareTitle,
   subtitle:copy.intro,groups:copy.groups,levels:copy.levels,milestone:copy.milestone,footer:copy.heading,locale});
  await page.setViewportSize({width:1040,height:1000});
  await page.setContent('<style>body{margin:20px}body>svg{display:block;width:1000px;height:auto}</style>'+svg);
  await expect(page.locator('[data-achievement-share-badge]')).toHaveCount(count);
  const link=page.locator('svg > a');
  await expect(link).toHaveAttribute('href','https://github.com/ClaudeCodeUsage/ClaudeCodeUsage');
  await expect(link).toContainText('https://github.com/ClaudeCodeUsage/ClaudeCodeUsage');
  const failures=await page.locator('body>svg').evaluate(svg=>{
   const failures=[],box=svg.viewBox.baseVal;
   for(const text of svg.querySelectorAll('text')){
    const b=text.getBBox();if(b.x<0||b.y<0||b.x+b.width>box.width+1||b.y+b.height>box.height+1)failures.push('outside SVG: '+text.textContent);
   }
   for(const badge of svg.querySelectorAll('[data-achievement-share-badge]')){
    const frame=badge.querySelector('rect').getBBox(),texts=[...badge.querySelectorAll(':scope>text')];
    for(const [index,text]of texts.entries()){
     const b=text.getBBox();if(b.x+b.width>frame.x+frame.width-7||b.y+b.height>frame.y+frame.height-7)failures.push('outside badge: '+text.textContent);
     if(index&&b.y<texts[index-1].getBBox().y+texts[index-1].getBBox().height+2)failures.push('overlap: '+text.textContent);
    }
   }return failures;
  });
  expect(failures).toEqual([]);
  if(locale==='zh-CN'&&count===9)await page.locator('body>svg').screenshot({path:info.outputPath('share-export-zh-CN-9.png')});
 });
}
