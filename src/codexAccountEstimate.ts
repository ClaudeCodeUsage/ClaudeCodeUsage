import type {LocalWeeklyEstimate} from './weeklyEstimate';
import type {WeeklyValueInputs} from './weeklyValue';
import type {CodexQuotaCheckpoint} from './providers/codex/codexQuotaCheckpoints';
import {CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT} from './providers/codex/codexQuotaCheckpoints';
import {copyCodexQuotaEpoch, codexQuotaEpochFitsObservation, CodexQuotaEpoch} from './codexQuotaEpoch';
import {CodexCalibrationPricebook, copyCodexCalibrationPricebook, copyCodexCalibrationEvidence} from './codexCalibrationEvidence';
import {createHash} from 'node:crypto';
import {isCodexCalibrationCensus, CodexCalibrationCensus} from './providers/codex/codexCalibrationCensus';
import type { CodexOfficialQuotaSnapshot } from './providers/codex/codexOfficialQuota';
import { CodexForwardAccountEstimator } from './codexForwardAccountEstimate';

export interface OfficialQuotaSample extends CodexOfficialQuotaSnapshot {
  quotaEpoch?:CodexQuotaEpoch;
}
interface Bucket {usd:number;priced:number;total:number;last:number}
interface Counter {usd:number;priced:number;total:number;first:number;last:number;percent:number;reset:number;witness:number;valid:boolean;buckets:Map<number,Bucket>;
  source?:string;components?:Map<string,readonly number[]>}
interface Baseline {sample:OfficialQuotaSample;price:string;rows:Map<string|symbol,Counter>;pricebook?:CodexCalibrationPricebook;scope:string;census?:CodexCalibrationCensus}
interface Accumulated {account:string;from:number;usd:number;priced:number;total:number;delta:number;gap:boolean;intervals:number}
const HEX=/^[a-f0-9]{64}$/,WEEK=604_800_000,MAX_GAP=300_000,MAX_SOURCES=16_384;
const UNKEYED=Symbol('unkeyed-local-usage');
function finite(x:number){return Number.isFinite(x)&&x>=0;}
function valid(s:OfficialQuotaSample){return HEX.test(s.accountScopeKey)&&HEX.test(s.sourceScopeKey)&&
  [s.observedAt,s.requestedAt,s.resetAt].every(t=>Number.isSafeInteger(t)&&t>0)&&
  s.requestedAt<=s.observedAt&&s.observedAt-s.requestedAt<=30_000&&
  s.resetAt>s.observedAt&&s.resetAt-s.observedAt<=WEEK&&finite(s.usedPercent)&&s.usedPercent<=100&&
  (s.quotaEpoch===undefined||(copyCodexQuotaEpoch(s.quotaEpoch)!==undefined&&
    codexQuotaEpochFitsObservation(s.quotaEpoch,s.observedAt,s.resetAt)));}
function counters(s:OfficialQuotaSample,inputs:WeeklyValueInputs):Map<string|symbol,Counter>|undefined {
  if(inputs.localHistoryComplete!==true)return undefined;
  const result=new Map<string|symbol,Counter>();
  for(const row of inputs.usage){
    const first=row.intervalStart??row.timestamp,last=row.intervalEnd??row.timestamp;
    if(last>s.observedAt||last<s.resetAt-WEEK-300_000)continue;
    if(![first,last,row.timestamp,row.equivalentUsd,row.pricedTokens,row.totalTokens].every(finite)||
      first>last||row.timestamp<first||row.timestamp>last||row.pricedTokens>row.totalTokens||
      (row.equivalentUsd>0&&row.pricedTokens===0))return undefined;
    const key=row.sourceKey||UNKEYED;
    const c=result.get(key)??{usd:0,priced:0,total:0,first,last,percent:0,reset:0,witness:0,valid:false,buckets:new Map<number,Bucket>()};
    const bucket=c.buckets.get(first)??{usd:0,priced:0,total:0,last};
    bucket.usd+=row.equivalentUsd;bucket.priced+=row.pricedTokens;bucket.total+=row.totalTokens;
    bucket.last=Math.max(bucket.last,last);c.buckets.set(first,bucket);
    c.usd+=row.equivalentUsd;c.priced+=row.pricedTokens;c.total+=row.totalTokens;
    if(![c.usd,c.priced,c.total].every(finite)||c.usd>1e12)return undefined;
    c.first=Math.min(c.first,first);c.last=Math.max(c.last,last);result.set(key,c);
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
function invalidComponentDelta(before:ReadonlyMap<string,readonly number[]>,after:ReadonlyMap<string,readonly number[]>):boolean {
  for(const model of new Set([...before.keys(),...after.keys()])){
    const old=before.get(model)??[0,0,0,0],next=after.get(model)??[0,0,0,0];
    const delta=next.map((value,index)=>value-old[index]);
    if(delta.some(value=>value<0)||delta[1]>delta[0]||delta[3]>delta[2])return true;
  }
  return false;
}
/** The file/segment key is runtime-only, not an account identifier. Separate
 * v2 baseline-line receipts are deliberately outside these cumulative counters;
 * a new segment still requires a fresh official monetary baseline. */
function checkpointCounters(s:OfficialQuotaSample,inputs:WeeklyValueInputs,book:CodexCalibrationPricebook|undefined,from=s.observedAt):{
  rows:Map<string|symbol,Counter>;observations:WeeklyValueInputs['observations'];incomplete:boolean;
}|undefined {
  const time=(n:number)=>Number.isSafeInteger(n)&&n>0;
  const incompleteResets=inputs.codexQuotaIncompleteResets,ranges=inputs.codexQuotaIncompleteRanges;
  if(ranges!==undefined&&(!Array.isArray(ranges)||ranges.some(range=>!range||
    !Number.isSafeInteger(range.from)||range.from<0||!Number.isSafeInteger(range.through)||range.through<0||
    range.from>range.through||(range.resetAt!==undefined&&!time(range.resetAt)))))return undefined;
  // Precise activity ranges supersede coarse whole-reset missing-history flags.
  if(ranges===undefined&&incompleteResets!==undefined&&(!Array.isArray(incompleteResets)||
    incompleteResets.some(reset=>!time(reset)||Math.abs(reset-s.resetAt)<=300_000)))return undefined;
  // Undefined ranges mean an omission cannot be dated or the manifest is not
  // verified. A coarse reset list cannot authorize a false global census.
  if(inputs.localHistoryComplete!==true||
    (inputs.codexQuotaCheckpointsComplete!==true&&!(inputs.codexQuotaCheckpointsComplete===false&&ranges!==undefined))||
    !Array.isArray(inputs.codexQuotaCheckpoints)||inputs.codexQuotaCheckpoints.length>CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT||!book)return undefined;
  let incomplete=from<s.observedAt&&(ranges?.some(range=>
    (range.resetAt===undefined||Math.abs(range.resetAt-s.resetAt)<=300_000)&&range.through>from&&range.from<=s.observedAt)??false);
  const rates=new Map(book.rates.map(rate=>[rate.model,rate]));
  const rows=new Map<string|symbol,Counter>(),observations:WeeklyValueInputs['observations']=[];
  const points:CodexQuotaCheckpoint[]=[];
  for(const row of inputs.codexQuotaCheckpoints){
    if(ranges!==undefined||incompleteResets!==undefined){
      if(!row||!time(row.resetAt))return undefined;
      // Retained incomplete rows in other known windows do not poison this
      // independently complete window; reset matching never identifies an account.
      if(Math.abs(row.resetAt-s.resetAt)>300_000)continue;
    }
    if(!row||!time(row.through))return undefined;
    // A future checkpoint is not evidence available at this official sample.
    if(row.through>s.observedAt||row.through<s.resetAt-WEEK-300_000)continue;
    if(typeof row.sourceKey!=='string'||!row.sourceKey||row.sourceKey.length>256||
      !Number.isSafeInteger(row.segment)||row.segment<0||!time(row.from)||row.from>row.through||
      !time(row.resetAt)||row.resetAt<=row.through||!finite(row.usedPercent)||row.usedPercent>100||
      typeof row.baseline!=='boolean'||typeof row.complete!=='boolean'||(row.complete!==true&&ranges===undefined)||
      !row.byModel||typeof row.byModel!=='object'||Array.isArray(row.byModel))return undefined;
    points.push(row);
  }
  points.sort((a,b)=>a.through-b.through||Number(b.baseline)-Number(a.baseline));
  const incompleteSegments=new Set(points.filter(row=>!row.complete).map(row=>JSON.stringify([row.sourceKey,row.segment])));
  const latestSegment=new Map<string,number>();
  for(const row of points){
    const key=JSON.stringify([row.sourceKey,row.segment]),before=rows.get(key);
    if(row.segment<(latestSegment.get(row.sourceKey)??-1))return undefined;
    latestSegment.set(row.sourceKey,row.segment);
    if(incompleteSegments.has(key)){
      if(row.through>from)incomplete=true;
      continue;
    }
    const models=Object.entries(row.byModel);
    if(models.length>16||(row.baseline&&(row.from!==row.through||models.length!==0))||
      (!before&&!row.baseline)||(before&&(row.baseline||before.first!==row.from||before.reset!==row.resetAt||
        row.usedPercent<before.percent))) {
      // Repeated identical baseline rows are harmless.
      if(!(before&&row.baseline&&row.from===row.through&&row.from===before.first&&row.through===before.last&&
        row.usedPercent===before.percent&&row.resetAt===before.reset&&models.length===0&&before.total===0))return undefined;
    }
    let usd=0,priced=0,total=0;
    const components=new Map<string,readonly number[]>();
    for(const [model,tokens] of models){
      if(!tokens||typeof tokens!=='object')return undefined;
      const input=tokens.inputTotal,cached=tokens.cachedInput??0,output=tokens.outputTotal,reasoning=tokens.reasoningOutput??0;
      if(![input,cached,output,reasoning,input+output].every(n=>Number.isSafeInteger(n)&&n>=0)||cached>input||reasoning>output||
        (tokens.sourceTotal!==undefined&&tokens.sourceTotal!==input+output)||
        (tokens.cacheWriteInput!==undefined&&tokens.cacheWriteInput!==0))return undefined;
      components.set(model,[input,cached,output,reasoning]);
      total+=input+output;
      const rate=rates.get(model);
      if(rate){usd+=(input-cached)*rate.input+cached*rate.cachedInput+output*rate.output;priced+=input+output;}
    }
    if(![usd,priced,total].every(finite)||usd>1e12||!Number.isSafeInteger(total)||
      (before?.components&&invalidComponentDelta(before.components,components))||
      (before&&before.last===row.through&&(before.percent!==row.usedPercent||before.usd!==usd||before.total!==total)))return undefined;
    rows.set(key,{usd,priced,total,first:row.from,last:row.through,percent:row.usedPercent,reset:row.resetAt,
      witness:row.through,valid:Math.abs(row.resetAt-(s.quotaEpoch?.resetAnchorAt??s.resetAt))<=300_000&&row.usedPercent<=s.usedPercent,
      buckets:new Map([[row.from,{usd,priced,total,last:row.through}]]),source:row.sourceKey,components});
    observations.push({provider:'codex',seriesKey:'codex',sourceKey:key,observedAt:row.through,
      resetAt:row.resetAt,usedPercent:row.usedPercent});
    if(rows.size>MAX_SOURCES)return undefined;
  }
  return {rows,observations,incomplete};
}
/** Known historical revisions are not live usage. Aggregate buckets cannot
 * establish request ownership or exact event timing; retain that warning. */
function historicalRevision(before:Counter,current:Counter,after:number):boolean {
  for(const [first,old] of before.buckets){
    const next=current.buckets.get(first);
    if(!next||next.last<old.last)return true;
    if((old.last<before.last||next.last<=after)&&
      (next.usd!==old.usd||next.priced!==old.priced||next.total!==old.total))return true;
  }
  return [...current.buckets.keys()].some(first=>first<=after&&!before.buckets.has(first));
}

/** A quota-identified, local incremental PROXY, not proof of request/account
 * ownership or a complete cross-device amount. No I/O or history relabelling.
 * Each account/epoch retains only admitted intervals; switches establish fresh
 * monetary baselines; blur/gaps retain admitted runs, while explicit reset,
 * failure, source/index/rate invalidation and restart retire them.
 */
export class CodexAccountEstimator {
  private readonly forward = new CodexForwardAccountEstimator();
  private forwardMode = false;
  private baseline?:Baseline;
  private lastObserved?:OfficialQuotaSample;
  private accumulated?:Accumulated;
  // Survives blur/gap baseline retirement so a revoked source/rate context
  // cannot resurrect an older run on S-T-S, including while no baseline exists.
  private evidenceContext?:string;
  private readonly runs=new Map<string,Accumulated>();
  private readonly seenCensuses=new WeakSet<object>();
  private runKey(sample:OfficialQuotaSample,price:string,pricebook:CodexCalibrationPricebook|undefined,scope:string):string|undefined {
    return sample.quotaEpoch===undefined?undefined:JSON.stringify([sample.accountScopeKey,sample.sourceScopeKey,price,sample.quotaEpoch,pricebook,scope]);
  }
  breakContinuity():void{this.baseline=undefined;this.lastObserved=undefined;this.accumulated=undefined;this.forward.breakContinuity();}
  reset():void{this.breakContinuity();this.runs.clear();this.evidenceContext=undefined;this.forward.reset();this.forwardMode=false;}
  /** Durable clearing retires affected runtime sums in other live instances. */
  invalidateThrough(account:string,through:number):void{
    if(!finite(through))return;
    this.forward.invalidateThrough(account,through);
    for(const [key,run] of this.runs)if(run.account===account&&run.from<=through)this.runs.delete(key);
    if(this.baseline?.sample.accountScopeKey===account&&
      (this.baseline.sample.observedAt<=through||(this.accumulated?.from??Infinity)<=through))this.breakContinuity();
  }
  observe(sample:OfficialQuotaSample,inputs:WeeklyValueInputs,pricingVersion:string):LocalWeeklyEstimate|undefined {
    if(inputs.codexForwardCalibration!==undefined){
      // A distinct producer proof authorizes forward intervals, not a relaxed
      // historical-completeness flag or a restored persisted baseline.
      this.baseline=undefined;this.lastObserved=undefined;this.accumulated=undefined;
      this.runs.clear();this.evidenceContext=undefined;this.forwardMode=true;
      return this.forward.observe(sample,inputs.codexForwardCalibration,inputs.calibrationPricebook);
    }
    if(this.forwardMode){this.forward.reset();this.forwardMode=false;}
    if(!valid(sample)){this.reset();return undefined;}
    sample={...sample,...(sample.quotaEpoch===undefined?{}:{quotaEpoch:copyCodexQuotaEpoch(sample.quotaEpoch)!})};
    const pricebook=copyCodexCalibrationPricebook(inputs.calibrationPricebook);
    if(inputs.calibrationPricebook!==undefined&&!pricebook){this.reset();return undefined;}
    const sourceScope=inputs.calibrationSourceScope;
    if(sourceScope!==undefined&&(!sourceScope.verified||!Array.isArray(sourceScope.excludedSourceKeys)||
      sourceScope.excludedSourceKeys.length>MAX_SOURCES||!sourceScope.excludedSourceKeys.every(key=>typeof key==='string'&&key.length>0&&key.length<=256))){this.reset();return undefined;}
    const excluded=new Set(sourceScope?.excludedSourceKeys??[]);
    const scope=createHash('sha256').update(JSON.stringify([...excluded].sort())).digest('hex');
    const census=inputs.codexCalibrationCensus;
    if(census!==undefined&&(!isCodexCalibrationCensus(census)||this.seenCensuses.has(census)||
      census.verifiedAt>sample.observedAt||sample.observedAt-census.verifiedAt>MAX_GAP)){
      this.reset();return undefined;
    }
    if(census){
      if(this.baseline&&census.verifiedAt<=this.baseline.sample.observedAt){this.reset();return undefined;}
      this.seenCensuses.add(census);
    }
    const incompleteRanges=inputs.codexQuotaIncompleteRanges;
    const checkpointMode=inputs.codexQuotaCheckpoints!==undefined||inputs.codexQuotaCheckpointsComplete!==undefined||
      inputs.codexQuotaIncompleteResets!==undefined||incompleteRanges!==undefined||census!==undefined;
    // With an exact rate snapshot, a fetch timestamp is not a price change.
    // Legacy inputs without rates must still use the caller's version fence.
    const price=JSON.stringify(pricebook??pricingVersion);
    const censusScope=census&&createHash('sha256').update(JSON.stringify([census.indexGeneration,
      census.sources.map(source=>[source.sourceKey,source.canonical,source.eligible,source.continuity])])).digest('hex');
    const context=JSON.stringify([sample.sourceScopeKey,price,scope,checkpointMode,censusScope]);
    if(this.evidenceContext!==undefined&&this.evidenceContext!==context){this.breakContinuity();this.runs.clear();}
    this.evidenceContext=context;
    const previous=this.baseline,last=this.lastObserved;
    const waived=new Set<string>(),changedSources=new Set<string>();
    const scopedRanges:NonNullable<WeeklyValueInputs['codexQuotaIncompleteRanges']>[number][]=[];
    let censusBlocked=false;
    if(census&&previous?.census){
      const oldSources=new Map(previous.census.sources.map(source=>[source.sourceKey,source]));
      for(const source of census.sources){
        const before=oldSources.get(source.sourceKey);
        if(!before||source.continuity!==before.continuity||source.bytes<before.bytes){censusBlocked=true;continue;}
        if(source.uncertain&&source.revision===before.revision&&source.activityThrough!==null&&
          source.activityThrough<=previous.sample.observedAt){waived.add(source.sourceKey);continue;}
        if(source.uncertain&&(source.ranges===undefined||source.activityThrough===null||source.activityThrough>sample.observedAt))censusBlocked=true;
        if(source.ranges)scopedRanges.push(...source.ranges);
        if(source.revision!==before.revision){
          if(!source.eligible||source.bytes<=before.bytes)censusBlocked=true;
          // Fully parsed metadata may change physical revision and root-line
          // time without adding any recorded USD. This exception never applies
          // to an uncertain source, future activity, or changed numeric proof.
          const knownZero=!source.uncertain&&!before.uncertain&&source.eligible&&before.eligible&&
            source.usageRevision===before.usageRevision&&source.usageThrough!==null&&
            source.usageThrough<=previous.sample.observedAt&&source.activityThrough!==null&&
            source.activityThrough<=sample.observedAt;
          if(!knownZero)changedSources.add(source.sourceKey);
        }else if(source.uncertain)censusBlocked=true; // known future/newly eligible activity is never a static waiver
      }
      if(oldSources.size!==census.sources.length)censusBlocked=true;
    }
    // Census authority is runtime-only. Anonymous merged ranges remain intact
    // for historical consumers; only this official incremental pair uses the
    // producer's source-local ranges and proven constant unknown histories.
    const numericInputs=census?{...inputs,codexQuotaIncompleteRanges:scopedRanges}:inputs;
    const paired=checkpointMode?checkpointCounters(sample,numericInputs,pricebook,previous?.sample.observedAt):undefined;
    const rows=checkpointMode?paired?.rows:counters(sample,inputs);
    const observations=checkpointMode?paired?.observations??[]:inputs.observations;
    if(!rows){this.reset();return undefined;}
    const next:Baseline={sample:{...sample},price,rows,scope,...(pricebook?{pricebook}:{}),...(census?{census}:{})};
    const runKey=this.runKey(sample,price,pricebook,scope);
    const replace=(restore=false)=>{this.baseline=next;this.lastObserved={...sample};
      this.accumulated=restore&&runKey!==undefined?this.runs.get(runKey):undefined;
      if(!restore&&runKey!==undefined)this.runs.delete(runKey);return undefined;};
    const switched=previous!==undefined&&(previous.sample.accountScopeKey!==sample.accountScopeKey||
      previous.sample.sourceScopeKey!==sample.sourceScopeKey||previous.price!==price||
      JSON.stringify(previous.pricebook)!==JSON.stringify(pricebook)||previous.scope!==scope);
    // Eligibility/source/rate invalidation is not A-B-A continuity. Returning
    // to an old signature cannot resurrect evidence whose authority was revoked.
    if(previous&&(previous.sample.sourceScopeKey!==sample.sourceScopeKey||previous.price!==price||
      previous.scope!==scope||JSON.stringify(previous.pricebook)!==JSON.stringify(pricebook)))this.runs.clear();
    if(!previous||switched)return replace(!last||sample.requestedAt>last.observedAt);
    const sameEpoch=JSON.stringify(previous.sample.quotaEpoch)===JSON.stringify(sample.quotaEpoch);
    if(!previous||previous.sample.accountScopeKey!==sample.accountScopeKey||
      previous.sample.sourceScopeKey!==sample.sourceScopeKey||previous.price!==price||
      !sameEpoch||
      Math.abs(previous.sample.resetAt-sample.resetAt)>300_000||
      !last||sample.requestedAt<=last.observedAt||
      sample.usedPercent<last.usedPercent||sample.usedPercent>=100)return replace();
    // The missing interval supplies neither money nor percentage points. Keep
    // previously admitted evidence, then measure only after this fresh baseline.
    if(sample.observedAt-last.observedAt>(sample.quotaEpoch===undefined?MAX_GAP:65*60_000))return replace(true);
    const gap=sample.observedAt-last.observedAt>MAX_GAP;
    this.lastObserved={...sample};
    if(census){
      for(const source of census.sources)if(changedSources.has(source.sourceKey)){
        const matching=[...rows.values()].filter(row=>row.source===source.sourceKey);
        if(source.activityThrough===null||source.activityThrough>sample.observedAt||source.usageThrough===null||
          !matching.some(row=>row.valid&&row.witness>previous.sample.observedAt&&row.witness>=source.usageThrough!))censusBlocked=true;
      }
    }
    if(censusBlocked||paired?.incomplete){this.baseline=next;return undefined;}
    const delta=sample.usedPercent-previous.sample.usedPercent;
    if(delta<1)return undefined; // accumulate against the original numeric baseline
    const replayedBaseline=checkpointMode?checkpointCounters(previous.sample,numericInputs,pricebook):undefined;
    if(checkpointMode&&!replayedBaseline){this.baseline=next;return undefined;}
    let usd=0,priced=0,total=0,linkedSources=0,incomplete=false;
    const conflicting=new Set<string>();
    const witnesses=new Map<string,{percent:number;reset:number}>();
    const latestWitness=new Map<string,{percent:number;reset:number}>();
    for(const row of observations.filter(row=>row.provider==='codex'&&row.sourceKey&&
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
      if(checkpointMode){
        if(!before){
          // A newly seen baseline/segment may have discarded request tokens.
          // Purely pre-baseline backfill is static history, never a live delta.
          if(current.last>previous.sample.observedAt)incomplete=true;
          continue;
        }
        if(current.first!==before.first||!before.components||!current.components||invalidComponentDelta(before.components,current.components)){
          incomplete=true;continue;
        }
        const historical=replayedBaseline?.rows.get(key);
        if(historical?.components){
          // Newly visible pre-official usage is backfill, not this interval's
          // increment. Compacted older endpoints may still be below the exact
          // counter retained in memory, which remains a valid baseline.
          if(historical.first!==before.first||historical.reset!==before.reset||
            invalidComponentDelta(historical.components,before.components)||
            (historical.last>=before.last&&invalidComponentDelta(before.components,historical.components))){
            incomplete=true;continue;
          }
        }
      }
      const d=current.usd-(before?.usd??0),p=current.priced-(before?.priced??0),t=current.total-(before?.total??0);
      // Static excluded/foreign history is harmless. Changed sources cannot be
      // silently dropped from the numerator of the full official quota delta.
      if(d===0&&p===0&&t===0)continue;
      const revised=before?historicalRevision(before,current,previous.sample.observedAt):current.first<=previous.sample.observedAt;
      if(typeof key!=='string'||excluded.has(current.source??key)||!current.valid||current.witness<=previous.sample.observedAt||
        current.percent<previous.sample.usedPercent||conflicting.has(key)||
        (before&&(!before.valid||current.percent<before.percent))||revised||p!==t||d<0||p<0||t<0){
        incomplete=true;continue;
      }
      usd+=d;priced+=p;total+=t;
      if(d>0)linkedSources++;
    }
    for(const [key,before] of previous.rows){
      if(rows.has(key)||(before.usd===0&&before.total===0))continue;
      const outsideScopedWindow=checkpointMode&&(incompleteRanges!==undefined||inputs.codexQuotaIncompleteResets!==undefined)&&
        Math.abs(before.reset-sample.resetAt)>300_000;
      const datedStaticGap=waived.has(before.source??String(key))||checkpointMode&&incompleteRanges?.some(range=>
        (range.resetAt===undefined||Math.abs(range.resetAt-sample.resetAt)<=300_000)&&
        range.from<=before.last&&range.through>=before.last&&range.through<=previous.sample.observedAt);
      if(!outsideScopedWindow&&!datedStaticGap)incomplete=true;
    }
    this.baseline=next;
    if(incomplete||!(usd>0&&total>0&&finite(usd)))return undefined;
    const run=this.accumulated??{account:sample.accountScopeKey,from:previous.sample.observedAt,usd:0,priced:0,total:0,delta:0,gap:false,intervals:0};
    const accumulated={account:sample.accountScopeKey,from:run.from,usd:run.usd+usd,priced:run.priced+priced,total:run.total+total,delta:run.delta+delta,
      gap:run.gap||gap||sample.observedAt-previous.sample.observedAt>MAX_GAP,intervals:run.intervals+1};
    const full=accumulated.usd/(accumulated.delta/100);
    if(!finite(full)||full<=0||full>1e12||!finite(accumulated.total)||!finite(accumulated.priced)){
      this.accumulated=undefined;return undefined;
    }
    const calibrationEvidence=pricebook&&sample.quotaEpoch?copyCodexCalibrationEvidence({schemaVersion:1,methodVersion:1,pricebook,
      interval:{from:previous.sample.observedAt,through:sample.observedAt,requestedFrom:previous.sample.requestedAt,
        requestedThrough:sample.requestedAt,percentFrom:previous.sample.usedPercent,percentThrough:sample.usedPercent,
        deltaUsd:usd,pricedTokens:priced,totalTokens:total,linkedSources,excludedSources:excluded.size,
        continuityGap:gap||sample.observedAt-previous.sample.observedAt>MAX_GAP},
      accumulated:{intervals:accumulated.intervals,deltaPercent:accumulated.delta,deltaUsd:accumulated.usd,
        pricedTokens:accumulated.priced,totalTokens:accumulated.total}}):undefined;
    if(pricebook&&sample.quotaEpoch&&!calibrationEvidence){this.reset();return undefined;}
    this.accumulated=accumulated;
    if(runKey!==undefined){this.runs.delete(runKey);this.runs.set(runKey,accumulated);
      if(this.runs.size>64)this.runs.delete(this.runs.keys().next().value!);}
    const coverage=Math.min(1,accumulated.priced/accumulated.total);
    return {provider:'codex',accountScopeKey:sample.accountScopeKey,
      windowStart:sample.quotaEpoch?.startLowerAt ?? sample.quotaEpoch?.startedAt ?? sample.resetAt-WEEK,
      resetAt:sample.resetAt,observedAt:sample.observedAt,estimatedAt:sample.observedAt,
      usedEquivalentUsd:accumulated.usd,fullEquivalentUsd:full,unusedEquivalentUsd:full*(1-sample.usedPercent/100),
      utilizationPercent:sample.usedPercent,pricingCoverage:coverage,method:'account-delta-v1',
      calibrationStart:accumulated.from,
      ...(calibrationEvidence?{calibrationEvidence}:{}),
      ...(sample.quotaEpoch===undefined?{}:{quotaEpoch:copyCodexQuotaEpoch(sample.quotaEpoch)!}),
      flags:['account-unattributed','boundary-uncertain',...(excluded.size?['partial-history' as const]:[]),...(accumulated.gap?['counter-change' as const]:[]),
        ...(coverage<1?['partial-pricing' as const]:[])]};
  }
}
