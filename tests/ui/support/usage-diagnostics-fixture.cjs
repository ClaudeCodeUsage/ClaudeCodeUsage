'use strict';
// Explicit synthetic data for the production renderer. No logs, identities,
// provider APIs or normal extension persistence are read by this fixture.
const {buildCodexUsageView}=require('../../../out/providers/codex/codexUsage.js');
const {buildScopedCodexInsights}=require('../../../out/providers/codex/codexInsights.js');
const {dayKeyInZone,rollingDayKeysFromDayKey}=require('../../../out/dateKeys.js');
const KEYS=new Set(['showUsageThroughput','showUsageChange']);
exports.applyUsageDiagnosticsFixture=function(provider,baseSnapshot,{fixture,timeZone,now,locale}){
 const enabled=fixture!=='usage-diagnostics-off';
 const changed=fixture==='usage-diagnostics-updated';
 const original=provider.settings;
 provider.settings={get:key=>KEYS.has(key)?enabled:original.get(key),snapshot:()=>original.snapshot().map(row=>KEYS.has(row.key)?{...row,value:enabled,isDefault:!enabled}:row)};
 const days=rollingDayKeysFromDayKey(dayKeyInZone(new Date(now),timeZone),3).slice(0,2);
 const snapshot=structuredClone(baseSnapshot);
 snapshot.currentManifestVerified=true;
 snapshot.coverage.complete=true;snapshot.coverage.identity.complete=true;
 snapshot.coverage.period.timeZone=timeZone;snapshot.coverage.period.asOfDay=dayKeyInZone(new Date(now),timeZone);
 for(const key of ['last7Days','last30Days','allTime'])snapshot.coverage.period[key].complete=true;
 const tokens=output=>({inputTotal:1000,cachedInput:500,outputTotal:output,reasoningOutput:100});
 snapshot.files=snapshot.files.slice(0,2).map((file,index)=>{
  const first=tokens((index+1)*1000),second=tokens((index+1)*1500+(changed?1000:0));
  const total=Object.fromEntries(Object.keys(first).map(key=>[key,first[key]+second[key]]));
  const model='synthetic-model-'+(index?'B':'A');
  return{...file,total,byDay:{[days[0]]:first,[days[1]]:second},byModel:{[model]:total},byEffort:{high:total},
   session:{...file.session,role:index?'subagent':'root'},today:undefined,
   period:{timeZone,indexedThrough:1,lineageVersion:1,lineagePrefixEvents:0,days:Object.fromEntries([first,second].map((total,i)=>[days[i],{
    total,byModel:{[model]:total},byEffort:{high:total},structural:{patchCalls:0,toolCalls:1,postPatchToolCalls:0,compactCount:0,taskCompleteCount:0}}]))}};
 });
 snapshot.total=Object.fromEntries(Object.keys(snapshot.files[0].total).map(key=>[key,snapshot.files.reduce((sum,file)=>sum+file.total[key],0)]));
 provider.codexView=buildCodexUsageView(snapshot,now);provider.codexInsights=buildScopedCodexInsights(provider.codexView);
 const claude=output=>({totalInputTokens:1000,totalOutputTokens:output,totalCacheReadTokens:500,totalCacheCreationTokens:200,totalCost:0,
  costBreakdown:{input:0,output:0,cacheWrite:0,cacheRead:0},messageCount:2,modelBreakdown:{'synthetic-claude':{
   inputTokens:1000,outputTokens:output,cacheReadTokens:500,cacheCreationTokens:200,cost:0,count:2}}});
 provider.dailyDataForEveryDay=[{date:days[0],data:claude(3000)},{date:days[1],data:claude(changed?6500:4500)}];
 provider.allTimeData=claude(changed?9500:7500);provider.achievementCalendarTimeZone=timeZone;
 provider.contentAnalysis={categories:[{key:'toolResults',estimatedTokens:7000},{key:'assistantText',estimatedTokens:3000}],
  toolResultBreakdown:[{key:'synthetic-tool-with-a-long-localized-label',estimatedTokens:7000}],totalEstimatedTokens:10000,recentPrompts:[]};
 const render=provider.renderUsageDiagnostics.bind(provider);
 provider.renderUsageDiagnostics=selected=>{
  const html=render(selected);return html?'<p class="table-hint" data-synthetic-diagnostics>'+
   (locale==='zh-CN'?'合成数据 · 生产渲染验收':'Synthetic data · production renderer check')+'</p>'+html:html;
 };
};
