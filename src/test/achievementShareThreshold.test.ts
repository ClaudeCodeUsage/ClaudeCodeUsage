import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {renderAchievementShareSvg} from '../achievementShare';
import {ACHIEVEMENT_COPY} from '../i18n';
import {achievementMoneyCopyFor} from '../achievementMoneyCopy';
import type {AchievementId} from '../achievements';

const locales=['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'] as const;
function render(locale:typeof locales[number],id:AchievementId):string {
 const copy=ACHIEVEMENT_COPY[locale];
 return renderAchievementShareSvg({selected:[id],titles:copy.titles,heading:copy.shareTitle,subtitle:copy.intro,
  groups:copy.groups,levels:copy.levels,milestone:copy.milestone,footer:copy.heading,locale});
}
function visibleThreshold(svg:string):string {
 const field=/<text\b[^>]*data-share-field="threshold"[^>]*>([\s\S]*?)<\/text>/.exec(svg);
 assert.ok(field,'public target and unit must be visible SVG text, not only a title');
 return field[1].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&apos;/g,"'")
  .replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,'');
}
for(const locale of locales){
 for(const [id,target,unit]of [
  ['opus-cannon',100_000_000,'tokens'],
  ['haiku-worker-silver',100_000_000,'tokens'],
  ['claude-output-silver',20_000_000,'outputTokens'],
  ['active-days-legendary',1500,'days'],
  ['output-hours-bronze',12,'hours'],
 ] as const)test(`${locale} ${id}: exported visible threshold retains exact target and semantic unit`,()=>{
  const expected='≥'+target.toLocaleString(locale,{maximumFractionDigits:0})+' '+ACHIEVEMENT_COPY[locale].units[unit];
  assert.equal(visibleThreshold(render(locale,id)),expected.replace(/\s+/g,''));
 });
}
test('successful local export milestone preserves its public condition without fabricating a usage value',()=>{
 assert.equal(visibleThreshold(render('zh-CN','local-share-export')),'≥1'+ACHIEVEMENT_COPY['zh-CN'].units.exports.replace(/\s+/g,''));
});
test('money targets remain visible once in their existing rank line',()=>{
 const svg=render('zh-CN','codex-api-total-platinum');
 assert.match(svg,/<text\b[^>]*data-share-field="rank"[^>]*>[\s\S]*?≥\$100,000 USD[\s\S]*?<\/text>/);
 assert.doesNotMatch(svg,/data-share-field="threshold"/);
});

for(const locale of locales)test(`${locale} money export shows the existing estimate boundary as visible footer text`,()=>{
 const svg=render(locale,'codex-api-total-platinum');
 const note=/<text\b[^>]*data-share-field="money-note"[^>]*>([\s\S]*?)<\/text>/.exec(svg);
 assert.ok(note,'estimate qualification must be visible in the exported SVG');
 assert.equal(note[1].replace(/<[^>]*>/g,'').replace(/\s+/g,''),achievementMoneyCopyFor(locale).note.replace(/\s+/g,''));
 assert.doesNotMatch(render(locale,'opus-cannon'),/data-share-field="money-note"/);
});
