import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';
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

test('partial pricing and index coverage still show approximate total/unused in both existing tables without stacking old unused on live usage',()=>{
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
    const history=html.split('<details class="weekly-value-details">')[1].split('</details>')[0];
    assert.ok(history.includes('≈'+I18n.formatCurrency(100)));
    assert.ok(history.includes('≈'+I18n.formatCurrency(75)));
    assert.ok(history.includes(I18n.formatCurrency(400)),'live used subtotal remains separate');
    const records=html.split('<details class="weekly-estimate-details"')[1];
    assert.ok(records.includes('≈'+I18n.formatCurrency(100)));
    assert.ok(records.includes('≈'+I18n.formatCurrency(75)));
    assert.ok(records.includes(I18n.t.weeklyValue.roughEstimate));
    assert.ok(!html.includes('<div class="stack-seg seg-cache-read"'),'as-of unused is not stacked on current usage');
    assert.doesNotMatch(records,/\.000Z/,'system timezone must use localized date formatting, not ISO exception fallback');
  }finally{Date.now=clock;I18n.setLanguage(old);}
});
