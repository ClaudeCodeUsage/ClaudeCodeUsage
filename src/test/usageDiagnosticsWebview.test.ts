import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import {I18n} from '../i18n';
function provider():any { const load=(Module as any)._load;(Module as any)._load=function(name:string,...args:any[]){return name==='vscode'?{workspace:{workspaceFolders:[]}}:load.call(this,name,...args);};try{const Type=require('../webview').UsageWebviewProvider;const value=Object.create(Type.prototype);value.setting=()=>false;return value;}finally{(Module as any)._load=load;} }
test('disabled diagnostics never touch providers or logs',()=>{const p=provider();for(const key of ['codexView','dailyDataForEveryDay','allRecords'])Object.defineProperty(p,key,{get(){throw Error('unexpected source access');}});assert.equal(p.renderUsageDiagnostics('codex'),'');});
test('enabled renderer keeps numeric-only cache, bounded disclosure and missing evidence visible',()=>{const p=provider();p.setting=(key:string)=>key==='showUsageThroughput'||key==='showUsageChange';let calls=0;p.codexView={periodCoverage:{timeZone:require('../dateKeys').resolveTimeZone(I18n.getTimezone()),asOfDay:'2026-10-23'},diagnosticDays:()=>{calls++;return []}};const first=p.renderUsageDiagnostics('codex');assert.match(first,/TPS/);assert.match(first,/data-usage-diagnostics/);assert.equal((first.match(/data-diagnostic="(?:change|throughput)"/g)??[]).length,2);assert.doesNotMatch(first,/data-diagnostic="quota"/);assert.equal(p.renderUsageDiagnostics('codex'),first);assert.equal(calls,1);p.setting=()=>false;assert.equal(p.renderUsageDiagnostics('codex'),'');p.setting=()=>true;p.renderUsageDiagnostics('codex');assert.equal(calls,2);});
test('all eight locales provide diagnostic copy and two default-off setting labels',()=>{const original=I18n.getCurrentLanguage();try{for(const lang of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'] as const){I18n.setLanguage(lang);assert.ok(I18n.usageDiagnostics.title);for(const key of ['showUsageThroughput','showUsageChange'])assert.ok(I18n.settingText(key).label);}}finally{I18n.setLanguage(original);}});

test('retained equal display object invalidates diagnostic HTML when its hidden source changes',()=>{
 const p=provider();p.setting=(key:string)=>key==='showUsageThroughput';let reads=0;
 p.codexView={periodCoverage:{timeZone:require('../dateKeys').resolveTimeZone(I18n.getTimezone())},diagnosticDays:()=>{reads++;return []}};
 p.renderUsageDiagnostics('codex');assert.equal(reads,1);
 const {adoptCodexDiagnosticSource}=require('../providers/codex/codexUsage');
 const fresh={diagnosticDays:()=>{reads++;return []}};adoptCodexDiagnosticSource(p.codexView,fresh);
 p.renderUsageDiagnostics('codex');assert.equal(reads,2);p.renderUsageDiagnostics('codex');assert.equal(reads,2);
});

for (const selected of ['claude','codex'] as const) test(selected+' ignores a retired quota diagnostic preference without reading sources',()=>{
 const p=provider();p.setting=(key:string)=>key==='showQuotaDeclineRate';
 for(const key of ['codexView','dailyDataForEveryDay','allRecords','quotaObservationStore'])
  Object.defineProperty(p,key,{get(){throw Error('Retired diagnostic accessed '+key);}});
 assert.equal(p.renderUsageDiagnostics(selected),'');
});
test('diagnostic settings and localized copy expose exactly the two supported metrics',()=>{
 const {SETTINGS}=require('../settings');
 const {USAGE_DIAGNOSTIC_SETTING_KEYS,usageDiagnosticsCopyFor}=require('../usageDiagnosticsCopy');
 assert.deepEqual(USAGE_DIAGNOSTIC_SETTING_KEYS,['showUsageThroughput','showUsageChange']);
 assert.equal(SETTINGS.some((row:any)=>row.key==='showQuotaDeclineRate'),false);
 for(const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'] as const){
  const copy=usageDiagnosticsCopyFor(locale);
  for(const key of ['quota','quotaNote','quotaUnit','quotaPolicy','reset','identity','boundary','samples'])assert.equal(key in copy,false,locale+': '+key);
 }
});
