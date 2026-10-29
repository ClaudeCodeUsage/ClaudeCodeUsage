import {test,expect} from './support/app.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {renderAchievementShareSvg}=require('../../out/achievementShare.js');
const {achievementCopyFor}=require('../../out/i18n.js');
const ids=['claude-api-week-legendary','codex-api-week-legendary','claude-api-total-platinum',
 'codex-api-total-platinum','claude-api-session-gold','codex-api-task-gold','sonnet-main','model-rainbow','root-portfolio-gold'];
for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'])for(const count of [0,1,2,3,4,5,6,7,8,9]){
 test(`${locale} exported ${count}-badge SVG keeps labels and repository link inside the artifact`,async({page},info)=>{
  const copy=achievementCopyFor(locale);
  const svg=renderAchievementShareSvg({selected:ids.slice(0,count),titles:copy.titles,heading:copy.shareTitle,
   subtitle:copy.intro,groups:copy.groups,levels:copy.levels,milestone:copy.milestone,footer:copy.heading,locale});
  await page.setViewportSize({width:1040,height:1000});
  await page.setContent('<style>body{margin:20px}body>svg{display:block;width:1000px;height:auto}</style>'+svg);
  await expect(page.locator('[data-achievement-share-badge]')).toHaveCount(count);
  const expectedArt=count===1?112:count<=3?96:80;
  for(const badge of await page.locator('[data-achievement-share-badge]').all()){
    const geometry=await badge.evaluate(node=>{
      const card=node.querySelector('[data-share-card-frame]').getBBox(),icon=node.querySelector('svg'),art=icon.querySelector('image').getBoundingClientRect();
      const box=icon.getBoundingClientRect(),name=node.querySelector('[data-share-field="name"]').getBoundingClientRect();
      return {artWidth:art.width,artHeight:art.height,clear:name.top>=box.bottom+5,centered:Math.abs(Number(icon.getAttribute('x'))+Number(icon.getAttribute('width'))/2-(card.x+card.width/2))<.5};
    });
    expect(geometry).toEqual({artWidth:expectedArt,artHeight:expectedArt,clear:true,centered:true});
  }
  const centeredRows=await page.locator('body>svg').evaluate(svg=>{
    const rows=new Map();
    for(const node of svg.querySelectorAll('[data-share-card-frame]')){
      const box=node.getBBox(),key=box.y;rows.set(key,[...(rows.get(key)||[]),box]);
    }
    return [...rows.values()].every(row=>Math.abs((Math.min(...row.map(b=>b.x))+Math.max(...row.map(b=>b.x+b.width)))/2-500)<.5);
  });
  expect(centeredRows).toBe(true);
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
  if(locale==='zh-CN'&&[1,3,9].includes(count))await page.locator('body>svg').screenshot({path:info.outputPath(`share-export-zh-CN-${count}.png`)});
 });
}

const nonMoneyCases={
 actualThree:['opus-cannon','haiku-worker-silver','claude-output-silver'],
 longNine:['opus-cannon','haiku-worker-silver','claude-output-silver','active-days-legendary','output-hours-bronze',
  'sol-days-silver','active-weeks-legendary','three-family-day','local-share-export'],
};
for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'])for(const [sample,selected]of Object.entries(nonMoneyCases)){
 test(`${locale} ${sample}: public nonmoney thresholds fit without reducing artwork`,async({page},info)=>{
  const copy=achievementCopyFor(locale);
  const svg=renderAchievementShareSvg({selected,titles:copy.titles,heading:copy.shareTitle,subtitle:copy.intro,
   groups:copy.groups,levels:copy.levels,milestone:copy.milestone,footer:copy.heading,locale});
  await page.setViewportSize({width:1040,height:1000});
  await page.setContent('<style>body{margin:20px}body>svg{display:block;width:1000px;height:auto}</style>'+svg);
  await expect(page.locator('[data-share-field="threshold"]')).toHaveCount(selected.length);
  const checks=await page.locator('body>svg').evaluate(root=>{
   const canvas=root.viewBox.baseVal,errors=[],sizes=[];
   for(const badge of root.querySelectorAll('[data-achievement-share-badge]')){
    const frame=badge.querySelector('[data-share-card-frame]').getBBox();
    const text=[...badge.querySelectorAll(':scope>text')];
    for(const [i,node]of text.entries()){
     const b=node.getBBox();
     if(b.x<frame.x+7||b.x+b.width>frame.x+frame.width-7||b.y<frame.y||b.y+b.height>frame.y+frame.height-7)errors.push('card bounds:'+node.textContent);
     if(i&&b.y<text[i-1].getBBox().y+text[i-1].getBBox().height+2)errors.push('overlap:'+node.textContent);
     if(b.y+b.height>canvas.height)errors.push('canvas bounds:'+node.textContent);
    }
    const image=badge.querySelector('image').getBoundingClientRect();sizes.push([image.width,image.height]);
   }
   return {errors,sizes};
  });
  expect(checks.errors).toEqual([]);
  expect(checks.sizes.every(([w,h])=>w===(selected.length===3?96:80)&&h===w)).toBe(true);
  if(locale==='zh-CN'){
   await page.locator('body>svg').screenshot({path:info.outputPath(`share-nonmoney-${sample}.png`)});
   await (await import('node:fs/promises')).writeFile(info.outputPath(`share-nonmoney-${sample}.svg`),svg);
  }
 });
}
