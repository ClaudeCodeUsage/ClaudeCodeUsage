import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {resolve} from 'node:path';
const {renderHarness}=require(resolve(__dirname,'../../tests/ui/support/render-harness.cjs'));
const text=(value:string)=>value.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
function card(html:string,key:string):string{
 const found=html.match(new RegExp('<article\\b[^>]*data-achievement-key="'+key+'"[\\s\\S]*?</article>'));
 assert.ok(found,'missing card '+key);return found[0];
}
function levels(html:string):string[]{return [...html.matchAll(/<li data-achievement-level="[^"]+">[\s\S]*?<\/li>/g)].map(row=>row[0]);}
test('only the next unearned rank is in progress; future ranks retain thresholds without repeated state',async()=>{
 const html=await renderHarness({provider:'claude',locale:'zh-CN',fixture:'achievement-management-history',claudeOnly:true});
 const rows=levels(card(html,'sonnet-main'));
 assert.equal(rows.length,5);
 assert.deepEqual(rows.filter(row=>text(row).includes('进行中')).map(row=>row.match(/data-achievement-level="([^"]+)/)![1]),['sonnet-main-gold']);
 assert.ok(rows.every(row=>row.includes('achievement-level-value')&&row.includes('achievement-level-name')));
 assert.ok(!text(rows[0]).includes('最早可确认日期'));
 assert.ok(text(rows[0]).includes('2026-06-01'));
 assert.ok(text(html).includes('最早可确认日期'));
});
test('fully earned ranks and pending proof never pretend another rank is progressing',async()=>{
 const full=await renderHarness({provider:'claude',locale:'en',fixture:'achievement-management-full',claudeOnly:true});
 assert.ok(!levels(card(full,'sonnet-main')).some(row=>text(row).includes('In progress')));
 const stale=await renderHarness({provider:'codex',locale:'en',fixture:'achievement-proof-stale'});
 const pending=levels(card(stale,'astra-regular'));
 assert.ok(!pending.some(row=>text(row).includes('In progress')));
});
test('first-recorded-only and unknown dates keep their meanings in compact metadata',async()=>{
 const recorded=await renderHarness({provider:'claude',locale:'en',fixture:'achievement-records',claudeOnly:true});
 const exportCard=card(recorded,'local-share-export');
 assert.ok(exportCard.includes('data-date-source="first-recorded"'));
 assert.ok(text(exportCard).includes('First recorded'));
 assert.ok(text(exportCard).includes('2026-07-20'));
 const old=await renderHarness({provider:'claude',locale:'en',fixture:'achievement-history-only',claudeOnly:true});
 assert.ok(card(old,'local-share-export').includes('data-date-source="unknown"'));
 assert.ok(!card(old,'local-share-export').includes('<time'));
});
test('verified date takes visual priority while original first-recorded provenance remains accessible',async()=>{
 const html=await renderHarness({provider:'claude',locale:'zh-CN',fixture:'achievement-management-history-recorded',claudeOnly:true});
 const first=levels(card(html,'sonnet-main'))[0];
 assert.ok(text(first).includes('2026-06-01'));
 assert.ok(!text(first).includes('2026-07-20'));
 assert.equal((first.match(/<time /g)??[]).length,1);
 assert.ok(first.includes('首次记录: 2026-07-20'));
 assert.ok(first.includes('data-date-source="retained-logs"'));
});
