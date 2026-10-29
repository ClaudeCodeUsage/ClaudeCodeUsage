import {rollingSevenDay,type RollingDayObservation,type RollingSevenDayWindow} from './rollingSevenDay';

export interface AchievementRollingWindow {readonly startDay:string;readonly endDay:string}
export interface AchievementRollingPeak {
 readonly units?:bigint;
 readonly window?:AchievementRollingWindow;
 readonly lowerBound:boolean;
 /** Only complete, already-closed seven-day witnesses can date a new rule. */
 readonly first:ReadonlyMap<bigint,AchievementRollingWindow>;
}
const DAY=86_400_000;
function ordinal(day:string):number {
 const n=typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)?Date.parse(day+'T00:00:00Z'):NaN;
 if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==day)throw new RangeError('INVALID_DAY');
 return n;
}
const label=(n:number)=>new Date(n).toISOString().slice(0,10);
const witness=(w:RollingSevenDayWindow):AchievementRollingWindow=>Object.freeze({startDay:w.startDay,endDay:w.endDay});

/** Adapts already-validated daily aggregates. Full retained-date coverage alone
 * authorizes absent dates as known zero, never dates preceding the first row.
 * Expand only six neighbors around each observation (<=13N), not empty years.
 * The ordinary reducer then chooses the peak with the same date/closure rules.
 * Threshold crossings use one bounded seven-row scan, not repeated prefixes. */
export function achievementRollingPeak(input:{
 readonly days:readonly RollingDayObservation[];readonly asOfDay:string;
 readonly complete:boolean;readonly thresholds?:readonly bigint[];
}):AchievementRollingPeak {
 const first=new Map<bigint,AchievementRollingWindow>();
 const empty:AchievementRollingPeak={lowerBound:!input.complete,first};
 try {
  const asOf=ordinal(input.asOfDay),map=new Map<string,RollingDayObservation>();
  let start=asOf;
  for(const row of input.days){
   const n=ordinal(row.day);
   if(n>asOf||map.has(row.day))return empty;
   if(row.coverage!=='unknown'&&(typeof row.units!=='bigint'||row.units<0n))return empty;
   start=Math.min(start,n);map.set(row.day,row);
  }
  if(!map.size)return empty;
  if(input.complete){
   for(const row of input.days){
    const n=ordinal(row.day);
    for(let offset=-6;offset<=6;offset++){
     const date=n+offset*DAY;
     if(date<start||date>asOf)continue;
     const key=label(date);if(!map.has(key))map.set(key,{day:key,coverage:'complete',units:0n});
    }
   }
  }
  const rows=[...map.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const result=rollingSevenDay({days:rows,asOfDay:input.asOfDay,historyStartDay:label(start)});
  const peak=result.history.verifiedSubtotalPeak;
  if(!peak||peak.value.knownSubtotal===null)return empty;
  const thresholds=[...new Set(input.thresholds??[])].filter(n=>typeof n==='bigint'&&n>=0n);
  if(input.complete&&thresholds.length){
   const queue:Array<{time:number;units:bigint;complete:boolean}>=[];let sum=0n,complete=0;
   for(const row of rows){
    const time=ordinal(row.day);if(time>=asOf)break;
    while(queue.length&&queue[0].time<time-6*DAY){const old=queue.shift()!;sum-=old.units;if(old.complete)complete--;}
    const item={time,units:row.coverage==='unknown'?0n:row.units,complete:row.coverage==='complete'};
    queue.push(item);sum+=item.units;if(item.complete)complete++;
    if(complete===7&&time>=start+6*DAY)for(const threshold of thresholds){
     if(!first.has(threshold)&&sum>=threshold)first.set(threshold,Object.freeze({startDay:label(time-6*DAY),endDay:row.day}));
    }
   }
  }
  return {units:peak.value.knownSubtotal,window:witness(peak),
   lowerBound:!input.complete||peak.value.status!=='exact',first};
 }catch{return empty;}
}
