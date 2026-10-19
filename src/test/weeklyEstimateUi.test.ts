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
  p.weeklyValueInputs=()=>({observations:[{provider:'codex',seriesKey:'raw-private-id',observedAt:T,resetAt:R,usedPercent:40}],
    usage:[{timestamp:T-1000,equivalentUsd:40,pricedTokens:100,totalTokens:100}]});
  return p;
}
test('real estimate renderer separates observed sample/reference values and never exposes identities in eight locales',()=>{
  const old=I18n.getCurrentLanguage(),clock=Date.now;Date.now=()=>T+1;
  try{for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'] as SupportedLanguage[]){
    I18n.setLanguage(locale);const html=owner().renderWeeklyEstimateRecords('codex');
    assert.ok(html.includes(I18n.t.weeklyValue.estimateDetails));
    assert.ok(html.includes(I18n.t.weeklyValue.roughEstimate));
    assert.ok(html.includes(I18n.t.weeklyValue.reconstructedEstimate));
    assert.match(html,/data-persist="weekly-estimate-codex"/);
    assert.doesNotMatch(html,/raw-private-id|accountScopeKey|sourceKey/);
    assert.match(html,/100/);assert.match(html,/60/);
  }}finally{Date.now=clock;I18n.setLanguage(old);}
});
test('unavailable archive has a visible unsaved notice while keeping this render independently readable',()=>{
  I18n.setLanguage('en');const p=owner();
  p.weeklyEstimateProjector=()=>({entries:[],status:'unavailable'});
  const html=p.renderWeeklyEstimateRecords('codex');
  assert.ok(html.includes(I18n.t.weeklyValue.archiveUnavailable));
  assert.match(html,/role="status"/);
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
    assert.ok(records.includes(I18n.formatCurrency(100)));
    assert.ok(records.includes(I18n.formatCurrency(75)));assert.doesNotMatch(records,/≈/);
    assert.ok(records.includes(I18n.t.weeklyValue.roughEstimate));
    assert.ok(records.includes(I18n.t.weeklyValue.inferredUsed));
    assert.ok(records.includes(I18n.t.weeklyValue.estimateUsed));
    assert.match(html, /class="composition-chart" data-weekly-estimate-chart/);
    assert.match(html,/<div class="stack-seg seg-input" style="height:30\.00px">/);
    assert.match(html,/<div class="stack-seg seg-cache-read" style="height:90\.00px">/);
    assert.match(html,/role="img"/);assert.match(html,/aria-label=/);
    assert.doesNotMatch(records,/\.000Z/,'system timezone must use localized date formatting, not ISO exception fallback');
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
      const bars = [...html.matchAll(/class="stack-bar" role="img" aria-label="([^"]*)"/g)];
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
      assert.equal([...table.matchAll(/<tr>/g)].length, 5, 'four selected values plus one unusable audit observation');
      assert.ok(table.includes(Reflect.get(copy, 'fallbackCycle')));
      for (const amount of [127, 155, 183, 195, 40, 17]) assert.ok(table.includes(I18n.formatCurrency(amount)));
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
