import type {LocalWeeklyEstimate} from './weeklyEstimate';
import type {WeeklyValueInputs} from './weeklyValue';
import {copyCodexQuotaEpoch, codexQuotaEpochFitsObservation, CodexQuotaEpoch} from './codexQuotaEpoch';

export interface OfficialQuotaSample {
  accountScopeKey:string; sourceScopeKey:string; requestedAt:number; observedAt:number;
  resetAt:number; usedPercent:number;
  quotaEpoch?:CodexQuotaEpoch;
}
interface Counter {usd:number;priced:number;total:number;first:number;last:number;percent:number;reset:number;witness:number;valid:boolean}
interface Baseline {sample:OfficialQuotaSample;price:string;rows:Map<string,Counter>}
interface Accumulated {from:number;usd:number;priced:number;total:number;delta:number;gap:boolean}
const HEX=/^[a-f0-9]{64}$/,WEEK=604_800_000,MAX_GAP=300_000,MAX_SOURCES=16_384;
function finite(x:number){return Number.isFinite(x)&&x>=0;}
function valid(s:OfficialQuotaSample){return HEX.test(s.accountScopeKey)&&HEX.test(s.sourceScopeKey)&&
  [s.observedAt,s.requestedAt,s.resetAt].every(t=>Number.isSafeInteger(t)&&t>0)&&
  s.requestedAt<=s.observedAt&&s.observedAt-s.requestedAt<=30_000&&
  s.resetAt>s.observedAt&&s.resetAt-s.observedAt<=WEEK&&finite(s.usedPercent)&&s.usedPercent<=100&&
  (s.quotaEpoch===undefined||(copyCodexQuotaEpoch(s.quotaEpoch)!==undefined&&
    codexQuotaEpochFitsObservation(s.quotaEpoch,s.observedAt,s.resetAt)));}
function counters(s:OfficialQuotaSample,inputs:WeeklyValueInputs):Map<string,Counter>|undefined {
  if(inputs.localHistoryComplete!==true)return undefined;
  const result=new Map<string,Counter>();
  for(const row of inputs.usage){
    const first=row.intervalStart??row.timestamp,last=row.intervalEnd??row.timestamp;
    if(!row.sourceKey||last>s.observedAt||last<s.resetAt-WEEK-300_000)continue;
    if(![first,last,row.timestamp,row.equivalentUsd,row.pricedTokens,row.totalTokens].every(finite)||
      first>last||row.timestamp<first||row.timestamp>last||row.pricedTokens>row.totalTokens||
      (row.equivalentUsd>0&&row.pricedTokens===0))return undefined;
    const c=result.get(row.sourceKey)??{usd:0,priced:0,total:0,first,last,percent:0,reset:0,witness:0,valid:false};
    c.usd+=row.equivalentUsd;c.priced+=row.pricedTokens;c.total+=row.totalTokens;
    if(![c.usd,c.priced,c.total].every(finite)||c.usd>1e12)return undefined;
    c.first=Math.min(c.first,first);c.last=Math.max(c.last,last);result.set(row.sourceKey,c);
    if(result.size>MAX_SOURCES)return undefined;
  }
  for(const row of inputs.observations){
    if(row.provider!=='codex'||!row.sourceKey||row.observedAt>s.observedAt||!finite(row.observedAt)||
      !finite(row.usedPercent)||row.usedPercent>100||!finite(row.resetAt))continue;
    const c=result.get(row.sourceKey);if(!c||row.observedAt<c.witness)continue;
    const sameTime=row.observedAt===c.witness&&c.witness>0;
    if(sameTime){
      if(row.usedPercent!==c.percent||Math.abs(row.resetAt-c.reset)>300_000||
        row.flags?.some(f=>f==='account-ambiguous'||f==='clock-anomaly'))c.valid=false;
      continue;
    }
    c.valid=Math.abs(row.resetAt-(s.quotaEpoch?.resetAnchorAt??s.resetAt))<=300_000&&row.usedPercent<=s.usedPercent&&
      !row.flags?.some(f=>f==='account-ambiguous'||f==='clock-anomaly');
    c.percent=row.usedPercent;c.reset=row.resetAt;c.witness=row.observedAt;
  }
  return result;
}

/** A quota-identified, local incremental PROXY, not proof of request/account
 * ownership or a complete cross-device amount. No I/O or history relabelling.
 * Each account/epoch retains only admitted intervals; switches establish fresh
 * monetary baselines, and explicit reset/failure/blur/restart clears the runs.
 */
export class CodexAccountEstimator {
  private baseline?:Baseline;
  private lastObserved?:OfficialQuotaSample;
  private accumulated?:Accumulated;
  private readonly runs=new Map<string,Accumulated>();
  private runKey(sample:OfficialQuotaSample,price:string):string|undefined {
    return sample.quotaEpoch===undefined?undefined:JSON.stringify([sample.accountScopeKey,sample.sourceScopeKey,price,sample.quotaEpoch]);
  }
  breakContinuity():void{this.baseline=undefined;this.lastObserved=undefined;this.accumulated=undefined;}
  reset():void{this.breakContinuity();this.runs.clear();}
  observe(sample:OfficialQuotaSample,inputs:WeeklyValueInputs,pricingVersion:string):LocalWeeklyEstimate|undefined {
    if(!valid(sample)){this.reset();return undefined;}
    sample={...sample,...(sample.quotaEpoch===undefined?{}:{quotaEpoch:copyCodexQuotaEpoch(sample.quotaEpoch)!})};
    const rows=counters(sample,inputs),previous=this.baseline,last=this.lastObserved;
    if(!rows){this.reset();return undefined;}
    const next:Baseline={sample:{...sample},price:pricingVersion,rows};
    const runKey=this.runKey(sample,pricingVersion);
    const replace=(restore=false)=>{this.baseline=next;this.lastObserved={...sample};
      this.accumulated=restore&&runKey!==undefined?this.runs.get(runKey):undefined;
      if(!restore&&runKey!==undefined)this.runs.delete(runKey);return undefined;};
    const switched=previous!==undefined&&(previous.sample.accountScopeKey!==sample.accountScopeKey||
      previous.sample.sourceScopeKey!==sample.sourceScopeKey||previous.price!==pricingVersion);
    if(!previous||switched)return replace(!last||sample.requestedAt>last.observedAt);
    const sameEpoch=JSON.stringify(previous.sample.quotaEpoch)===JSON.stringify(sample.quotaEpoch);
    if(!previous||previous.sample.accountScopeKey!==sample.accountScopeKey||
      previous.sample.sourceScopeKey!==sample.sourceScopeKey||previous.price!==pricingVersion||
      !sameEpoch||
      Math.abs(previous.sample.resetAt-sample.resetAt)>300_000||
      !last||sample.requestedAt<=last.observedAt||
      sample.observedAt-last.observedAt>(sample.quotaEpoch===undefined?MAX_GAP:65*60_000)||
      sample.usedPercent<last.usedPercent||sample.usedPercent>=100)return replace();
    const gap=sample.observedAt-last.observedAt>MAX_GAP;
    this.lastObserved={...sample};
    const delta=sample.usedPercent-previous.sample.usedPercent;
    if(delta<1)return undefined; // accumulate against the original numeric baseline
    let usd=0,priced=0,total=0;
    const conflicting=new Set<string>();
    const witnesses=new Map<string,{percent:number;reset:number}>();
    const latestWitness=new Map<string,{percent:number;reset:number}>();
    for(const row of inputs.observations.filter(row=>row.provider==='codex'&&row.sourceKey&&
      row.observedAt>previous.sample.observedAt&&row.observedAt<=sample.observedAt).sort((a,b)=>a.observedAt-b.observedAt)){
      const prior=latestWitness.get(row.sourceKey!);
      const key=row.sourceKey+'|'+row.observedAt,old=witnesses.get(key);
      if(!finite(row.usedPercent)||row.usedPercent>100||!finite(row.resetAt)||
        row.flags?.some(flag=>flag==='account-ambiguous'||flag==='clock-anomaly')||
        (prior&&row.usedPercent<prior.percent)||
        (old&&(old.percent!==row.usedPercent||Math.abs(old.reset-row.resetAt)>300_000))||
        Math.abs(row.resetAt-(sample.quotaEpoch?.resetAnchorAt??sample.resetAt))>300_000||row.usedPercent<previous.sample.usedPercent||
        row.usedPercent>sample.usedPercent)conflicting.add(row.sourceKey!);
      witnesses.set(key,{percent:row.usedPercent,reset:row.resetAt});
      latestWitness.set(row.sourceKey!,{percent:row.usedPercent,reset:row.resetAt});
    }
    for(const [key,current] of rows){
      const before=previous.rows.get(key);
      if(!current.valid||current.witness<=previous.sample.observedAt||
        current.percent<previous.sample.usedPercent)continue;
      if(conflicting.has(key))continue;
      if(before){
        if(!before.valid||current.percent<before.percent||current.usd<before.usd||
          current.priced<before.priced||current.total<before.total)continue;
      }else if(current.first<=previous.sample.observedAt)continue; // backfill is not new usage
      const d=current.usd-(before?.usd??0),p=current.priced-(before?.priced??0),t=current.total-(before?.total??0);
      if(p>t||d<0||p<0||t<0)continue;
      usd+=d;priced+=p;total+=t;
    }
    this.baseline=next;
    if(!(usd>0&&total>0&&finite(usd)))return undefined;
    const run=this.accumulated??{from:previous.sample.observedAt,usd:0,priced:0,total:0,delta:0,gap:false};
    const accumulated={from:run.from,usd:run.usd+usd,priced:run.priced+priced,total:run.total+total,delta:run.delta+delta,
      gap:run.gap||gap||sample.observedAt-previous.sample.observedAt>MAX_GAP};
    const full=accumulated.usd/(accumulated.delta/100);
    if(!finite(full)||full<=0||full>1e12||!finite(accumulated.total)||!finite(accumulated.priced)){
      this.accumulated=undefined;return undefined;
    }
    this.accumulated=accumulated;
    if(runKey!==undefined){this.runs.delete(runKey);this.runs.set(runKey,accumulated);
      if(this.runs.size>64)this.runs.delete(this.runs.keys().next().value!);}
    const coverage=Math.min(1,accumulated.priced/accumulated.total);
    return {provider:'codex',accountScopeKey:sample.accountScopeKey,windowStart:(sample.quotaEpoch?.resetAnchorAt??sample.resetAt)-WEEK,
      resetAt:sample.resetAt,observedAt:sample.observedAt,estimatedAt:sample.observedAt,
      usedEquivalentUsd:accumulated.usd,fullEquivalentUsd:full,unusedEquivalentUsd:full*(1-sample.usedPercent/100),
      utilizationPercent:sample.usedPercent,pricingCoverage:coverage,method:'account-delta-v1',
      calibrationStart:accumulated.from,
      ...(sample.quotaEpoch===undefined?{}:{quotaEpoch:copyCodexQuotaEpoch(sample.quotaEpoch)!}),
      flags:['account-unattributed','boundary-uncertain',...(accumulated.gap?['counter-change' as const]:[]),
        ...(coverage<1?['partial-pricing' as const]:[])]};
  }
}
