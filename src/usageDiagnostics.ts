import type {UsageData} from './types';
import {rollingSevenDay, type RollingSevenDayResult} from './rollingSevenDay';

export interface DiagnosticDay {
  day: string;
  output: number;
  processed: number;
  coverage: 'complete' | 'partial' | 'unknown';
  models?: Record<string, number>;
  /** Independent marginal partition, never added to the model partition. */
  roles?: Record<string, number>;
}
export interface DiagnosticRate {
  status: 'ready' | 'partial' | 'unknown' | 'time';
  value: number | null;
  hours?: number;
  start?: number;
  end?: number;
}
const count = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
function ordinal(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const value = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(value) && new Date(value).toISOString().slice(0,10) === day ? value : null;
}
/** Bounded binary search for each local calendar boundary. No local-hour buckets
 * are split or stretched; skipped dates fail closed, DST uses actual elapsed time. */
export function diagnosticDayBounds(day: string, zone: string): {start:number;end:number;hours:number} | null {
  const nominal = ordinal(day);
  if (nominal === null || !zone) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
    const label = (n:number):string => {
      const parts=formatter.formatToParts(n);
      const part=(key:string)=>parts.find(p=>p.type===key)?.value ?? '';
      return `${part('year')}-${part('month')}-${part('day')}`;
    };
    const boundary = (key:string, basis:number):number => {
      let low=basis-36*3600000, high=basis+36*3600000;
      while (high-low>1) { const middle=Math.floor((low+high)/2); if(label(middle)<key)low=middle;else high=middle; }
      return high;
    };
    const start=boundary(day,nominal);
    const next=new Date(nominal+86400000).toISOString().slice(0,10);
    const end=boundary(next,nominal+86400000);
    if(label(start)!==day || label(end-1)!==day || end<=start)return null;
    return {start,end,hours:(end-start)/3600000};
  } catch { return null; }
}
export function diagnosticThroughput(day:DiagnosticDay|undefined, zone:string):DiagnosticRate {
  if(!day || day.coverage==='unknown')return {status:'unknown',value:null};
  const bounds=diagnosticDayBounds(day.day,zone);
  if(!bounds || !count(day.output))return {status:'time',value:null};
  return {status:day.coverage==='partial'?'partial':'ready',value:day.output/bounds.hours,...bounds};
}
export function diagnosticChange(before:DiagnosticDay|undefined,after:DiagnosticDay|undefined,zone:string,dimension:'models'|'roles'):{delta:number|null;rows:Array<{key:string;before:number;after:number;delta:number}>} {
  const unavailable={delta:null,rows:[]};
  if(!before||!after||before.coverage!=='complete'||after.coverage!=='complete')return unavailable;
  const first=diagnosticDayBounds(before.day,zone),last=diagnosticDayBounds(after.day,zone);
  if(!first||!last||first.end!==last.start||first.hours!==last.hours)return unavailable;
  const a=before[dimension],b=after[dimension];
  if(!a||!b)return unavailable;
  const keys=[...new Set([...Object.keys(a),...Object.keys(b)])];
  const own=(bucket:Record<string,number>,key:string):number=>Object.prototype.hasOwnProperty.call(bucket,key)?bucket[key]:0;
  const rows=keys.map(key=>({key,before:own(a,key),after:own(b,key),delta:own(b,key)-own(a,key)}));
  if(rows.some(row=>!count(row.before)||!count(row.after))||rows.reduce((s,r)=>s+r.before,0)!==before.output||rows.reduce((s,r)=>s+r.after,0)!==after.output)return unavailable;
  return {delta:after.output-before.output,rows};
}
export function adaptClaudeDiagnosticDays(rows:readonly {date:string;data:UsageData}[],complete:boolean):DiagnosticDay[] {
  return rows.map(({date,data})=>({day:date,output:data.totalOutputTokens,
    processed:data.totalInputTokens+data.totalOutputTokens+data.totalCacheCreationTokens+data.totalCacheReadTokens,
    coverage:complete?'complete' as const:'partial' as const,
    models:Object.fromEntries(Object.entries(data.modelBreakdown).map(([model,value])=>[model,value.outputTokens]))}));
}
/** Preserve missing days as unknown. Only an upstream census can supply known
 * zero days. Pure rolling statistics are not an achievement/receipt mutation. */
export function diagnosticSevenDayPeak(days:readonly DiagnosticDay[],asOfDay:string):RollingSevenDayResult|null {
  const valid=days.filter(d=>ordinal(d.day)!==null&&d.day<=asOfDay);
  if(!valid.length||ordinal(asOfDay)===null)return null;
  try{return rollingSevenDay({asOfDay,historyStartDay:valid.reduce((first,d)=>d.day<first?d.day:first,asOfDay),
    days:valid.map(d=>d.coverage==='unknown'||!count(d.processed)?{day:d.day,coverage:'unknown' as const}:{day:d.day,coverage:d.coverage,units:BigInt(d.processed)})});}catch{return null;}
}
