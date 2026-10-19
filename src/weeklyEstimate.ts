import type { UsageProvider } from './providers/providerTypes';
import type { CodexQuotaEpoch } from './codexQuotaEpoch';
import type { CodexCalibrationEvidence } from './codexCalibrationEvidence';
import type { WeeklyEquivalentUsage, WeeklyQuotaObservation, WeeklyValueInputs, WeeklyValuePoint } from './weeklyValue';

const WEEK=604_800_000, RESET_TOLERANCE=300_000;
export type WeeklyEstimateMethod='legacy-prefix-ratio'|'rough-prefix-v2'|'series-prefix-v1'|'account-delta-v1'|'paired-delta'|'owned-window';
export type WeeklyEstimateFlag='account-unattributed'|'boundary-uncertain'|'partial-pricing'|
  'stale-observation'|'counter-change'|'reconstructed'|'partial-history';
export interface LocalWeeklyEstimate {
  provider:UsageProvider; windowStart:number; resetAt:number; observedAt:number; estimatedAt:number;
  usedEquivalentUsd:number; fullEquivalentUsd:number|null; unusedEquivalentUsd:number|null;
  utilizationPercent:number|null; pricingCoverage:number; method:WeeklyEstimateMethod;
  flags:WeeklyEstimateFlag[];
  /** Excluded from this sample's numerator; overlapping samples' diagnostics must not be summed. */
  unlinkedEquivalentUsd?:number;
  /** Number of local sources linked to this counter sample, never a number of accounts. */
  linkedSourceCount?:number;
  /** UI-safe local account ordinal supplied by a separate account-calibration owner. */
  accountNumber?:number;
  /** INTERNAL machine-local HMAC; must be removed before HTML/export. Not usage-ownership proof. */
  accountScopeKey?:string;
  quotaEpoch?:CodexQuotaEpoch;
  calibrationStart?:number;
  calibrationEvidence?:CodexCalibrationEvidence;
  /** Conditional time/percentage measurement range, NOT an account-capacity confidence interval. */
  fullRange?:{lower:number;upper:number};
}

function validObservation(row:WeeklyQuotaObservation,provider:UsageProvider,now:number):boolean {
  return row.provider===provider&&Number.isFinite(row.observedAt)&&row.observedAt>0&&row.observedAt<=now&&
    Number.isFinite(row.resetAt)&&row.resetAt>row.observedAt&&row.observedAt>=row.resetAt-WEEK&&
    Number.isFinite(row.usedPercent)&&row.usedPercent>=0&&row.usedPercent<=100;
}
function temporalBounds(row:WeeklyEquivalentUsage):{start:number;end:number}|undefined {
  const start=row.intervalStart??row.timestamp,end=row.intervalEnd??row.timestamp;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>end||!Number.isFinite(row.timestamp)||
    row.timestamp<start||row.timestamp>end)return undefined;
  return {start,end};
}
function rowBounds(row:WeeklyEquivalentUsage):{start:number;end:number}|undefined {
  const bounds=temporalBounds(row);
  if(!bounds||!Number.isFinite(row.equivalentUsd)||row.equivalentUsd<0||
    !Number.isFinite(row.pricedTokens)||!Number.isFinite(row.totalTokens)||
    row.pricedTokens<0||row.totalTokens<row.pricedTokens||
    (row.equivalentUsd>0&&row.pricedTokens===0))return undefined;
  return bounds;
}
interface ObservationGroup { resetAt:number; firstReset:number; latestObserved:number; rows:WeeklyQuotaObservation[] }
function hasSource(row:{sourceKey?:string}):boolean {
  return typeof row.sourceKey==='string'&&row.sourceKey.length>0;
}

/** Snapshot-local estimates. This never changes token history, identifies an
 * account, or manufactures a value for an unobserved cycle. Each result is an
 * as-of comparison at the ORIGINAL quota sample, not a live remaining balance.
 * Without independent ownership proof every result stays explicitly rough.
 * V2 explicitly approximates crossing aggregates by uniform time overlap.
 * This affects only the conversion numerator, never the unique usage ledger.
 */
export function buildLocalWeeklyEstimates(
  provider:UsageProvider,inputs:WeeklyValueInputs,options:{now?:number;limit?:number}={},
):LocalWeeklyEstimate[] {
  const now=options.now??Date.now();
  if(!Number.isFinite(now))return [];
  const observations=inputs.observations.filter(row=>validObservation(row,provider,now))
    .sort((a,b)=>a.resetAt-b.resetAt||a.observedAt-b.observedAt);
  const groups:ObservationGroup[]=[];
  for(const row of observations){
    const group=groups.find(g=>Math.abs(g.firstReset-row.resetAt)<=RESET_TOLERANCE&&
      g.rows[0].seriesKey===row.seriesKey&&g.rows[0].windowId===row.windowId);
    if(group){
      group.rows.push(row);
      if(row.observedAt>=group.latestObserved){group.latestObserved=row.observedAt;group.resetAt=row.resetAt;}
    }else groups.push({resetAt:row.resetAt,firstReset:row.resetAt,latestObserved:row.observedAt,rows:[row]});
  }
  // A source key joins local records only. A sample supports a possible prefix
  // inside its recorded quota window through its observation time. If multiple
  // counter groups can cover a row, its aggregate cannot locate a switch: omit
  // the entire row rather than splitting it between those counters. Use every
  // group before the display cap so hidden counters cannot become false proof.
  const sourceSamples=new Map<string,Array<{group:ObservationGroup;sample:WeeklyQuotaObservation}>>();
  if(provider==='codex')for(const group of groups)for(const sample of group.rows){
    if(!hasSource(sample))continue;
    const entries=sourceSamples.get(sample.sourceKey!)??[];
    entries.push({group,sample});sourceSamples.set(sample.sourceKey!,entries);
  }
  // One projection owns this cache. Model rows and selected groups share the
  // same source/interval proof, but no group objects survive into another call.
  const membershipCache=new Map<string,Map<string,ReadonlySet<ObservationGroup>>>();
  const noSource:ReadonlySet<ObservationGroup>=new Set();
  const memberships=(row:WeeklyEquivalentUsage,bounds:{start:number;end:number}):ReadonlySet<ObservationGroup>=>{
    if(!hasSource(row))return noSource;
    const source=row.sourceKey!,interval=`${bounds.start}:${bounds.end}`;
    let intervals=membershipCache.get(source);
    if(!intervals){intervals=new Map();membershipCache.set(source,intervals);}
    const cached=intervals.get(interval);
    if(cached)return cached;
    const matches=new Set<ObservationGroup>();
    for(const {group,sample} of sourceSamples.get(source)??[]){
      if(sample.resetAt>bounds.start&&sample.resetAt-WEEK<=bounds.end&&sample.observedAt>=bounds.start)matches.add(group);
    }
    intervals.set(interval,matches);
    return matches;
  };
  const selected=groups.sort((a,b)=>b.resetAt-a.resetAt||
    b.latestObserved-a.latestObserved)
    .slice(0,Math.min(64,Math.max(1,Math.floor(options.limit??12))));
  return selected.map(group=>{
    const samples=group.rows.slice().sort((a,b)=>a.observedAt-b.observedAt||a.usedPercent-b.usedPercent);
    let segment=0;
    for(let i=1;i<samples.length;i++){
      if(samples[i].usedPercent<samples[i-1].usedPercent)segment=i;
    }
    const active=samples.slice(segment);
    // Once saturated, later activity cannot improve this conversion sample.
    const latest=active.find(sample=>sample.usedPercent===100)??active[active.length-1];
    const resetAt=latest.resetAt,start=resetAt-WEEK;
    // The transition lies somewhere AFTER the old sample and at/before the
    // first lower-counter sample. None of that unobserved gap is a proven
    // prefix of the new counter. Start at its first observed baseline instead.
    const isolateSegment=provider==='codex'&&segment>0;
    const segmentStart=segment>0?Math.max(start,isolateSegment?active[0].observedAt:samples[segment-1].observedAt):start;
    // Source-less old history keeps its original explicitly unassigned rough
    // calculation. Concurrent keyed evidence prevents that fallback from
    // silently borrowing the other counter's numerator.
    const seriesMode=provider==='codex'&&observations.some(sample=>hasSource(sample)&&
      sample.resetAt>segmentStart&&sample.resetAt-WEEK<=latest.observedAt);
    const flags=new Set<WeeklyEstimateFlag>(['account-unattributed','reconstructed']);
    if(inputs.localHistoryComplete===false)flags.add('partial-history');
    if(samples.some(sample=>sample.observedAt<start))flags.add('boundary-uncertain');
    if(now-latest.observedAt>6*3_600_000)flags.add('stale-observation');
    if(samples.some((s,i)=>i>0&&(s.usedPercent<samples[i-1].usedPercent||
      (s.observedAt===samples[i-1].observedAt&&s.usedPercent!==samples[i-1].usedPercent)))||
      observations.some(other=>other.observedAt>=start&&other.observedAt<=latest.observedAt&&(
        Math.abs(other.resetAt-resetAt)>RESET_TOLERANCE||
        other.seriesKey!==latest.seriesKey||other.windowId!==latest.windowId
      ))||samples.some(s=>(s.flags??[]).some(f=>f==='account-ambiguous'||f==='clock-anomaly')))
      flags.add('counter-change');
    let amount=0,priced=0,total=0,invalid=false,unlinked=0;
    const linkedSources=new Set<string>();
    for(const row of inputs.usage){
      const timing=temporalBounds(row);
      if(timing&&(timing.end<segmentStart||timing.start>latest.observedAt||row.timestamp>now))continue;
      const bounds=rowBounds(row);
      if(!bounds){
        flags.add('boundary-uncertain');
        const matches=memberships(row,timing??{start:segmentStart,end:latest.observedAt});
        if(!seriesMode||(matches.size===1&&matches.has(group)))invalid=true;
        else flags.add('partial-history');
        continue;
      }
      if(bounds.end<segmentStart||bounds.start>latest.observedAt)continue;
      let weight=1;
      if(bounds.start!==bounds.end){
        const overlap=Math.max(0,Math.min(bounds.end,latest.observedAt)-Math.max(bounds.start,segmentStart));
        weight=overlap/(bounds.end-bounds.start);
        if(weight<1)flags.add('boundary-uncertain');
      }else if(segment>0&&bounds.start<=segmentStart){weight=0;}
      if(weight===0)continue;
      if(seriesMode){
        const matches=memberships(row,bounds);
        if(matches.size!==1||!matches.has(group)){
          unlinked+=row.equivalentUsd*weight;flags.add('partial-history');
          if(matches.size>1)flags.add('boundary-uncertain');
          continue;
        }
        linkedSources.add(row.sourceKey!);
      }
      amount+=row.equivalentUsd*weight;priced+=row.pricedTokens*weight;total+=row.totalTokens*weight;
    }
    const coverage=total>0?Math.min(1,priced/total):0;
    if(coverage<1)flags.add('partial-pricing');
    let full:number|null=null,method:WeeklyEstimateMethod=seriesMode?'series-prefix-v1':'rough-prefix-v2';
    let fullRange:LocalWeeklyEstimate['fullRange'],calibrationStart:number|undefined;
    let sampleAmount=amount;
    const measuredPercent=isolateSegment?latest.usedPercent-active[0].usedPercent:latest.usedPercent;
    if(!invalid&&amount>0&&measuredPercent>0){
      full=amount/(measuredPercent/100);
      if(segment>0&&segmentStart<latest.observedAt)calibrationStart=segmentStart;
    }
    if(!seriesMode){
      // Paired inference requires an explicit SAME window and finite documented
      // per-sample percentage error bounds; decimal formatting proves neither.
      const first=active[0];
      const delta=latest.usedPercent-first.usedPercent;
      const error=(first.percentageErrorBound??NaN)+(latest.percentageErrorBound??NaN);
      if(inputs.localHistoryComplete!==false&&segment===0&&active.length>1&&first.windowId&&first.windowId===latest.windowId&&
        first.observedAt>=start&&
        first.observedAt<latest.observedAt&&delta>0&&Number.isFinite(error)&&error>=0&&
        (first.percentageErrorBound??-1)>=0&&(latest.percentageErrorBound??-1)>=0&&
        delta>error&&delta>=10*Math.max(error,0.1)&&latest.usedPercent<100){
        let increment=0,pairPriced=0,pairTotal=0,exact=true;
        for(const row of inputs.usage){
          const timing=temporalBounds(row);
          if(timing&&(timing.end<=first.observedAt||timing.start>latest.observedAt||row.timestamp>now))continue;
          const b=rowBounds(row);
          if(!b||b.start<=first.observedAt||b.end>latest.observedAt){exact=false;continue;}
          increment+=row.equivalentUsd;pairPriced+=row.pricedTokens;pairTotal+=row.totalTokens;
        }
        const conflict=active.some((sample,index)=>index>0&&sample.observedAt<=latest.observedAt&&
          sample.observedAt===active[index-1].observedAt&&sample.usedPercent!==active[index-1].usedPercent)||
          observations.some(other=>other.observedAt>=first.observedAt&&other.observedAt<=latest.observedAt&&
          (Math.abs(other.resetAt-resetAt)>RESET_TOLERANCE||other.seriesKey!==latest.seriesKey||other.windowId!==latest.windowId||
            (other.flags??[]).some(flag=>flag==='clock-anomaly'||flag==='account-ambiguous')));
        if(exact&&!conflict&&pairTotal>0&&pairPriced===pairTotal&&increment>0){
            full=increment/(delta/100);method='paired-delta';
            calibrationStart=first.observedAt;sampleAmount=increment;
            fullRange={lower:increment/((delta+error)/100),upper:increment/((delta-error)/100)};
            flags.delete('partial-pricing');flags.delete('boundary-uncertain');flags.delete('counter-change');
        }
      }
    }
    if(full!==null&&(!Number.isFinite(full)||full<=0||full>1e12)){full=null;fullRange=undefined;}
    if(full!==null){
      const postObservation=inputs.usage.filter(row=>{const b=rowBounds(row);
        if(b===undefined||b.start<=latest.observedAt||b.end>now)return false;
        if(!seriesMode)return true;
        const matches=memberships(row,b);return matches.size===1&&matches.has(group);})
        .reduce((sum,row)=>sum+row.equivalentUsd,0);
      if(postObservation>full*(1-latest.usedPercent/100))flags.add('stale-observation');
    }
    return {provider,windowStart:start,resetAt,observedAt:latest.observedAt,estimatedAt:now,
      usedEquivalentUsd:sampleAmount,fullEquivalentUsd:full,
      // Always freeze unused at the same quota observation. Do not subtract
      // later local usage or infer final unused after an unobserved reset.
      unusedEquivalentUsd:full===null?null:full*(1-latest.usedPercent/100),
      utilizationPercent:latest.usedPercent,pricingCoverage:method==='paired-delta'?1:coverage,method,flags:[...flags],
      ...(provider==='codex'?{
        linkedSourceCount:seriesMode?linkedSources.size:0,
        ...((Number.isFinite(seriesMode?unlinked:sampleAmount)&&(seriesMode?unlinked:sampleAmount)<=1e12)?
          {unlinkedEquivalentUsd:seriesMode?unlinked:sampleAmount}:{}),
      }:{}),
      ...(fullRange?{fullRange}:{}),...(calibrationStart===undefined?{}:{calibrationStart}),};
  });
}

/** Match only the original reset and an eligible as-of sample, never a nearby
 * synthetic calendar bucket. Reusing a saved sample does not identify an account. */
export function weeklyEstimateForPoint(point:WeeklyValuePoint,entries:readonly LocalWeeklyEstimate[]):LocalWeeklyEstimate|undefined {
  const rank=(entry:LocalWeeklyEstimate)=>entry.method==='series-prefix-v1'?4:entry.method==='paired-delta'?3:entry.method==='rough-prefix-v2'?2:1;
  return entries.filter(entry=>entry.provider===point.provider&&Math.abs(entry.resetAt-point.resetAt)<=RESET_TOLERANCE&&
    entry.method!=='account-delta-v1'&&entry.accountNumber===undefined&&entry.accountScopeKey===undefined&&
    entry.observedAt>=entry.windowStart&&entry.observedAt<entry.resetAt&&entry.observedAt<=Date.now()&&
    (point.observedAt===undefined||(entry.observedAt<=point.observedAt&&entry.utilizationPercent===point.utilizationPercent))&&
    entry.fullEquivalentUsd!==null&&Number.isFinite(entry.fullEquivalentUsd)&&entry.fullEquivalentUsd>0&&
    entry.unusedEquivalentUsd!==null&&Number.isFinite(entry.unusedEquivalentUsd)&&entry.unusedEquivalentUsd>=0)
    .sort((a,b)=>b.observedAt-a.observedAt||rank(b)-rank(a)||b.estimatedAt-a.estimatedAt)[0];
}
