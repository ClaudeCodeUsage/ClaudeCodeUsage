import {ACHIEVEMENT_DEFINITIONS,ACHIEVEMENT_SERIES,type AchievementId} from './achievements';
import {achievementRuleVersion} from './achievementRuleVersions';
import {claudeAchievementFamily,codexModelFamily,normalizeCodexAchievementModel} from './achievementModels';
import type {AchievementDay,AchievementDayEvidence} from './achievementCalendar';
import {codexAchievementCalendarProjection} from './achievementCalendar';
import {claudeMoneyEvidenceFromModels,codexMoneyEvidenceFromModels} from './achievementMoneyScopes';
import {getAchievementMoneyPricebook,type AchievementMoneyEvidence,type AchievementMoneyBackend} from './achievementMoney';
import {API_ACHIEVEMENT_DEFINITIONS} from './achievementMoneyCatalog';
import type {CodexFileAggregate} from './providers/codex/codexIndex';
import type {UsageData,ClaudeUsageRecord} from './types';
import {dayKeyInZone} from './dateKeys';
import {historyRegistrationAllows,ACHIEVEMENT_HISTORY_CATALOG_SIGNATURE} from './achievementHistoryRegistry';
import {ClaudeDataLoader} from './dataLoader';

/** Derived, runtime-only annotations. Never an award receipt or account-history claim. */
export interface AchievementHistoryDay extends AchievementDay {
 cacheRead?:number;cacheCreation?:number;money?:AchievementMoneyEvidence;
}
export interface AchievementSessionHistoryDay {day:string;outputSessions:number;fableSessions:number;mixedSessions:number}
export interface AchievementHistoryInput {
 timeZone:string;asOfDay:string;
 claude:Omit<AchievementDayEvidence,'days'> & {days:readonly AchievementHistoryDay[]};
 codex:Omit<AchievementDayEvidence,'days'> & {days:readonly AchievementHistoryDay[]};
 enabled:{claude:boolean;codex:boolean};
 claudeSessions?:readonly AchievementSessionHistoryDay[];
}
export interface AchievementHistoryDate {
 schemaVersion:1;ruleVersion:number;day:string;timeZone:string;
 scope:'retained-local-history'|'verified-subset';
 pricebookVersion?:string;
}
const DAY=86400000;
const count=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const ordinal=(day:string):number=>{
 const n=typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)?Date.parse(day+'T00:00:00Z'):NaN;
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===day?n:NaN;
};
const label=(time:number)=>new Date(time).toISOString().slice(0,10);
const monday=(n:number)=>n-((new Date(n).getUTCDay()+6)%7)*DAY;
const rules=new Map<string,typeof ACHIEVEMENT_DEFINITIONS[number]>(ACHIEVEMENT_DEFINITIONS.map(r=>[r.id,r]));
const SCALE=10n**18n;
/** All-session provenance stays within this reducer; the output carries counts only.
 * A Sessions UI cap or a basename without parent ownership cannot provide dates. */
export function claudeAchievementSessionHistory(records:readonly ClaudeUsageRecord[],zone:string,now=Date.now(),
 eligible?:ReadonlySet<string>):readonly AchievementSessionHistoryDay[]{
 try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{return [];}
 if(!eligible)return [];
 const sessions=new Map<string,{output:number;fable:number;other:number;admitted:number}>();
 for(const r of records){
  if((r as ClaudeUsageRecord&{_unownedAgentSession?:true})._unownedAgentSession||!r._sessionId||r._sessionId==='unknown'||!eligible.has(r._sessionId))continue;
  const time=Date.parse(r.timestamp),output=r.message?.usage?.output_tokens;
  if(!Number.isFinite(time)||time>now||time<=0)continue;
  const state=sessions.get(r._sessionId)??{output:Infinity,fable:Infinity,other:Infinity,admitted:Infinity};
  // Use the existing metadata-only reducer's exact prompt/cost admission. A
  // session that becomes eligible later must not inherit an earlier free output.
  if(time<state.admitted){
   const metadata=ClaudeDataLoader.calculateUsageData([r]);
   if(metadata.messageCount>0||metadata.totalCost>0)state.admitted=time;
  }
  sessions.set(r._sessionId,state);
  if(r._isUserPrompt||r.isApiErrorMessage||!r.message.model||r.message.model==='<synthetic>'||!count(output)||output===0)continue;
  state.output=Math.min(state.output,time);
  const family=claudeAchievementFamily(r.message.model??'');
  if(family==='fable')state.fable=Math.min(state.fable,time);
  else if(family)state.other=Math.min(state.other,time);
  sessions.set(r._sessionId,state);
 }
 const days=new Map<string,AchievementSessionHistoryDay>();
 const add=(time:number,key:'outputSessions'|'fableSessions'|'mixedSessions')=>{
  if(!Number.isFinite(time))return;
  const day=dayKeyInZone(new Date(time),zone),row=days.get(day)??{day,outputSessions:0,fableSessions:0,mixedSessions:0};
  row[key]++;days.set(day,row);
 };
 for(const s of sessions.values()){
  add(Math.max(s.output,s.admitted),'outputSessions');
  add(Math.max(s.fable,s.admitted),'fableSessions');add(Math.max(s.fable,s.other,s.admitted),'mixedSessions');
 }
 return [...days.values()].sort((a,b)=>a.day.localeCompare(b.day));
}
export function claudeAchievementHistoryEvidence(proof:AchievementDayEvidence,
 days:readonly {date:string;data:UsageData}[],backend:AchievementMoneyBackend):AchievementHistoryInput['claude']{
 const rows=new Map(days.map(r=>[r.date,r.data]));
 return {...proof,days:proof.days.map(row=>{
  const data=rows.get(row.day);
  if(!data)return row;
  const raw=claudeMoneyEvidenceFromModels(data.modelBreakdown,backend);
  const money=['complete','partial'].includes(raw.status)?raw as AchievementMoneyEvidence:undefined;
  return {...row,cacheRead:data.totalCacheReadTokens,cacheCreation:data.totalCacheCreationTokens,...(money?{money}:{})};
 })};
}
/** Dates/prices/cache are admitted only from the fully dated file selection AFTER
 * full-census ancestry/witness validation. A row copied from legacy byDay is not proof. */
export function codexAchievementHistoryEvidence(files:readonly CodexFileAggregate[],zone:string,indexed:boolean,
 calendarComplete:boolean):AchievementHistoryInput['codex']{
 const projection=codexAchievementCalendarProjection(files,zone,indexed,calendarComplete);
 const rows=new Map(projection.completeDateEvidence.days.map(r=>[r.day,{...r,cacheRead:0,
  units:0n,totalTokens:0,pricedTokens:0,moneyKnown:true}]));
 for(const file of projection.completeDateFiles)for(const [day,slice]of Object.entries(file.period!.days)){
  const row=rows.get(day);if(!row)continue;
  row.cacheRead+=slice.total.cachedInput??0;
  const priced=codexMoneyEvidenceFromModels(slice.byModel,'openai');
  if(!['complete','partial','empty','unpriced'].includes(priced.status)){row.moneyKnown=false;continue;}
  const money=priced as AchievementMoneyEvidence;
  row.units+=BigInt(money.exactMicroUsdUnits);row.totalTokens+=money.totalTokens;row.pricedTokens+=money.pricedTokens;
 }
 const days:AchievementHistoryDay[]=[...rows.values()].map(r=>{
  const {units,totalTokens,pricedTokens,moneyKnown,...day}=r;
  if(!moneyKnown||!count(totalTokens)||!count(pricedTokens)||units/SCALE>BigInt(Number.MAX_SAFE_INTEGER))return day;
  const money:AchievementMoneyEvidence={provider:'codex',backend:'openai',pricebookVersion:getAchievementMoneyPricebook('openai').version,
   exactMicroUsdUnits:units.toString(),microUsd:Number(units/SCALE),totalTokens,pricedTokens,
   unpricedTokens:totalTokens-pricedTokens,pricingCoverage:totalTokens?pricedTokens/totalTokens:0,
   status:totalTokens===0?'empty':pricedTokens===0?'unpriced':pricedTokens<totalTokens?'partial':'complete'};
  return {...day,money};
 });
 return {timeZone:zone,complete:projection.evidence.complete,days,
  ...(!projection.evidence.complete&&days.length?{scope:'verified-subset' as const}:{})};
}
/** Bind annotation caches to actual rule shapes. Adding a scope needs an explicit handler;
 * changed joint-rule versions never inherit a date from a volume approximation. */
export const ACHIEVEMENT_HISTORY_VERSION=1;
export function achievementHistoryCatalogSignature():string {
 return ACHIEVEMENT_HISTORY_CATALOG_SIGNATURE;
}
function validated(proof:AchievementHistoryInput['claude'],zone:string,asOf:number):AchievementHistoryDay[]|undefined{
 if(!proof||(proof.complete!==true&&proof.scope!=='verified-subset')||proof.timeZone!==zone||!Array.isArray(proof.days))return;
 const days:AchievementHistoryDay[]=[],seen=new Set<string>();
 let total=0,output=0;
 for(const row of proof.days){
  if(!row||!Number.isFinite(ordinal(row.day))||seen.has(row.day)||!count(row.processed)||!count(row.output)||
   row.output>row.processed||!row.models||typeof row.models!=='object'||Array.isArray(row.models))return;
  seen.add(row.day);
  let p=0,o=0;
  for(const vector of Object.values(row.models) as Array<{processed:number;output:number}>){
   if(!vector||!count(vector.processed)||!count(vector.output)||vector.output>vector.processed)return;
   p+=vector.processed;o+=vector.output;
  }
  if(!count(p)||!count(o)||p>row.processed||o>row.output)return;
  if(ordinal(row.day)>asOf)continue;
  total+=row.processed;output+=row.output;
  if(!count(total)||!count(output))return;
  days.push(row);
 }
 return days.sort((a,b)=>a.day.localeCompare(b.day));
}
type Family='sonnet'|'opus'|'haiku'|'fable'|'astra'|'sol'|'luna';
const families:Family[]=['sonnet','opus','haiku','fable','astra','sol','luna'];
/** O(days * supported catalog size); no source I/O, raw identity, timers or ledger writes.
 * A retained-log crossing can be later than the true account unlock after rotation.
 * All returned labels expressly mean the earliest date this retained proof establishes. */
export function achievementHistoryDates(input:AchievementHistoryInput):Readonly<Partial<Record<AchievementId,AchievementHistoryDate>>>{
 const result:Partial<Record<AchievementId,AchievementHistoryDate>>={};
 const asOf=ordinal(input.asOfDay);
 try {if(!Number.isFinite(asOf)||!input.timeZone)return Object.freeze(result);
  new Intl.DateTimeFormat('en',{timeZone:input.timeZone});
 }catch{return Object.freeze(result);}
 const claude=input.enabled.claude?validated(input.claude,input.timeZone,asOf):[];
 const codex=input.enabled.codex?validated(input.codex,input.timeZone,asOf):[];
 const whole=!!claude&&!!codex&&(!input.enabled.claude||input.claude.complete)&&(!input.enabled.codex||input.codex.complete);
 const scope=(provider:'claude'|'codex'|'combined')=>provider==='combined'?!whole:
  input[provider].complete!==true;
 const mark=(ids:readonly AchievementId[],value:number,time:number,provider:'claude'|'codex'|'combined',counter:string)=>{
  if(!count(value)||time>asOf)return;
  for(const id of ids){
   const rule=rules.get(id);
   // All handlers below model v1 numeric rules, not the recalibrated joint v2 rules.
   if(!rule||!historyRegistrationAllows(id,counter)||rule.group!==provider||value<rule.target||result[id])continue;
   result[id]=Object.freeze({schemaVersion:ACHIEVEMENT_HISTORY_VERSION,ruleVersion:achievementRuleVersion(id),day:label(time),
    timeZone:input.timeZone,scope:scope(provider)?'verified-subset':'retained-local-history'});
  }
 };
 const series=(name:string,value:number,time:number,provider:'claude'|'codex'|'combined')=>
  mark(ACHIEVEMENT_SERIES[name]??[],value,time,provider,name);
 const byDay=new Map<string,{claude?:AchievementHistoryDay;codex?:AchievementHistoryDay}>();
 for(const provider of ['claude','codex'] as const)for(const row of (provider==='claude'?claude:codex)??[]){
  const bucket=byDay.get(row.day)??{};bucket[provider]=row;byDay.set(row.day,bucket);
 }
 const processed={claude:0,codex:0},outputs={claude:0,codex:0};
 const cache={read:0,creation:0,codexRead:0,readKnown:true,creationKnown:true,codexReadKnown:true};
 const moneyTotals={claude:0n,codex:0n};
 const moneyWeeks={claude:new Map<number,bigint>(),codex:new Map<number,bigint>()};
 const moneyBooks:Partial<Record<'claude'|'codex',string>>={};
 const moneyBounds={claude:false,codex:false};
 const markMoney=(provider:'claude'|'codex',scopeKey:'cumulative'|'completedMondayWeekPeak',units:bigint,time:number)=>{
  if(units<0n||units/SCALE>BigInt(Number.MAX_SAFE_INTEGER))return;
  const ids=API_ACHIEVEMENT_DEFINITIONS.filter(r=>r.group===provider&&r.scope===scopeKey).map(r=>r.id);
  mark(ids,Number(units/SCALE),time,provider,provider+'-api-'+(scopeKey==='cumulative'?'total':'week'));
  for(const id of ids)if(result[id])result[id]=Object.freeze({...result[id]!,
   pricebookVersion:moneyBooks[provider],...(moneyBounds[provider]?{scope:'verified-subset' as const}:{})});
 };
 const familyVolume=Object.fromEntries(families.map(f=>[f,0])) as Record<Family,number>;
 const familyDays=Object.fromEntries(families.map(f=>[f,0])) as Record<Family,number>;
 const weeks=new Map<number,{total:number;qualifiedDays:number}>();
 let active=0,run=0,previous=-Infinity,dual=0;
 for(const [day,bucket]of [...byDay].sort(([a],[b])=>a.localeCompare(b))){
  const time=ordinal(day),closed=time<asOf,dailyFamilies=new Map<Family,{processed:number;output:number}>();
  const week=weeks.get(monday(time))??{total:0,qualifiedDays:0};
  let dayVolume=0,qualified=false;
  for(const provider of ['claude','codex'] as const){
   const row=bucket[provider];if(!row)continue;
   processed[provider]+=row.processed;outputs[provider]+=row.output;dayVolume+=row.processed;
   qualified ||= row.processed>=1e6&&row.output>0;
   for(const [model,vector]of Object.entries(row.models)){
    const normalized=provider==='codex'?normalizeCodexAchievementModel(model):undefined;
    const family=provider==='claude'?claudeAchievementFamily(model):normalized?codexModelFamily(normalized):null;
    if(!family)continue;
    familyVolume[family]+=vector.processed;
    const merged=dailyFamilies.get(family)??{processed:0,output:0};
    merged.processed+=vector.processed;merged.output+=vector.output;dailyFamilies.set(family,merged);
   }
   if(provider==='claude'){
    cache.readKnown &&= count(row.cacheRead)&&row.cacheRead!<=row.processed;
    cache.creationKnown &&= count(row.cacheCreation)&&row.cacheCreation!<=row.processed;
    if(cache.readKnown)cache.read+=row.cacheRead!;
    if(cache.creationKnown)cache.creation+=row.cacheCreation!;
   }else{
    cache.codexReadKnown &&= count(row.cacheRead)&&row.cacheRead!<=row.processed;
    if(cache.codexReadKnown)cache.codexRead+=row.cacheRead!;
   }
   const m=row.money;
   if(m&&m.provider===provider&&m.backend&&(provider==='claude'?['anthropic','aws-bedrock-in-region'].includes(m.backend):m.backend==='openai')&&
    m.pricebookVersion===getAchievementMoneyPricebook(m.backend).version&&
    ['complete','partial'].includes(m.status)&&typeof m.exactMicroUsdUnits==='string'&&/^\d{1,40}$/.test(m.exactMicroUsdUnits)&&
    count(m.totalTokens)&&m.totalTokens<=row.processed&&count(m.pricedTokens)&&m.pricedTokens<=m.totalTokens&&
    count(m.unpricedTokens)&&m.pricedTokens+m.unpricedTokens===m.totalTokens&&
    count(m.microUsd)&&BigInt(m.microUsd)===BigInt(m.exactMicroUsdUnits)/SCALE){
    if(moneyBooks[provider]&&moneyBooks[provider]!==m.pricebookVersion)return Object.freeze({});
    moneyBooks[provider]=m.pricebookVersion;moneyBounds[provider] ||= m.status==='partial'||m.totalTokens<row.processed;
    const units=BigInt(m.exactMicroUsdUnits);
    moneyTotals[provider]+=units;
    const w=monday(time);moneyWeeks[provider].set(w,(moneyWeeks[provider].get(w)??0n)+units);
    markMoney(provider,'cumulative',moneyTotals[provider],time);
   }else if(row.processed>0){
    moneyBounds[provider]=true;
   }
  }
  if(!count(dayVolume)||!count(processed.claude+processed.codex))return Object.freeze({});
  if(claude){
   series('sonnet-main',familyVolume.sonnet,time,'claude');series('opus-cannon',familyVolume.opus,time,'claude');
   series('haiku-worker',familyVolume.haiku,time,'claude');series('fable-volume',familyVolume.fable,time,'claude');
   series('claude-output',outputs.claude,time,'claude');
   if(cache.readKnown)series('cache-wizard',cache.read,time,'claude');
   if(cache.creationKnown)series('claude-cache-creation',cache.creation,time,'claude');
  }
  if(codex){
   for(const f of ['astra','sol','luna']as const)series(f+'-regular',familyVolume[f],time,'codex');
   series('codex-output',outputs.codex,time,'codex');
   if(cache.codexReadKnown)series('codex-cache-read',cache.codexRead,time,'codex');
  }
  mark(['hundred-million-club','billion-token-club','ten-billion-token-club','hundred-billion-token-club','trillion-token-club'],
   processed.claude+processed.codex,time,'combined','cumulative-volume');
  week.total+=dayVolume;
  if(!count(week.total))return Object.freeze({});
  // Existing weekly-volume rule includes the current observed week.
  series('weekly-volume',week.total,time,'combined');
  if(closed&&qualified)week.qualifiedDays++;
  weeks.set(monday(time),week);
  if(dayVolume>0){
   active++;run=time===previous+DAY?run+1:1;previous=time;
   series('active-days',active,time,'combined');
   series('active-day-streak',run,time,'combined');mark(['streak-machine'],run,time,'combined','active-day-streak');
  }
  if(!closed)continue;
  const eligibleAt=time+DAY;
  let qualifiedFamilies=0;
  for(const [family,vector]of dailyFamilies)if(vector.processed>=1e6&&vector.output>0){
   qualifiedFamilies++;familyDays[family]++;
   series(family+'-days',familyDays[family],eligibleAt,['astra','sol','luna'].includes(family)?'codex':'claude');
  }
  if(qualifiedFamilies>=3)mark(['three-family-day'],1,eligibleAt,'combined','three-family-day');
  if(whole&&bucket.claude&&bucket.codex&&bucket.claude.processed>=1e6&&bucket.claude.output>0&&
   bucket.codex.processed>=1e6&&bucket.codex.output>0){
   dual++;series('dual-provider-days',dual,eligibleAt,'combined');mark(['dual-provider-day'],1,eligibleAt,'combined','dual-provider-days');
  }
 }
 for(const provider of ['claude','codex']as const){
  for(const [w,units]of [...moneyWeeks[provider]].sort(([a],[b])=>a-b))if(w+7*DAY<=asOf){
   markMoney(provider,'completedMondayWeekPeak',units,w+7*DAY);
  }
 }
 if(input.enabled.claude&&claude&&Array.isArray(input.claudeSessions)){
  let outputs=0,fable=0,mixed=0;const seen=new Set<string>();
  const rows=[...input.claudeSessions].sort((a,b)=>a.day.localeCompare(b.day));
  if(rows.every(r=>Number.isFinite(ordinal(r.day))&&!seen.has(r.day)&&seen.add(r.day)&&
   count(r.outputSessions)&&count(r.fableSessions)&&count(r.mixedSessions))){
   for(const r of rows){
    const time=ordinal(r.day);if(time>asOf)continue;
    outputs+=r.outputSessions;fable+=r.fableSessions;mixed+=r.mixedSessions;
    series('claude-output-sessions',outputs,time,'claude');series('fable-sessions',fable,time,'claude');
    mark(['fable-relay'],mixed,time,'claude','fable-relay');
   }
  }
 }
 // Completion events, including quiet empty weeks, do not depend on a log on Monday.
 let activeWeeks=0;
 let firstTime=Infinity;for(const [day,rows]of byDay)if((rows.claude?.processed??0)+(rows.codex?.processed??0)>0){
  firstTime=Math.min(firstTime,ordinal(day));
 }
 const firstWeek=monday(firstTime)+(firstTime===monday(firstTime)?0:7*DAY);
 const completed=[...weeks].filter(([w])=>w+7*DAY<=asOf).sort(([a],[b])=>a-b);
 for(const [w,week]of completed){
  if(week.qualifiedDays>=4)activeWeeks++;
  series('active-weeks',activeWeeks,w+7*DAY,'combined');
 }
 if(whole&&Number.isFinite(firstTime)){
  const starts=new Set<number>();
  for(const w of weeks.keys())for(let back=0;back<4;back++)starts.add(w-back*7*DAY);
  for(const start of [...starts].sort((a,b)=>a-b)){
   const end=start+28*DAY;
   if(start<firstWeek||end>monday(asOf))continue;
   let sum=0;for(let n=0;n<4;n++)sum+=weeks.get(start+n*7*DAY)?.total??0;
   if(count(sum))series('weekly-average',Math.floor(sum/4),end,'combined');
  }
 }
 return Object.freeze(result);
}
