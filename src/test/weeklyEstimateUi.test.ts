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
