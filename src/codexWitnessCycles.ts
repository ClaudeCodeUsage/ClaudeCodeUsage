import type {ProviderTokenCounts} from './providers/providerTypes';
import type {CodexQuotaCheckpoint} from './providers/codex/codexQuotaCheckpoints';
import {copyCodexCalibrationPricebook} from './codexCalibrationEvidence';

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
  resetAt:number; from:number; through:number; percentFrom:number; percentThrough:number;
  knownUsd:number; knownTokens:number; unpricedTokens:number; pricingCoverage:number;
  deltaUsd:number; referenceCapacityUsd:number|null; partial:boolean;
  sources:number; segments:number; baselineMissing:boolean; counterConflict:boolean; unavailableSources:number;
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
/** Stage one: per-reset request accounting before global checkpoint truncation.
 * Callers pass lineage-admitted, deduplicated sources. Gaps affect coverage,
 * not the existence of independently observed priced requests. */
export function buildCodexWitnessCycles(sources:readonly CodexWitnessSource[],rawBook:unknown,
 options:{now:number}):CodexWitnessCycle[]{
 const book=copyCodexCalibrationPricebook(rawBook);
 if(!book||!time(options.now)||sources.length>16384)return [];
 const rates=new Map(book.rates.map(r=>[r.model,r]));
 const price=(models:Models)=>{let usd=0,known=0,unpriced=0;
  for(const [m,v]of Object.entries(models)){const r=rates.get(m),n=v.inputTotal+v.outputTotal;
   if(r){usd+=(v.inputTotal-(v.cachedInput??0))*r.input+(v.cachedInput??0)*r.cachedInput+v.outputTotal*r.output;known+=n;}
   else unpriced+=n;
  }return {usd,known,unpriced};};
 type Segment={source:number;rows:Row[];models:Models;partial:boolean;missing:boolean};
 const windows:Array<{reset:number;segments:Segment[]}>=[];let unavailableSources=0;
 for(const [source,input]of sources.entries()){
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
  for(const rows of groups.values()){
   rows.sort((a,b)=>a.through-b.through);
   const first=rows[0],last=rows[rows.length-1];
   if(rows.some((r,i)=>r.from!==first.from||r.resetAt!==first.resetAt||i>0&&
     (r.through<=rows[i-1].through||r.baseline||Object.entries(rows[i-1].byModel).some(([m,v])=>
      parts.some(k=>(r.byModel[m]?.[k]??0)<(v[k]??0)))))){valid=false;break;}
   const models:Record<string,ProviderTokenCounts>=Object.create(null);
   if(!add(models,last.byModel)||first.baselineByModel&&!add(models,first.baselineByModel)||!add(total,models)){valid=false;break;}
   admitted.push({source,rows,models,missing:!first.baseline||first.baselineByModel===undefined,
    partial:input.hasUnknownGap===true||rows.some(r=>!r.complete)});
  }
  if(!valid||Object.entries(total).some(([m,v])=>!input.primaryByModel[m]||!vector(input.primaryByModel[m])||
    parts.some(k=>(v[k]??0)>(input.primaryByModel[m][k]??0)))){unavailableSources++;continue;}
  for(const segment of admitted){const reset=segment.rows[0].resetAt;
   let window=windows.find(w=>Math.abs(w.reset-reset)<=300000);
   if(!window){if(windows.length>=512)continue;window={reset,segments:[]};windows.push(window);}
   window.segments.push(segment);
  }
 }
 return windows.map(w=>{
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
  // Concurrent responses can report slightly older percentages. Preserve that
  // uncertainty instead of deleting known dollars or treating every jitter as
  // a reset. Large drops still require episode separation before capacity fits.
  const possibleReset=points.some((p,i)=>i>0&&(points[i-1].usedPercent-p.usedPercent>=15||
    p.usedPercent===0&&points[i-1].usedPercent>0));
  const endpointConflict=points.some(p=>(p.through===first.through&&p.usedPercent!==first.usedPercent)||
    (p.through===last.through&&p.usedPercent!==last.usedPercent));
  const dp=last.usedPercent-first.usedPercent,capacity=dp>=5&&!possibleReset&&!endpointConflict&&!baselineMissing&&deltaUsd>0?deltaUsd/(dp/100):null;
  return {resetAt:w.reset,from:first.through,through:last.through,percentFrom:first.usedPercent,percentThrough:last.usedPercent,
   knownUsd,knownTokens,unpricedTokens,pricingCoverage:knownTokens+unpricedTokens>0?knownTokens/(knownTokens+unpricedTokens):0,
   deltaUsd,referenceCapacityUsd:capacity!==null&&Number.isFinite(capacity)&&capacity<=1e12?capacity:null,
   partial:partial||unpricedTokens>0||conflict||unavailableSources>0,sources:new Set(w.segments.map(s=>s.source)).size,segments:w.segments.length,
   baselineMissing,counterConflict:conflict,unavailableSources};
 }).sort((a,b)=>a.resetAt-b.resetAt);
}
