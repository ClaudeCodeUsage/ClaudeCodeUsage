import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
const loader=require('node:module'),original=loader._load;
loader._load=function(name:string,...args:unknown[]){return name==='vscode'?{}:original.call(this,name,...args);};
let Provider:typeof import('../webview').UsageWebviewProvider;
try{Provider=require('../webview').UsageWebviewProvider;}finally{loader._load=original;}
const R=Date.parse('2026-10-26T12:00:00Z'),T=R-86_400_000;
function owner():any{
  const p:any=Object.create(Provider.prototype);
  p.setting=(_key:string,fallback:unknown)=>fallback;
  p.weeklyValueInputs=()=>({observations:[{provider:'codex',seriesKey:'raw-private-id',observedAt:T,resetAt:R,usedPercent:40}],
    usage:[{timestamp:T-1000,equivalentUsd:40,pricedTokens:100,totalTokens:100}]});
  return p;
}
test('real estimate renderer separates observed sample/reference values and never exposes identities in eight locales',()=>{
  const old=I18n.getCurrentLanguage(),clock=Date.now;Date.now=()=>T+1;
  try{for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'] as SupportedLanguage[]){
    I18n.setLanguage(locale);const html=owner().renderWeeklyEstimateRecords('codex');
    assert.ok(html.includes('<summary>'+I18n.t.weeklyValue.cycleSummary+'</summary>'));
    assert.ok(html.includes(I18n.t.weeklyValue.roughEstimate));
    // Reconstruction's scope is disclosed by the shared note; it no longer
    // occupies another sample/method row in the seven-column summary table.
    assert.ok(html.includes(I18n.t.weeklyValue.estimateNote));
    assert.ok(html.includes(I18n.t.weeklyValue.calibrationEvidence));
    assert.equal((html.match(/<th>/g)??[]).length,7);
    assert.equal((html.match(/<tr data-codex-cycle-summary-row>/g)??[]).length,1);
    assert.match(html,/<details data-cycle-evidence data-persist="[^"]+">/);
    assert.match(html,/data-persist="weekly-estimate-codex"/);
    assert.doesNotMatch(html,/raw-private-id|accountScopeKey|sourceKey/);
    for(const amount of [100,40,60]) assert.ok(html.includes(I18n.formatCurrency(amount).replace(/^≈/,'')));
  }}finally{Date.now=clock;I18n.setLanguage(old);}
});
test('unavailable archive has a visible unsaved notice while keeping this render independently readable',()=>{
  const old=I18n.getCurrentLanguage(),clock=Date.now;Date.now=()=>T+1;
  try{
    I18n.setLanguage('en');const p=owner(),live=p.weeklyEstimateProjection('codex');
    p.weeklyEstimateProjector=()=>({...live,status:'unavailable'});
    // Archive state is now owned by the enclosing cycle panel, while the
    // seven-column table still presents this render's independently usable fit.
    const html=p.renderWeeklyValuePanel('codex');
    assert.ok(html.includes(I18n.t.weeklyValue.archiveUnavailable));
    assert.match(html,/role="status"/);
    assert.match(html,/<td class="cost-cell">\$100\.00<\/td>/);
    assert.match(html,/<td class="cost-cell">\$60\.00<\/td>/);
    assert.match(html,/<details data-cycle-evidence data-persist=/);
    assert.doesNotMatch(html,/raw-private-id|accountScopeKey|sourceKey/);
  }finally{Date.now=clock;I18n.setLanguage(old);}
});
test('converted weekly table cells omit the approximation sign without changing the global currency formatter',()=>{
  const currency=I18n.getCurrencyDisplay().code,clock=Date.now;Date.now=()=>T+1;
  try{
    I18n.setCurrencyDisplay('EUR');
    const html=owner().renderWeeklyEstimateRecords('codex'),body=html.split('<tbody>')[1].split('</tbody>')[0];
    assert.match(body,/EUR/);assert.doesNotMatch(body,/≈/);
    assert.match(I18n.formatCurrency(100),/^≈EUR /);
  }finally{Date.now=clock;I18n.setCurrencyDisplay(currency);}
});

test('estimated headers replace per-cell approximation signs and graph stacks same-observation components',()=>{
  const old=I18n.getCurrentLanguage(),clock=Date.now;Date.now=()=>T+1;
  try{
    I18n.setLanguage('en');const p=owner();
    p.weeklyValueInputs=()=>({observations:[{provider:'codex',seriesKey:'unknown',observedAt:T,resetAt:R,usedPercent:25}],
      usage:[{timestamp:T-1000,equivalentUsd:25,pricedTokens:92,totalTokens:100}],localHistoryComplete:false});
    p.weeklyValuePoints=()=>[{provider:'codex',seriesKey:'unknown',windowStart:R-7*86_400_000,resetAt:R,
      current:true,usedEquivalentUsd:400,fullEquivalentUsd:null,unusedEquivalentUsd:null,utilizationPercent:25,
      observedAt:T,pricingCoverage:.92,observationGapMs:1,confidence:'usage-only',basis:'reset-aligned-usage'}];
    p.setting=(_name:string,fallback:unknown)=>fallback;
    p.codexView={periodCoverage:{allTime:{complete:false}}};
    const html=p.renderWeeklyValuePanel('codex');
    assert.doesNotMatch(html,/weekly-value-details|weekly-actual-chart/);
    const records=html.split('<details class="weekly-estimate-details"')[1];
    // The original 92%-priced, incomplete fixture now withholds capacity. Its
    // $25 sample remains auditable, rather than promoting $100/$75 capacity.
    assert.equal((records.match(/<td class="cost-cell">—<\/td>/g)??[]).length,3);
    assert.ok(records.includes('<dd>$25.00</dd>'));
    assert.ok(records.includes(I18n.t.weeklyValue.evidenceIncomplete));
    assert.ok(html.includes(I18n.t.weeklyValue.cycleIndexedSubtotal));
    assert.ok(records.includes(I18n.t.weeklyValue.estimatePartialPricing));
    assert.match(html,/data-cycle-pending role="img"/);
    assert.doesNotMatch(html,/class="stack-bar"|class="stack-seg/);
    assert.doesNotMatch(records,/≈/);
    assert.ok(records.includes(I18n.t.weeklyValue.inferredUsed));
    assert.ok(records.includes(I18n.t.weeklyValue.estimateUsed));
    assert.match(html, /class="composition-chart"[^>]* data-weekly-estimate-chart/);
    assert.match(html,/role="img"/);assert.match(html,/aria-label=/);
    assert.doesNotMatch(records,/\.000Z/,'system timezone must use localized date formatting, not ISO exception fallback');
    // Preserve the original monetary stack arithmetic for admissible evidence.
    p.weeklyValueInputs=()=>({observations:[{provider:'codex',seriesKey:'unknown',observedAt:T,resetAt:R,usedPercent:25}],
      usage:[{timestamp:T-1000,equivalentUsd:25,pricedTokens:100,totalTokens:100}],localHistoryComplete:true});
    p.codexView.periodCoverage.allTime.complete=true;
    const priced=p.renderWeeklyValuePanel('codex'),pricedRecords=priced.split('<tbody>')[1].split('</tbody>')[0];
    assert.ok(pricedRecords.includes('$100.00'));assert.ok(pricedRecords.includes('$75.00'));
    assert.ok(pricedRecords.includes(I18n.t.weeklyValue.roughEstimate));
    assert.doesNotMatch(pricedRecords,/≈/);
    assert.match(priced,/<div class="stack-seg seg-input" style="height:30\.00px">/);
    assert.match(priced,/<div class="stack-seg seg-cache-read" style="height:90\.00px">/);
    assert.doesNotMatch(priced,/weekly-value-details|weekly-actual-chart/);
  }finally{Date.now=clock;I18n.setLanguage(old);}
});

test('24 days of legacy daily resets render four seven-day reference bars with UTC bounds and original reset evidence', () => {
  const old = I18n.getCurrentLanguage(), timezone = I18n.getTimezone(), clock = Date.now;
  Date.now = () => Date.parse('2026-07-20T12:00:00Z');
  const fixture = require('../../tests/ui/support/weekly-cycle-fixture.cjs').weeklyReferenceFixture({}, Date.now());
  const originalAmounts = fixture.raw.map((entry: LocalWeeklyEstimate) =>
    [entry.fullEquivalentUsd, entry.unusedEquivalentUsd, entry.usedEquivalentUsd, entry.resetAt]);
  try {
    I18n.setTimezone('Pacific/Honolulu');
    for (const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'] as SupportedLanguage[]) {
      I18n.setLanguage(locale);
      const p = owner(); p.weeklyValuePoints = () => [];
      p.setting = (_name: string, fallback: unknown) => fallback;
      p.weeklyEstimateProjector = fixture.projector();
      const html = p.renderWeeklyValuePanel('codex');
      const bars = [...html.matchAll(/class="stack-bar" role="img"[^>]*aria-label="([^"]*)"/g)];
      assert.equal(bars.length, 4, 'daily reset changes collapse to four stable UTC weeks');
      const copy = I18n.t.weeklyValue;
      for (const [, title] of bars) {
        assert.ok(title.includes(Reflect.get(copy, 'fallbackCycle')));
        assert.ok(title.includes(Reflect.get(copy, 'fallbackObservedReset')));
        assert.ok(title.includes('UTC'));
        assert.ok(!title.includes(copy.cycleBoundaryUncertain), 'synthetic buckets do not assert a reset within bounds');
        assert.ok(!title.includes(copy.scheduledReset), 'original reset is observation evidence, not the bucket end');
      }
      const labels = [...html.matchAll(/class="hc-xlabel"[^>]*><span>([^<]*)<\/span><span>([^<]*)<\/span>/g)];
      assert.equal(labels.length, 4);
      // Axis dates follow the display timezone, while tooltip bounds stay UTC.
      assert.deepEqual(labels.map(row => row[1]), ['6/28', '7/5', '7/12', '7/19']);
      assert.deepEqual(labels.map(row => row[2]), Array(4).fill(Reflect.get(copy, 'fallbackCycleShort')));
      const table = html.split('<tbody>')[1].split('</tbody>')[0];
      // A newer unusable observation remains subordinate to eligible evidence;
      // it no longer creates a fifth raw-sample row outside the four periods.
      assert.equal([...table.matchAll(/<tr data-codex-cycle-summary-row>/g)].length, 4);
      assert.equal([...table.matchAll(/<details data-cycle-evidence data-persist=/g)].length,4);
      assert.ok(table.includes(Reflect.get(copy, 'fallbackCycle')));
      for (const amount of [127, 155, 183, 195, 40, 17]) assert.ok(table.includes(I18n.formatCurrency(amount).replace(/^≈/,'')));
      if (locale === 'en') {
        assert.match(bars[0][1], /Jun 22, 2026, 00:00 – Jun 29, 2026, 00:00 UTC/);
        assert.match(bars[3][1], /Jul 13, 2026, 00:00 – Jul 20, 2026, 00:00 UTC/);
        const reset = new Intl.DateTimeFormat(I18n.getLocale(), { year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Honolulu' }).format(new Date(fixture.raw[95].resetAt));
        assert.ok(bars[3][1].includes('Observed reset: ' + reset));
      }
    }
    assert.deepEqual(fixture.raw.map((entry: LocalWeeklyEstimate) =>
      [entry.fullEquivalentUsd, entry.unusedEquivalentUsd, entry.usedEquivalentUsd, entry.resetAt]), originalAmounts);
  } finally { Date.now = clock; I18n.setLanguage(old); I18n.setTimezone(timezone); }
});
