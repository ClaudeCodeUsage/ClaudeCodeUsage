import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { I18n } from '../i18n';
import { codexAchievementCalendarProjection } from '../achievementCalendar';
import { codexModelSignals } from '../achievements';
import { codexAchievementMoneyScopes } from '../achievementMoneyScopes';

test('reliable Claude calendar remains a visible lower bound when Codex dates are pending', async () => {
  const load = (Module as any)._load;
  const zone = I18n.getTimezone();
  const language = I18n.getLocale();
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? {workspace:{workspaceFolders:[]}} : load.call(this,request,parent,main);
  };
  try {
    I18n.setTimezone('UTC'); I18n.setLanguage('en');
    const {UsageWebviewProvider} = require('../webview');
    const values = new Map<string, unknown>();
    const host = new UsageWebviewProvider({globalState:{get:(key:string)=>values.get(key),
      update:async(key:string,value:unknown)=>{values.set(key,value);}}}) as any;
    const model = {inputTokens:99_999_999,outputTokens:1,cacheCreationTokens:0,cacheReadTokens:0};
    const data = {totalInputTokens:model.inputTokens,totalOutputTokens:1,totalCacheCreationTokens:0,
      totalCacheReadTokens:0,modelBreakdown:{'claude-sonnet-5':model}};
    host.providerAvailability = {claude:true,codex:true,codexData:true};
    host.allTimeData = data;
    host.dailyDataForEveryDay = Array.from({length:7},(_,i)=>({date:`2026-09-0${i+1}`,data}));
    host.achievementCalendarTimeZone = 'UTC';
    host.codexView = {currentManifestVerified:true,coverage:{complete:true,identity:{complete:false}},
      periodCoverage:{timeZone:'UTC',allTime:{complete:false}},allTime:{total:{processed:0}},
      last30DaysHourlyByDay:{},hourlyCoverage:{complete:false},allTimeDaily:[]};
    const results = new Map<string,any>(host.achievementResults().map((row:any)=>[row.id,row]));
    assert.equal(results.get('weekly-volume-bronze').progress,600_000_000,'weeks begin Monday, not the first fixture day');
    assert.equal(results.get('active-day-streak').unlocked,true);
    const html = host.renderAchievementData();
    const card = (key:string) => html.match(new RegExp(`<article[^>]*data-achievement-key="${key}"[\\s\\S]*?<\\/article>`))![0];
    assert.match(card('weekly-volume'),/data-achievement-proof="ready"/);
    assert.match(card('weekly-volume'),/≥600M/);
    assert.match(card('active-day-streak'),/data-achievement-proof="ready"/);
    assert.match(card('active-days'),/≥7/);
    assert.match(card('weekly-average'),/data-achievement-proof="pending"/);
    assert.match(card('dual-provider-days'),/data-achievement-proof="pending"/);
    assert.match(card('sol-days'),/data-achievement-proof="pending"/);
    assert.equal(host.achievementEvidenceStates['combined-calendar'],'pending','do not reopen the whole notice domain');
    host.achievementGrants.add('weekly-volume-gold');
    const historicalHtml = host.renderAchievementData();
    const historicalCard = historicalHtml.match(/<article[^>]*data-achievement-key="weekly-volume"[\s\S]*?<\/article>/)![0];
    assert.match(historicalCard,/data-achievement-earned="true"/,'retain the historical earned rank');
    assert.match(historicalCard,/achievement-current-value[^>]*>Current value: ≥600M/,'a saved target is not current lower-bound evidence');
    assert.doesNotMatch(historicalCard,/≥10B/);
    host.achievementGrants.delete('weekly-volume-gold');
    const days=Array.from({length:750},(_,i)=>({date:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10),data}));
    host.dailyDataForEveryDay=days;
    const multiplied={...data,totalInputTokens:data.totalInputTokens*750,totalOutputTokens:750,
      modelBreakdown:{'claude-sonnet-5':{...model,inputTokens:model.inputTokens*750,outputTokens:750}}};
    host.allTimeData=multiplied;
    const longResults=new Map<string,any>(host.achievementResults().map((row:any)=>[row.id,row]));
    assert.equal(longResults.get('active-days-platinum').unlocked,true,'Codex date gaps do not block a verified Claude long-term day rank');
    assert.equal(longResults.get('active-days-legendary').unlocked,false);
    const partialLong=host.renderAchievementData().match(/<article[^>]*data-achievement-key="active-days"[\s\S]*?<\/article>/)![0];
    assert.match(partialLong,/≥750 \/ 1,?500/);
    host.codexView.coverage.identity.complete=true;
    host.codexView.periodCoverage.allTime.complete=true;
    host.codexAchievementSignals={...host.codexAchievementSignals,dayEvidence:{complete:true,timeZone:'UTC',days:[]}};
    const exactLong=host.renderAchievementData().match(/<article[^>]*data-achievement-key="active-days"[\s\S]*?<\/article>/)![0];
    assert.doesNotMatch(exactLong,/≥750/,'complete-empty Codex proof upgrades the bound to an exact count');
    host.dailyDataForEveryDay=Array.from({length:7},(_,i)=>({date:`2026-09-0${i+1}`,data}));
    host.allTimeData=data;
    host.codexView.coverage.identity.complete=false;
    host.codexView.periodCoverage.allTime.complete=false;
    host.revokedAchievementEvidence.add('codex');
    assert.match(host.renderAchievementData(),/≥600M/,'a stale independent provider cannot retire verified Claude dates');
    host.revokedAchievementEvidence.delete('codex');
    I18n.setTimezone('Asia/Shanghai');
    assert.doesNotMatch(host.renderAchievementData(),/≥600M/,'old-zone rows cannot prove the lower bound');
    await Promise.all([host.achievementWrite,host.achievementHourWrite,host.achievementCalendarWrite]);
  } finally { I18n.setTimezone(zone); I18n.setLanguage(language as any); (Module as any)._load = load; }
});

test('Codex witnessed date subsets show bounded progress but do not enable a complete calendar notice domain', async () => {
  const load=(Module as any)._load, zone=I18n.getTimezone(), language=I18n.getLocale();
  (Module as any)._load=function(request:string,parent:unknown,main:boolean) {
    return request==='vscode' ? {workspace:{workspaceFolders:[]}} : load.call(this,request,parent,main);
  };
  try {
    I18n.setTimezone('UTC'); I18n.setLanguage('en');
    const {UsageWebviewProvider}=require('../webview');
    const values=new Map<string,unknown>();
    const host=new UsageWebviewProvider({globalState:{get:(key:string)=>values.get(key),
      update:async(key:string,value:unknown)=>{values.set(key,value);}}}) as any;
    const tokens={inputTotal:1_000_000_000,outputTotal:8};
    const slice={total:{inputTotal:125_000_000,outputTotal:1},
      byModel:{'gpt-6.1-sol':{inputTotal:125_000_000,outputTotal:1}},byEffort:{},structural:{}};
    const good:any={total:tokens,byModel:{'gpt-6.1-sol':tokens},byEffort:{},byDay:{},structural:{},
      session:{sessionKey:'good',role:'root'},achievementPeriodWitness:{size:1,offset:1,expectedPrefixEvents:0,timeZone:'UTC'},
      period:{indexedThrough:1,lineageVersion:1,lineagePrefixEvents:0,timeZone:'UTC',days:Object.fromEntries(
        ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-05','2026-10-06','2026-10-07','2026-10-08'].map(date=>[date,slice]))}};
    const files=[good,{...good,session:{sessionKey:'duplicate',role:'root'}},{...good,session:{sessionKey:'duplicate',role:'root'}}];
    const proof=codexAchievementCalendarProjection(files,'UTC',true,false).evidence;
    host.providerAvailability={claude:false,codex:true,codexData:true};
    host.codexView={currentManifestVerified:true,coverage:{complete:true,identity:{complete:false}},
      periodCoverage:{timeZone:'UTC',allTime:{complete:false}},allTime:{total:{processed:tokens.inputTotal+8}},
      last30DaysHourlyByDay:{},hourlyCoverage:{complete:false},allTimeDaily:[]};
    host.codexAchievementSignals={...codexModelSignals(files),dayEvidence:proof,
      money:codexAchievementMoneyScopes({files,complete:true,calendarComplete:false,dayEvidence:proof,backend:'openai',asOfDay:'2026-10-12'})};
    const html=host.renderAchievementData();
    assert.match(html,/Unverified Codex lineage or dated usage is excluded/);
    const card=(key:string,source=html)=>source.match(new RegExp(`<article[^>]*data-achievement-key="${key}"[\\s\\S]*?<\\/article>`))![0];
    assert.match(card('sol-days'),/data-achievement-proof="ready"/);
    assert.match(card('sol-days'),/≥8/);
    assert.match(card('weekly-volume'),/≥500M/);
    assert.match(card('codex-api-week'),/data-achievement-proof="ready"/);
    assert.match(card('codex-api-week'),/≥\$1,000/);
    assert.match(card('weekly-average'),/data-achievement-proof="pending"/);
    assert.equal(host.achievementEvidenceStates['codex-calendar'],'pending');
    assert.equal(host.achievementEvidenceStates['combined-calendar'],'pending');
    host.revokedAchievementEvidence.add('codex');
    const revoked=host.renderAchievementData();
    assert.doesNotMatch(card('sol-days',revoked),/≥8/,'same-reference cached calendar is revoked too');
    host.revokedAchievementEvidence.delete('codex');
    assert.match(card('sol-days',host.renderAchievementData()),/≥8/);
    await Promise.all([host.achievementWrite,host.achievementHourWrite,host.achievementCalendarWrite]);
    assert.equal(host.achievementCalendarPeak,undefined,'partial dates never retain a four-week maximum');
  } finally {I18n.setTimezone(zone);I18n.setLanguage(language as any);(Module as any)._load=load;}
});
