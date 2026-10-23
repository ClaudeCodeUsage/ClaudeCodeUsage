import type {ProviderTokenCounts} from './providers/providerTypes';
import type {CodexQuotaCheckpoint} from './providers/codex/codexQuotaCheckpoints';
import {copyCodexCalibrationPricebook, type CodexCalibrationPricebook} from './codexCalibrationEvidence';

type Models=Readonly<Record<string,ProviderTokenCounts>>;
type Row=Omit<CodexQuotaCheckpoint,'sourceKey'>;
export interface CodexWitnessSource {
  rows:readonly Row[];
  primaryByModel:Models;
  hasUnknownGap?:boolean;
}
/** All amounts are observed, priced local requests, not certified account use.
 * No IDs or raw source vectors leave this pure projection. Capacity is a
 * conditional USD/percentage extrapolation, never a guaranteed lower bound. */
export interface CodexWitnessCycle {
  schemaVersion:1; pricebook:CodexCalibrationPricebook; requestedThrough:number;
  cycleStartAt:number|null; cycleStartLowerAt:number|null; cycleEndAt:number; cycleEndLowerAt:number|null; closed:boolean;
  resetAt:number; from:number; through:number; percentFrom:number; percentThrough:number;
  knownUsd:number; knownTokens:number; unpricedTokens:number; pricingCoverage:number;
  deltaUsd:number; referenceCapacityUsd:number|null; partial:boolean;
  sources:number; segments:number; baselineMissing:boolean; counterConflict:boolean; unavailableSources:number;
}
/** Validate retained numeric evidence independently from any account claim. */
export function copyCodexWitnessCycle(value:unknown):CodexWitnessCycle|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const v=value as CodexWitnessCycle,book=copyCodexCalibrationPricebook(v.pricebook);
 if(v.schemaVersion!==1||!book||![v.resetAt,v.from,v.through,v.requestedThrough,v.cycleEndAt].every(time)||
  v.from>v.through||v.through>v.requestedThrough||v.through>=v.resetAt||v.cycleEndAt<=v.through||
  ![v.percentFrom,v.percentThrough,v.pricingCoverage].every(Number.isFinite)||v.percentFrom<0||v.percentFrom>100||v.percentThrough<0||v.percentThrough>100||
  v.pricingCoverage<0||v.pricingCoverage>1||![v.knownUsd,v.deltaUsd].every(n=>Number.isFinite(n)&&n>=0&&n<=1e12)||v.deltaUsd>v.knownUsd+1e-8||
  ![v.knownTokens,v.unpricedTokens,v.sources,v.segments,v.unavailableSources].every(count)||v.sources>16384||v.segments>8388608||
  ![v.partial,v.baselineMissing,v.counterConflict,v.closed].every(b=>typeof b==='boolean'))return;
 if(v.sources<1||v.segments<v.sources||v.knownUsd>0&&v.knownTokens===0||
  !v.partial&&(v.unpricedTokens>0||v.baselineMissing||v.counterConflict||v.unavailableSources>0))return;
 const nullable=(n:number|null)=>n===null||time(n);
 if(![v.cycleStartAt,v.cycleStartLowerAt,v.cycleEndLowerAt].every(nullable)||
  v.cycleStartAt!==null&&v.cycleStartAt>v.from||v.cycleStartLowerAt!==null&&(v.cycleStartAt===null||v.cycleStartLowerAt>v.cycleStartAt)||
  v.cycleEndLowerAt!==null&&v.cycleEndLowerAt>v.cycleEndAt)return;
 const tokens=v.knownTokens+v.unpricedTokens;
 if(!count(tokens)||Math.abs(v.pricingCoverage-(tokens?v.knownTokens/tokens:0))>1e-8)return;
 if(v.referenceCapacityUsd!==null){const dp=v.percentThrough-v.percentFrom;
  if(dp<5||v.baselineMissing||!Number.isFinite(v.referenceCapacityUsd)||v.referenceCapacityUsd<=0||v.referenceCapacityUsd>1e12||
   Math.abs(v.referenceCapacityUsd-v.deltaUsd/(dp/100))>1e-8*Math.max(1,v.referenceCapacityUsd))return;
 }
 return {schemaVersion:1,pricebook:book,requestedThrough:v.requestedThrough,cycleStartAt:v.cycleStartAt,
  cycleStartLowerAt:v.cycleStartLowerAt,cycleEndAt:v.cycleEndAt,cycleEndLowerAt:v.cycleEndLowerAt,closed:v.closed,
  resetAt:v.resetAt,from:v.from,through:v.through,percentFrom:v.percentFrom,percentThrough:v.percentThrough,
  knownUsd:v.knownUsd,knownTokens:v.knownTokens,unpricedTokens:v.unpricedTokens,pricingCoverage:v.pricingCoverage,
  deltaUsd:v.deltaUsd,referenceCapacityUsd:v.referenceCapacityUsd,partial:v.partial,sources:v.sources,segments:v.segments,
  baselineMissing:v.baselineMissing,counterConflict:v.counterConflict,unavailableSources:v.unavailableSources};
}
export interface CodexWitnessCoverage {
  unplacedSources:number; unlocatedPrimaryUsd:number; unlocatedUnpricedTokens:number; rejectedSources:number;
}
const parts=['inputTotal','cachedInput','outputTotal','reasoningOutput'] as const;
const count=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const time=(n:unknown):n is number=>count(n)&&n>0&&n<=8.64e15;
function vector(v:ProviderTokenCounts):boolean {
 return !!v&&parts.every(k=>count(v[k]??0))&&count(v.inputTotal)&&count(v.outputTotal)&&
  (v.cachedInput??0)<=v.inputTotal&&(v.reasoningOutput??0)<=v.outputTotal;
}
function add(target:Record<string,ProviderTokenCounts>,models:Models):boolean {
 for(const [model,v] of Object.entries(models)){
  if(!vector(v))return false;
  const old=target[model]??{inputTotal:0,outputTotal:0};
  const sum={inputTotal:old.inputTotal+v.inputTotal,outputTotal:old.outputTotal+v.outputTotal,
   cachedInput:(old.cachedInput??0)+(v.cachedInput??0),reasoningOutput:(old.reasoningOutput??0)+(v.reasoningOutput??0)};
  if(!vector(sum))return false;Object.defineProperty(target,model,{value:sum,enumerable:true,writable:true,configurable:true});
 }
 return true;
}
function subtract(models:Models,before:Models):Record<string,ProviderTokenCounts>|undefined {
 const out:Record<string,ProviderTokenCounts>=Object.create(null);
 for(const m of new Set([...Object.keys(models),...Object.keys(before)])){
  const v=Object.fromEntries(parts.map(k=>[k,(models[m]?.[k]??0)-(before[m]?.[k]??0)])) as unknown as ProviderTokenCounts;
  if(!vector(v))return;Object.defineProperty(out,m,{value:v,enumerable:true});
 }return out;
}
/** Stage one: per-reset request accounting before global checkpoint truncation.
 * Callers pass lineage-admitted, deduplicated sources. Gaps affect coverage,
 * not the existence of independently observed priced requests. */
export function buildCodexWitnessCycles(sources:readonly CodexWitnessSource[],rawBook:unknown,
 options:{now:number}):CodexWitnessCycle[]{
 return buildCodexWitnessLedger(sources,rawBook,options).cycles;
}
export function buildCodexWitnessLedger(sources:readonly CodexWitnessSource[],rawBook:unknown,
 options:{now:number;unavailableSources?:number}):{cycles:CodexWitnessCycle[];coverage:CodexWitnessCoverage}{
 const coverage:CodexWitnessCoverage={unplacedSources:0,unlocatedPrimaryUsd:0,unlocatedUnpricedTokens:0,
  rejectedSources:count(options.unavailableSources)?options.unavailableSources:0};
 const book=copyCodexCalibrationPricebook(rawBook);
 if(!book||!time(options.now)||sources.length>16384)return {cycles:[],coverage:{...coverage,rejectedSources:sources.length+coverage.rejectedSources}};
 const rates=new Map(book.rates.map(r=>[r.model,r]));
 const price=(models:Models)=>{let usd=0,known=0,unpriced=0;
  for(const [m,v]of Object.entries(models)){const r=rates.get(m),n=v.inputTotal+v.outputTotal;
   if(r){usd+=(v.inputTotal-(v.cachedInput??0))*r.input+(v.cachedInput??0)*r.cachedInput+v.outputTotal*r.output;known+=n;}
   else unpriced+=n;
  }return {usd,known,unpriced};};
 type Segment={source:number;rows:Row[];models:Models;partial:boolean;missing:boolean};
 const windows:Array<{reset:number;segments:Segment[]}>=[];let unavailableSources=coverage.rejectedSources;
 for(const [source,input]of sources.entries()){
  if(input.rows.length===0){
   const values=Object.values(input.primaryByModel);
   if(!values.every(vector)){unavailableSources++;continue;}
   if(values.some(v=>v.inputTotal+v.outputTotal>0)||input.hasUnknownGap){
    coverage.unplacedSources++;const value=price(input.primaryByModel);
    coverage.unlocatedPrimaryUsd+=value.usd;coverage.unlocatedUnpricedTokens+=value.unpriced;
   }continue;
  }
  if(input.rows.length>512){unavailableSources++;continue;}
  const groups=new Map<number,Row[]>();let valid=true;
  for(const row of input.rows){
   if(!time(row.through)||!time(row.from)||row.from>row.through||!time(row.resetAt)||row.resetAt<=row.through||
      !count(row.segment)||!Number.isFinite(row.usedPercent)||row.usedPercent<0||row.usedPercent>100){valid=false;break;}
   if(row.through>options.now)continue;
   if(!row.byModel||!Object.values(row.byModel).every(vector)||
     row.baselineByModel&&!Object.values(row.baselineByModel).every(vector)){valid=false;break;}
   const group=groups.get(row.segment)??[];group.push(row);groups.set(row.segment,group);
  }
  const admitted:Segment[]=[],total:Record<string,ProviderTokenCounts>=Object.create(null);
  for(const rawRows of groups.values()){
   rawRows.sort((a,b)=>a.through-b.through);
   const original=rawRows[0];
   if(rawRows.some((r,i)=>r.from!==original.from||r.resetAt!==original.resetAt||i>0&&
     (r.through<rawRows[i-1].through||r.baseline||Object.entries(rawRows[i-1].byModel).some(([m,v])=>
      parts.some(k=>(r.byModel[m]?.[k]??0)<(v[k]??0)))))){valid=false;break;}
   // Stored order resolves cumulative updates at one timestamp. The common
   // left endpoint is after ALL requests at that time, not the first row.
   const rows:Row[]=[];
   for(const r of rawRows){if(rows[rows.length-1]?.through===r.through)rows[rows.length-1]=r;else rows.push(r);}
   if(original.baseline&&rows[0]!==original){
    const left=rows[0],base:Record<string,ProviderTokenCounts>=Object.create(null);
    if(!add(base,left.byModel)||original.baselineByModel&&!add(base,original.baselineByModel)){valid=false;break;}
    for(let j=1;j<rows.length;j++){
     const difference=subtract(rows[j].byModel,left.byModel);
     if(!difference){valid=false;break;}
     rows[j]={...rows[j],byModel:difference};
    }
    if(!valid)break;
    rows[0]={...left,baseline:true,byModel:{},baselineByModel:base};
   }
   const first=rows[0],last=rows[rows.length-1];
   const models:Record<string,ProviderTokenCounts>=Object.create(null);
   if(!add(models,last.byModel)||first.baselineByModel&&!add(models,first.baselineByModel)||!add(total,models)){valid=false;break;}
   admitted.push({source,rows,models,missing:!original.baseline||original.baselineByModel===undefined,
    partial:input.hasUnknownGap===true||rows.some(r=>!r.complete)});
  }
  if(!valid||Object.entries(total).some(([m,v])=>!input.primaryByModel[m]||!vector(input.primaryByModel[m])||
    parts.some(k=>(v[k]??0)>(input.primaryByModel[m][k]??0)))){unavailableSources++;continue;}
  let budgetOmitted=false;
  for(const segment of admitted){const reset=segment.rows[0].resetAt;
   // Deadline tolerance must not move an observation beyond its cycle end.
   let window=windows.find(w=>Math.abs(w.reset-reset)<=300000&&
    segment.rows[segment.rows.length-1].through<w.reset&&
    w.segments.every(s=>s.rows[s.rows.length-1].through<reset));
   if(!window){if(windows.length>=512){budgetOmitted=true;continue;}window={reset,segments:[]};windows.push(window);}
   window.segments.push(segment);
  }
  if(budgetOmitted)unavailableSources++;
 }
 const episodes=windows.flatMap(w=>{
  const history=new Map<number,Row[]>();
  for(const s of w.segments)history.set(s.source,[...(history.get(s.source)??[]),...s.rows]);
  const raw:Array<{low:number;at:number}>=[];
  for(const rows of history.values()){
   rows.sort((a,b)=>a.through-b.through);
   for(let i=1;i<rows.length;i++)if(rows[i].baseline&&rows[i].through>rows[i-1].through&&
    (rows[i-1].usedPercent-rows[i].usedPercent>=15||rows[i].usedPercent===0&&rows[i-1].usedPercent>0))
     raw.push({low:rows[i-1].through,at:rows[i].through});
  }
  const cuts:Array<{low:number;at:number}>=[];
  for(const cut of raw.sort((a,b)=>a.at-b.at)){
   const old=cuts[cuts.length-1];
   if(old&&cut.low<old.at&&old.low<cut.at){old.low=Math.max(old.low,cut.low);old.at=Math.min(old.at,cut.at);}
   else cuts.push({...cut});
  }
  const bounds=[0,...cuts.map(c=>c.at),Number.POSITIVE_INFINITY];
  return bounds.slice(0,-1).map((from,i)=>{
   const segments:Segment[]=[];
   for(const s of w.segments){
    const rows=s.rows.filter(r=>r.through>=from&&r.through<bounds[i+1]);if(!rows.length)continue;
    const first=rows[0],last=rows[rows.length-1],models:Record<string,ProviderTokenCounts>=Object.create(null);
    if(first===s.rows[0]){
     add(models,last.byModel);if(first.baselineByModel)add(models,first.baselineByModel);
     segments.push({...s,rows,models});
    }else{
     // A cumulative block crossing a reset cannot be proportionally assigned.
     // Keep only differences after the first retained post-boundary checkpoint.
     const delta=subtract(last.byModel,first.byModel);if(!delta)continue;
     const differences=rows.map((r,j)=>j===0?{}:subtract(r.byModel,first.byModel));
     if(differences.some(d=>d===undefined)){unavailableSources++;continue;}
     const normalized=rows.map((r,j)=>({...r,from:first.through,baseline:j===0,
       byModel:differences[j]!,...(j===0?{baselineByModel:{}}:{})}));
     segments.push({...s,rows:normalized,models:delta,missing:true,partial:true});
    }
   }
   return {reset:w.reset,segments,start:i===0?null:cuts[i-1].at,startLower:i===0?null:cuts[i-1].low,
    end:cuts[i]?.at??w.reset,endLower:cuts[i]?.low??w.reset,closed:i<cuts.length||w.reset<=options.now};
  }).filter(e=>e.segments.length>0);
 });
 const cycles=episodes.map(w=>{
  const points=w.segments.flatMap(s=>s.rows).sort((a,b)=>a.through-b.through);
  const first=points[0],last=points[points.length-1];
  let knownUsd=0,knownTokens=0,unpricedTokens=0,deltaUsd=0,partial=false,baselineMissing=false;
  for(const s of w.segments){const amount=price(s.models);knownUsd+=amount.usd;knownTokens+=amount.known;unpricedTokens+=amount.unpriced;
   const left=s.rows[0];
   // Global left cut is post-request: exclude its cumulative/baseline dollars.
   // A later source's first baseline is inside the interval and remains counted.
   const initial=left.through===first.through?price(left.baseline?left.baselineByModel??{}:left.byModel).usd:
    !left.baseline?price(left.byModel).usd:0;
   deltaUsd+=Math.max(0,amount.usd-initial);partial ||= s.partial||s.missing;baselineMissing ||= s.missing;
  }
  const conflict=points.some((p,i)=>i>0&&(p.usedPercent<points[i-1].usedPercent||
    p.through===points[i-1].through&&p.usedPercent!==points[i-1].usedPercent));
  // Cross-source percentage differences do not identify a reset. Resets above
  // require an ordered baseline transition in the same retained source.
  const endpointConflict=points.some(p=>(p.through===first.through&&p.usedPercent!==first.usedPercent)||
    (p.through===last.through&&p.usedPercent!==last.usedPercent));
  const dp=last.usedPercent-first.usedPercent,capacity=dp>=5&&!endpointConflict&&!baselineMissing&&deltaUsd>0?deltaUsd/(dp/100):null;
  return {schemaVersion:1 as const,pricebook:book,requestedThrough:options.now,
   cycleStartAt:w.start,cycleStartLowerAt:w.startLower,cycleEndAt:w.end,cycleEndLowerAt:w.endLower,closed:w.closed,
   resetAt:w.reset,from:first.through,through:last.through,percentFrom:first.usedPercent,percentThrough:last.usedPercent,
   knownUsd,knownTokens,unpricedTokens,pricingCoverage:knownTokens+unpricedTokens>0?knownTokens/(knownTokens+unpricedTokens):0,
   deltaUsd,referenceCapacityUsd:capacity!==null&&Number.isFinite(capacity)&&capacity<=1e12?capacity:null,
   partial:partial||unpricedTokens>0||conflict||unavailableSources>0||coverage.unplacedSources>0,sources:new Set(w.segments.map(s=>s.source)).size,segments:w.segments.length,
   baselineMissing,counterConflict:conflict,unavailableSources};
 }).sort((a,b)=>a.resetAt-b.resetAt);
 coverage.rejectedSources=unavailableSources;
 return {cycles,coverage};
}
