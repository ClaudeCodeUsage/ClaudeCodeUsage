import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import Module=require('node:module');
import {I18n} from '../i18n';

async function fixture(run:(host:any)=>Promise<void>){
  const load=(Module as any)._load,zone=I18n.getTimezone(),language=I18n.getLocale();
  (Module as any)._load=function(request:string,parent:unknown,main:boolean){return request==='vscode'?{workspace:{workspaceFolders:[]}}:load.call(this,request,parent,main);};
  try{
    I18n.setTimezone('UTC');I18n.setLanguage('en');
    const {UsageWebviewProvider}=require('../webview');
    const state=new Map<string,unknown>(['structural','token','bucket','manifest','calendar','calibration'].map(key=>['ccu.achievements.'+key+'Audit.v1',true]));
    const host=new UsageWebviewProvider({globalState:{get:(key:string)=>state.get(key),update:async(key:string,value:unknown)=>state.set(key,value)}}) as any;
    await host.achievementWrite;
    await run(host);
    await Promise.all([host.achievementWrite,host.achievementHourWrite,host.achievementCalendarWrite]);
  }finally{(Module as any)._load=load;I18n.setTimezone(zone);I18n.setLanguage(language as any);}
}
function claude(host:any){host.providerAvailability={claude:true,codex:false,codexData:false};host.allTimeData={totalInputTokens:6_000_000,totalOutputTokens:1,totalCacheCreationTokens:0,totalCacheReadTokens:0,modelBreakdown:{}};host.achievementCalendarTimeZone='UTC';}
test('unverified Codex contributes an unknown subtotal, not an exact zero in the combined gallery',async()=>fixture(async host=>{
  claude(host);host.providerAvailability={claude:true,codex:true,codexData:true};
  host.codexView={currentManifestVerified:false,coverage:{complete:false,identity:{complete:false}},periodCoverage:{timeZone:'UTC',allTime:{complete:false}},allTime:{total:{processed:100_000_000}},last30DaysHourlyByDay:{},hourlyCoverage:{complete:false},allTimeDaily:[]};
  const html=host.renderAchievementData();
  const card=html.match(/<article[^>]*data-achievement-key="cumulative-volume"[\s\S]*?<\/article>/)![0];
  assert.match(card,/≥6M/);
  assert.match(html,/Verified lower bound/);
  assert.equal(host.achievementResults().find((r:any)=>r.id==='hundred-million-club').progress,6_000_001);
}));
test('next overview names the target rank while the gallery keeps the earned rank',async()=>fixture(async host=>{
  claude(host);host.achievementGrants.add('hundred-million-club');
  const html=host.renderAchievementData();
  const next=html.match(/<section[^>]*data-achievement-overview="next"[\s\S]*?<\/section>/)![0];
  const tile=next.match(/<button[^>]*data-achievement-open="cumulative-volume"[\s\S]*?<\/button>/)![0];
  assert.match(tile,/1B club/);
  assert.match(tile,/Next level/);
  assert.match(tile,/Silver/);
  assert.match(html,/<article[^>]*data-achievement-key="cumulative-volume"[^>]*data-achievement-earned="true"/);
}));
test('loading and failed records are distinct states instead of an empty catalogue',async()=>fixture(async host=>{
  let reject!:(e:Error)=>void;
  host.achievementRecordRepository={initialize:()=>new Promise((_,no)=>{reject=no;})};
  const pending=host.renderAchievementData();
  assert.match(pending,/data-achievement-record-state="loading"/);
  assert.doesNotMatch(pending,/0 \/ 0/);
  await new Promise(done=>setImmediate(done));
  reject(new Error('achievement-record:invalid /private/secret'));
  await host.achievementWrite;
  const failed=host.renderAchievementData();
  assert.match(failed,/data-achievement-record-state="unavailable"/);
  assert.doesNotMatch(failed,/private|secret|0 \/ 0/);
}));
test('a clear generation fence explains why the catalogue requires reload',async()=>fixture(async host=>{
  host.clearingAchievements=true;
  const html=host.renderAchievementData();
  assert.match(html,/data-achievement-record-state="changed"/);
  assert.match(html,/Reload/);
  assert.doesNotMatch(html,/0 \/ 0/);
}));
test('pending and stale card explanations describe their own proof scope without inventing progress',async()=>fixture(async host=>{
  const {ACHIEVEMENT_DEFINITIONS}=require('../achievements');
  host.providerAvailability={claude:true,codex:true,codexData:true};
  host.achievementResults=()=>ACHIEVEMENT_DEFINITIONS.map((rule:any)=>({...rule,progress:0,unlocked:false}));
  host.achievementEvidenceStates={'codex-calendar':'pending','codex-lineage':'stale','combined-calendar':'pending'};
  const html=host.renderAchievementData();
  const calendar=html.match(/<article[^>]*data-achievement-key="astra-days"[\s\S]*?<\/article>/)![0];
  assert.match(calendar,/data-proof-explanation="calendar"/);
  assert.match(calendar,/time zone/);
  assert.doesNotMatch(calendar,/<progress|class="achievement-current-progress"/);
  const stale=html.match(/<article[^>]*data-achievement-key="astra-regular"[\s\S]*?<\/article>/)![0];
  assert.match(stale,/data-proof-explanation="stale"/);
  assert.match(stale,/saved awards remain/);
  for(const locale of ['en','zh-CN','zh-TW','de-DE','ja','ko','pt-BR','id']){
    const copy=(require('../i18n') as any).achievementEvidenceHintCopyFor(locale);
    for(const key of ['calendar','lineage','money','index','stale'])assert.ok(copy[key]?.length>10,locale+':'+key);
  }
}));
