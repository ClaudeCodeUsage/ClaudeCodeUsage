import type { UsageProvider } from './providers/providerTypes';
import type { LocalWeeklyEstimate } from './weeklyEstimate';
import type { WeeklyValuePoint } from './weeklyValue';
import { copyCodexQuotaEpoch, codexQuotaEpochFitsObservation, CodexQuotaEpoch } from './codexQuotaEpoch';
import { CodexQuotaCycle, copyCodexQuotaCycle, selectCodexCycleEstimates } from './codexQuotaCycles';

export interface WeeklyEstimateChartPoint extends WeeklyValuePoint {
  asOfEstimate: boolean;
  accountNumber?: number;
  quotaEpoch?: CodexQuotaEpoch;
  quotaCycle?: CodexQuotaCycle;
  localWindowNumber?: number;
}

/** A presentation projection, never an update to the unique usage ledger or archive. */
export function projectWeeklyEstimateChart(
  provider: UsageProvider,
  usage: readonly WeeklyValuePoint[],
  snapshots: readonly LocalWeeklyEstimate[],
  options: { now?: number; limit?: number; activeAccountNumber?: number; accountIdentityAvailable?: boolean;
    activeQuotaEpochStartedAt?: number } = {},
): WeeklyEstimateChartPoint[] {
  const now=options.now??Date.now();
  if(!Number.isFinite(now))return [];
  const metadata=(entry:LocalWeeklyEstimate)=>entry.provider===provider&&
    Number.isFinite(entry.windowStart)&&Number.isFinite(entry.resetAt)&&entry.windowStart<entry.resetAt&&
    Number.isFinite(entry.observedAt)&&entry.observedAt>=entry.windowStart&&entry.observedAt<entry.resetAt&&entry.observedAt<=now&&
    (entry.quotaEpoch===undefined||(provider==='codex'&&entry.method==='account-delta-v1'&&
      (entry.accountNumber!==undefined||entry.accountScopeKey!==undefined)&&copyCodexQuotaEpoch(entry.quotaEpoch)!==undefined&&
      codexQuotaEpochFitsObservation(entry.quotaEpoch,entry.observedAt,entry.resetAt,entry.windowStart,entry.calibrationStart)));
  const all=snapshots.filter(metadata);
  const latestObserved=Math.max(-Infinity,...all.map(entry=>entry.observedAt));
  const valid=all.filter(entry=>entry.fullEquivalentUsd!==null&&Number.isFinite(entry.fullEquivalentUsd)&&
    entry.fullEquivalentUsd>0&&entry.unusedEquivalentUsd!==null&&Number.isFinite(entry.unusedEquivalentUsd)&&
    entry.unusedEquivalentUsd>=0&&entry.unusedEquivalentUsd<=entry.fullEquivalentUsd);
  const rank=(entry:LocalWeeklyEstimate)=>entry.method==='account-delta-v1'?5:entry.method==='series-prefix-v1'?4:
    entry.method==='paired-delta'?3:entry.method==='rough-prefix-v2'?2:1;
  valid.sort((a,b)=>b.observedAt-a.observedAt||rank(b)-rank(a)||b.estimatedAt-a.estimatedAt);
  const chosen:LocalWeeklyEstimate[]=[];
  if(provider==='codex')chosen.push(...selectCodexCycleEstimates(all));
  for(const entry of provider==='codex'?[]:valid){
    // Compare to the selected representative, not a chain of neighboring resets.
    if(!chosen.some(other=>(other.accountNumber??other.accountScopeKey)===(entry.accountNumber??entry.accountScopeKey)&&
      (entry.quotaEpoch!==undefined||other.quotaEpoch!==undefined
        ? entry.quotaEpoch!==undefined&&other.quotaEpoch!==undefined&&
          (entry.quotaCycle?.id??entry.quotaEpoch.startedAt)===(other.quotaCycle?.id??other.quotaEpoch.startedAt)
        : Math.abs(other.resetAt-entry.resetAt)<=300_000)))chosen.push(entry);
  }
  const estimated:WeeklyEstimateChartPoint[]=chosen.map(entry=>({
    provider,seriesKey:'observed-window',windowStart:entry.windowStart,resetAt:entry.resetAt,
    current:entry.quotaCycle?.closed!==true&&entry.quotaCycle?.referenceOnly!==true&&(provider!=='codex'||(entry.quotaCycle!==undefined&&entry.method==='account-delta-v1'&&entry.quotaEpoch!==undefined&&
      entry.accountNumber!==undefined&&Number.isSafeInteger(entry.accountNumber)&&entry.accountNumber>0))&&
      entry.observedAt===latestObserved&&entry.resetAt>now&&
      (entry.accountNumber===undefined
        ? options.accountIdentityAvailable===undefined&&options.activeQuotaEpochStartedAt===undefined
        : options.accountIdentityAvailable===true&&options.activeAccountNumber===entry.accountNumber)&&
      (options.activeQuotaEpochStartedAt===undefined||(entry.quotaCycle?.id??entry.quotaEpoch?.startedAt)===options.activeQuotaEpochStartedAt),
    usedEquivalentUsd:entry.fullEquivalentUsd === null || entry.unusedEquivalentUsd === null ? 0 :
      entry.fullEquivalentUsd-entry.unusedEquivalentUsd,
    fullEquivalentUsd:entry.fullEquivalentUsd,unusedEquivalentUsd:entry.unusedEquivalentUsd,
    utilizationPercent:entry.utilizationPercent,pricingCoverage:entry.pricingCoverage,
    observationGapMs:Math.max(0,now-entry.observedAt),confidence:'low',basis:'quota-observation',
    usageAvailable:entry.fullEquivalentUsd !== null,boundaryUncertain:entry.flags.includes('boundary-uncertain'),
    observedAt:entry.observedAt,observedResetAt:entry.resetAt,asOfEstimate:true,
    ...(typeof entry.accountNumber === 'number' && Number.isSafeInteger(entry.accountNumber) && entry.accountNumber > 0
      ? {accountNumber:entry.accountNumber} : {}),
    ...(entry.localWindowNumber===undefined?{}:{localWindowNumber:entry.localWindowNumber}),
    ...(entry.quotaEpoch===undefined?{}:{quotaEpoch:copyCodexQuotaEpoch(entry.quotaEpoch)!}),
    ...(copyCodexQuotaCycle(entry.quotaCycle)===undefined?{}:{quotaCycle:copyCodexQuotaCycle(entry.quotaCycle)!}),
  }));
  const fallback=usage.filter(point=>point.provider===provider&&
    !chosen.some(entry=>point.windowStart<entry.resetAt&&entry.windowStart<point.resetAt))
    .map((point):WeeklyEstimateChartPoint=>({...point,fullEquivalentUsd:null,unusedEquivalentUsd:null,asOfEstimate:false}));
  const limit=Number.isFinite(options.limit)?Math.max(1,Math.floor(options.limit!)):8;
  return [...estimated,...fallback].sort((a,b)=>(b.observedAt??Math.min(now,b.resetAt))-
    (a.observedAt??Math.min(now,a.resetAt))||b.resetAt-a.resetAt).slice(0,limit);
}
