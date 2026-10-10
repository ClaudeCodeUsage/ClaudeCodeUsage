import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {I18n} from '../i18n';
import type {SupportedLanguage} from '../types';
const loader=require('node:module'), original=loader._load;
loader._load=function(name:string,...args:unknown[]) {return name==='vscode'?{}:original.call(this,name,...args);};
let Provider:typeof import('../webview').UsageWebviewProvider;
try {Provider=require('../webview').UsageWebviewProvider;} finally {loader._load=original;}
const START=Date.parse('2026-10-01T00:00:00Z'), WEEK=7*24*60*60_000,T=START+WEEK/4;
const raw=()=>({seven_day:{utilization:29,resets_at:new Date(START+WEEK).toISOString()}});
const pace=():any=>({observedAt:T,source:'observed',accountWindowTrust:'trusted',windows:[
  {slot:0,kind:'weekly_all',periodMs:WEEK,usedPercent:29,resetAt:START+WEEK}]});
function owner() {
  const p:any=Object.create(Provider.prototype), messages:any[]=[], settings:any={showWeeklyQuotaPace:true,usageLimitTracking:true,dashboardAutoRefresh:false};
  Object.assign(p,{settings:{get:(key:string)=>settings[key]},usageLimits:raw(),currentProvider:'claude',dashboardDocumentId:'a'.repeat(48),
    panel:{webview:{postMessage:(m:any)=>{messages.push(m);return Promise.resolve(true);}}},claudeQuotaPaceSnapshot:null});
  return {p,messages,settings};
}
function at(now:number,run:()=>void) {const old=Date.now;Date.now=()=>now;try {run();}finally {Date.now=old;}}
test('real renderer shows original 29/25/116 and a scoped escaped independent row in eight languages',()=>at(T,()=>{
  const old=I18n.getLocale();
  try {for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'] as SupportedLanguage[]) {
    I18n.setLanguage(locale);const {p}=owner();p.updateQuotaPace(pace());
    const html=p.renderWeeklyQuotaPace('claude');assert.match(html,/29%/);assert.match(html,/25%/);assert.match(html,/116%/);
    p.usageLimits={limits:[{kind:'weekly_all',percent:29,resets_at:raw().seven_day.resets_at},
      {kind:'weekly_scoped',percent:40,resets_at:raw().seven_day.resets_at,scope:{model:{display_name:'<script>bad</script>'}}}]};
    const scoped=pace();scoped.windows.push({...scoped.windows[0],slot:1,kind:'weekly_scoped',usedPercent:40});p.updateQuotaPace(scoped);
    const rows=p.renderWeeklyQuotaPace('claude');assert.match(rows,/160%/);assert.match(rows,/&lt;script&gt;bad/);assert.doesNotMatch(rows,/<script>/);
  }}finally {I18n.setLanguage(old as SupportedLanguage);}
}));
test('existing callbacks withdraw stale/reset/credential forecasts with dashboard auto-refresh paused',()=>{
  const {p,messages}=owner();at(T,()=>p.updateQuotaPace(pace()));assert.match(messages[messages.length-1].html,/116%/);
  const count=messages.length;at(T+20*60_000,()=>p.updateQuotaPace(pace()));assert.equal(messages.length,count,'same original observation does not repaint');
  at(T+30*60_000+1,()=>p.updateQuotaPace(pace()));assert.doesNotMatch(messages[messages.length-1].html,/116%/);
  assert.equal(messages[messages.length-1].command,'weeklyQuotaPace');assert.equal(messages[messages.length-1].documentId,'a'.repeat(48));
  at(START+WEEK,()=>p.updateQuotaPace(pace()));assert.doesNotMatch(p.renderWeeklyQuotaPace('claude'),/116%/);
  at(T,()=>p.updateQuotaPace(pace()));p.updateQuotaPace(null);assert.doesNotMatch(messages[messages.length-1].html,/116%/);
});
test('OFF/tracking OFF do not read clock or supplied snapshot and withdraw without another timer',()=>{
  for(const key of ['showWeeklyQuotaPace','usageLimitTracking']) {
    const {p,settings,messages}=owner();at(T,()=>p.updateQuotaPace(pace()));settings[key]=false;
    const bad=new Proxy({}, {get:()=>assert.fail('OFF snapshot access')});const old=Date.now;Date.now=()=>assert.fail('OFF clock access');
    try {p.updateQuotaPace(bad);assert.equal(p.renderWeeklyQuotaPace('claude'),'');assert.equal(messages[messages.length-1].html,'');assert.equal(p.claudeQuotaPaceSnapshot,null);}
    finally {Date.now=old;}
  }
});
test('early sample has no forecast, mismatched raw percentages have no authority, and Codex account stays unknown',()=>{
  const {p}=owner();const early=pace();early.observedAt=START+60*60_000;at(early.observedAt,()=>{
    p.updateQuotaPace(early);const html=p.renderWeeklyQuotaPace('claude');assert.match(html,/1%/);assert.doesNotMatch(html,/116%|4872%/);
  });at(T,()=>{
    const bad=pace();bad.windows[0].usedPercent=40;p.updateQuotaPace(bad);assert.doesNotMatch(p.renderWeeklyQuotaPace('claude'),/160%/);
    p.codexView={limit:{provider:'codex',source:'local-log',confidence:'last-observed',observedAt:T,
      windows:[{windowMinutes:10080,usedPercent:29,resetsAt:START+WEEK}]}};
    assert.doesNotMatch(p.renderWeeklyQuotaPace('codex'),/116%/);
  });
});
test('normalizer fallback zeros and unknown weekly kinds cannot be forecast observations',()=>at(T,()=>{
  const {p}=owner();const zero=pace();zero.windows[0].usedPercent=0;
  for(const invalid of [NaN,null,undefined,'0']) {
    p.usageLimits={seven_day:{utilization:invalid,resets_at:raw().seven_day.resets_at}};
    p.updateQuotaPace(zero);assert.doesNotMatch(p.renderWeeklyQuotaPace('claude'),/Estimated at reset/);
  }
  p.usageLimits={limits:[{kind:'unknown_future_kind',group:'weekly',percent:0,
    resets_at:raw().seven_day.resets_at,scope:{surface:'Mystery'}}]};
  zero.windows[0].kind='weekly_scoped';p.updateQuotaPace(zero);
  assert.doesNotMatch(p.renderWeeklyQuotaPace('claude'),/Estimated at reset/);
}));
