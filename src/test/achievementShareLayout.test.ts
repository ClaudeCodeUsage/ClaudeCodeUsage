import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {renderAchievementShareSvg} from '../achievementShare';
import {ACHIEVEMENT_COPY} from '../i18n';

const ids=['claude-api-week-legendary','codex-api-week-legendary','claude-api-total-platinum',
 'codex-api-total-platinum','claude-api-session-gold','codex-api-task-gold','sonnet-main','model-rainbow','root-portfolio-gold'] as const;
const copy=ACHIEVEMENT_COPY['zh-CN'];
function render(count:number){return renderAchievementShareSvg({selected:ids.slice(0,count),titles:copy.titles,
 heading:copy.shareTitle,subtitle:copy.intro,groups:copy.groups,levels:copy.levels,milestone:copy.milestone,footer:copy.heading,locale:'zh-CN'});}
function number(attributes:string,name:string):number{return Number(new RegExp('\\b'+name+'="([^"]+)"').exec(attributes)?.[1]);}
for(let count=0;count<=9;count++) test(`${count} share badges center each row and preserve prominent artwork before labels`,()=>{
 const svg=render(count),cells=[...svg.matchAll(/<g data-achievement-share-badge="[^"]+">([\s\S]*?)<\/g>/g)].map(m=>m[1]);
 assert.equal(cells.length,count);
 const expectedArt=count===1?112:count<=3?96:80;
 const layouts=cells.map(cell=>{
  const frame=/<rect\b([^>]+)data-share-card-frame="neutral"/.exec(cell)![1];
  const x=number(frame,'x'),y=number(frame,'y'),width=number(frame,'width');
  const icon=/<svg\b([^>]+data-achievement-icon[^>]+)>/.exec(cell)![1];
  const image=/<image\b([^>]+)>/.exec(cell)![1];
  const imageWidth=number(image,'width'),imageHeight=number(image,'height');
  assert.equal(imageWidth,expectedArt);assert.equal(imageHeight,expectedArt);
  const iconX=number(icon,'x'),iconY=number(icon,'y'),iconWidth=number(icon,'width'),iconHeight=number(icon,'height');
  assert.equal(iconX+iconWidth/2,x+width/2,'artwork centered in card');
  const text=[...cell.matchAll(/<text\b([^>]*)>/g)];
  assert.ok(text.length>=3);
  for(const [,attr]of text){assert.equal(number(attr,'x'),x+width/2);assert.match(attr,/text-anchor="middle"/);}
  assert.ok(number(text[0][1],'y')-16>=iconY+iconHeight+6,'name below artwork');
  assert.ok(iconY>=y+12);
  return {x,y,width};
 });
 for(const y of new Set(layouts.map(cell=>cell.y))){
  const row=layouts.filter(cell=>cell.y===y);const left=Math.min(...row.map(cell=>cell.x)),right=Math.max(...row.map(cell=>cell.x+cell.width));
  assert.equal((left+right)/2,500,'last row centers in 1000-unit canvas');
 }
});
