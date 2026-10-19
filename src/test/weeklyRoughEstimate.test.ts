import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildLocalWeeklyEstimates, weeklyEstimateForPoint } from '../weeklyEstimate';
import type { WeeklyValueInputs, WeeklyValuePoint } from '../weeklyValue';
const D=86_400_000,H=D/24,R=Date.parse('2026-10-26T12:00Z'),T=R-D;
const sample=():WeeklyValueInputs=>({observations:[{provider:'codex',seriesKey:'unattributed',
  observedAt:T,resetAt:R,usedPercent:25}],usage:[{timestamp:T-H,equivalentUsd:25,pricedTokens:92,totalTokens:100}]});

test('25% quota and 92% pricing give an explicit rough 100 total and 75 unused, without token-share price inflation',()=>{
  const inputs=sample();inputs.localHistoryComplete=false;
  const before=JSON.stringify(inputs),[entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(entry.method,'rough-prefix-v2');
  assert.equal(entry.fullEquivalentUsd,100);assert.equal(entry.unusedEquivalentUsd,75);
  assert.equal(entry.pricingCoverage,.92);
  for(const flag of ['partial-pricing','partial-history','account-unattributed'])assert.ok(entry.flags.includes(flag as any));
  assert.equal(JSON.stringify(inputs),before);
});
test('boundary approximation uses explicit time overlap only in the estimate, with hand-calculated 240 and 180',()=>{
  const inputs=sample(),start=R-7*D;
  inputs.usage=[{timestamp:start+D,intervalStart:start-D,intervalEnd:start+D,
    equivalentUsd:80,pricedTokens:92,totalTokens:100},
  {timestamp:T+D,intervalStart:T-D,intervalEnd:T+D,equivalentUsd:40,pricedTokens:92,totalTokens:100}];
  const before=JSON.stringify(inputs),[entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+D+1});
  assert.equal(entry.usedEquivalentUsd,60);assert.equal(entry.fullEquivalentUsd,240);
  assert.equal(entry.unusedEquivalentUsd,180);assert.ok(entry.flags.includes('boundary-uncertain'));
  assert.equal(JSON.stringify(inputs),before);
});
test('overlapping resets lower assurance but do not erase the available 100 and 75 reference values',()=>{
  const inputs=sample();inputs.observations.push({...inputs.observations[0],resetAt:R+2*H,observedAt:T-H,usedPercent:60});
  const row=buildLocalWeeklyEstimates('codex',inputs,{now:T+1}).find(e=>e.resetAt===R)!;
  assert.equal(row.fullEquivalentUsd,100);assert.equal(row.unusedEquivalentUsd,75);
  assert.ok(row.flags.includes('counter-change'));
});
test('a fully-priced exact calibration interval is not poisoned by earlier unpriced prefix usage',()=>{
  const inputs=sample();inputs.observations=[
    {...inputs.observations[0],observedAt:T-2*H,usedPercent:20,windowId:'w',percentageErrorBound:.1},
    {...inputs.observations[0],usedPercent:40,windowId:'w',percentageErrorBound:.1}];
  inputs.usage=[{timestamp:T-3*H,equivalentUsd:0,pricedTokens:0,totalTokens:10},
    {timestamp:T-H,equivalentUsd:30,pricedTokens:100,totalTokens:100}];
  const [entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(entry.method,'paired-delta');assert.equal(entry.usedEquivalentUsd,30);
  assert.equal(entry.fullEquivalentUsd,150);assert.equal(entry.unusedEquivalentUsd,90);
  assert.ok(entry.fullRange!.lower<150&&entry.fullRange!.upper>150);
});
test('conflicting same-time quota percentages cannot create a precise paired range or hide the warning',()=>{
  const inputs=sample();inputs.observations=[
    {...inputs.observations[0],observedAt:T-2*H,usedPercent:20,windowId:'w',percentageErrorBound:.1},
    {...inputs.observations[0],usedPercent:40,windowId:'w',percentageErrorBound:.1},
    {...inputs.observations[0],usedPercent:60,windowId:'w',percentageErrorBound:.1}];
  inputs.usage=[{timestamp:T-3*H,equivalentUsd:10,pricedTokens:100,totalTokens:100},
    {timestamp:T-H,equivalentUsd:30,pricedTokens:100,totalTokens:100}];
  const [entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(entry.method,'rough-prefix-v2');assert.equal(entry.fullRange,undefined);
  assert.ok(entry.flags.includes('counter-change'));
  assert.ok(Math.abs(entry.fullEquivalentUsd!-40/.6)<1e-9);
  assert.ok(Math.abs(entry.unusedEquivalentUsd!-(40/.6*.4))<1e-9);
});
test('tiny positive utilization still has a number, while a genuine zero denominator stays unknown',()=>{
  const inputs=sample();inputs.observations[0].usedPercent=1;
  const [small]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(small.fullEquivalentUsd,2500);assert.equal(small.unusedEquivalentUsd,2475);
  inputs.observations[0].usedPercent=0;
  const [zero]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(zero.fullEquivalentUsd,null);assert.equal(zero.unusedEquivalentUsd,null);
});
test('the first decreased-counter sample cannot price the unobserved transition gap as new-cycle use',()=>{
  const inputs=sample();inputs.observations=[{...inputs.observations[0],observedAt:T-D,usedPercent:80},
    {...inputs.observations[0],usedPercent:40}];
  inputs.usage=[{timestamp:T-2*D,equivalentUsd:100,pricedTokens:100,totalTokens:100},
    {timestamp:T-H,equivalentUsd:20,pricedTokens:100,totalTokens:100}];
  const [entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(entry.usedEquivalentUsd,0);assert.equal(entry.fullEquivalentUsd,null);
  assert.equal(entry.unusedEquivalentUsd,null);assert.equal(entry.calibrationStart,undefined);
  assert.ok(entry.flags.includes('counter-change'));
});
test('first known saturation freezes the sample and zero unused rather than admitting later usage',()=>{
  const inputs=sample();inputs.observations=[{...inputs.observations[0],observedAt:T-H,usedPercent:100},
    {...inputs.observations[0],resetAt:R+240_000,usedPercent:100}];
  inputs.usage=[{timestamp:T-2*H,equivalentUsd:20,pricedTokens:100,totalTokens:100},
    {timestamp:T-1,equivalentUsd:400,pricedTokens:100,totalTokens:100}];
  const [entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(entry.observedAt,T-H);assert.equal(entry.usedEquivalentUsd,20);
  assert.equal(entry.resetAt,R);assert.equal(entry.windowStart,R-7*D);
  assert.equal(entry.fullEquivalentUsd,20);assert.equal(entry.unusedEquivalentUsd,0);
});
test('later local usage does not decrement an original rough unused estimate',()=>{
  const inputs=sample();const [before]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  inputs.usage.push({timestamp:T+H,equivalentUsd:500,pricedTokens:100,totalTokens:100});
  const [after]=buildLocalWeeklyEstimates('codex',inputs,{now:T+2*H});
  assert.equal(after.fullEquivalentUsd,before.fullEquivalentUsd);
  assert.equal(after.unusedEquivalentUsd,75);assert.ok(after.flags.includes('stale-observation'));
});
test('invalid and future quota evidence remains rejected, not replaced with an invented amount',()=>{
  for(const percent of [-1,NaN,101]){
    const inputs=sample();inputs.observations[0].usedPercent=percent;
    assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1}).length,0);
  }
  assert.equal(buildLocalWeeklyEstimates('codex',sample(),{now:T-H}).length,0);
  const inputs=sample();inputs.usage=[];
  assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0].fullEquivalentUsd,null);
});

test('ordinary table matches actual resets and percentages, never future or pre-window archive evidence',()=>{
  const [entry]=buildLocalWeeklyEstimates('codex',sample(),{now:T+1});
  const point:WeeklyValuePoint={provider:'codex',seriesKey:'unknown',windowStart:R-7*D,resetAt:R,current:true,
    usedEquivalentUsd:400,fullEquivalentUsd:null,unusedEquivalentUsd:null,utilizationPercent:25,
    pricingCoverage:.92,observationGapMs:null,confidence:'usage-only',basis:'reset-aligned-usage'};
  const clock=Date.now;Date.now=()=>T+1;
  try{
    assert.equal(weeklyEstimateForPoint(point,[entry]),entry);
    assert.equal(weeklyEstimateForPoint(point,[{...entry,resetAt:R+H}]),undefined);
    assert.equal(weeklyEstimateForPoint(point,[{...entry,observedAt:T+H}]),undefined);
    assert.equal(weeklyEstimateForPoint(point,[{...entry,observedAt:entry.windowStart-1}]),undefined);
    assert.equal(weeklyEstimateForPoint({...point,observedAt:T,utilizationPercent:50},[entry]),undefined);
    assert.equal(weeklyEstimateForPoint(point,[{...entry,fullEquivalentUsd:NaN}]),undefined);
  }finally{Date.now=clock;}
});
