import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildLocalWeeklyEstimates } from '../weeklyEstimate';
import type { WeeklyValueInputs } from '../weeklyValue';
const D=86_400_000, R=Date.parse('2026-10-26T12:00:00Z'), T=R-D;
const sample=():WeeklyValueInputs=>({observations:[{provider:'codex',seriesKey:'unknown',
  observedAt:T,resetAt:R,usedPercent:40}],usage:[{timestamp:T-1000,equivalentUsd:40,pricedTokens:100,totalTokens:100}]});
test('one incomplete cycle retains a clearly rough reconstructed as-of estimate, never an account balance',()=>{
  const [e]=buildLocalWeeklyEstimates('codex',sample(),{now:T+1});
  assert.equal(e.fullEquivalentUsd,100);assert.equal(e.unusedEquivalentUsd,60);
  assert.equal(e.usedEquivalentUsd,40);assert.equal(e.observedAt,T);
  assert.equal(e.method,'legacy-prefix-ratio');assert.ok(e.flags.includes('account-unattributed'));
  assert.ok(e.flags.includes('reconstructed'));
});
test('usage after a quota sample never changes its historical estimate or observed unused value',()=>{
  const inputs=sample();const before=buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0];
  inputs.usage.push({timestamp:T+100,equivalentUsd:500,pricedTokens:100,totalTokens:100});
  const after=buildLocalWeeklyEstimates('codex',inputs,{now:T+200})[0];
  assert.equal(after.fullEquivalentUsd,before.fullEquivalentUsd);assert.equal(after.unusedEquivalentUsd,60);
  assert.equal(after.usedEquivalentUsd,40);
});
test('different reset schedules retain their actual boundaries without summing or duplicating local history',()=>{
  const inputs=sample();inputs.observations.push({...inputs.observations[0],resetAt:R+D,observedAt:T+1});
  const entries=buildLocalWeeklyEstimates('codex',inputs,{now:T+2});
  assert.deepEqual(entries.map(e=>e.resetAt).sort(),[R,R+D]);
  assert.equal(entries.find(e=>e.resetAt===R)?.fullEquivalentUsd,100,'a later change does not rewrite an earlier as-of comparison');
  assert.equal(entries.find(e=>e.resetAt===R+D)?.fullEquivalentUsd,null);
  assert.ok(entries.find(e=>e.resetAt===R+D)?.flags.includes('counter-change'));
  assert.equal(inputs.usage.length,1);
});

test('paired calibration requires explicit precision and exact endpoint allocation, not formatted decimals',()=>{
  const inputs=sample();inputs.observations=[
    {...inputs.observations[0],observedAt:T-D,usedPercent:20,windowId:'w',percentageErrorBound:.5},
    {...inputs.observations[0],usedPercent:40,windowId:'w',percentageErrorBound:.5},
  ];
  inputs.usage=[{timestamp:T-D-100,equivalentUsd:10,pricedTokens:100,totalTokens:100},
    {timestamp:T-100,equivalentUsd:30,pricedTokens:100,totalTokens:100}];
  const [paired]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(paired.method,'paired-delta');assert.equal(paired.fullEquivalentUsd,150);
  assert.equal(paired.unusedEquivalentUsd,90);
  assert.ok(Math.abs(paired.fullRange!.lower-30/.21)<1e-9);
  assert.ok(Math.abs(paired.fullRange!.upper-30/.19)<1e-9);
  assert.equal(paired.usedEquivalentUsd,30);
  assert.equal(paired.calibrationStart,T-D);
  inputs.observations[0].percentageErrorBound=-.5;
  assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0].method,'legacy-prefix-ratio');
  delete inputs.observations[0].percentageErrorBound;
  assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0].method,'legacy-prefix-ratio');
});

test('partial pricing, empty usage and conflicting same-time counters do not create full capacity',()=>{
  const inputs=sample();inputs.usage[0].pricedTokens=99;
  assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0].fullEquivalentUsd,null);
  inputs.usage=[];
  assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0].fullEquivalentUsd,null);
  inputs.usage=sample().usage;
  inputs.observations.push({...inputs.observations[0],usedPercent:80});
  assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0].fullEquivalentUsd,null);
});
test('same-reset counter regression withdraws a current candidate rather than blending epochs',()=>{
  const inputs=sample();inputs.observations.unshift({...inputs.observations[0],usedPercent:80,observedAt:T-1});
  assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0].fullEquivalentUsd,null);
});
test('crossing a reset or sample boundary does not allocate a daily bucket proportionally',()=>{
  const inputs=sample();inputs.usage[0].intervalStart=R-8*D;inputs.usage[0].intervalEnd=T-1000;
  const [entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(entry.fullEquivalentUsd,null);assert.ok(entry.flags.includes('boundary-uncertain'));
});
test('invalid, future, tiny or saturated quota samples never produce a numerical total',()=>{
  for(const percent of [-1,NaN,101,0,1,100]){
    const inputs=sample();inputs.observations[0].usedPercent=percent;
    assert.ok(buildLocalWeeklyEstimates('codex',inputs,{now:T+1}).every(e=>e.fullEquivalentUsd===null));
  }
  assert.equal(buildLocalWeeklyEstimates('codex',sample(),{now:T-1}).length,0);
});

test('reset jitter must not give a precise paired result after excluding known calibration usage',()=>{
  const inputs=sample(),start=R-7*D;
  inputs.observations=[{...inputs.observations[0],observedAt:start+60_000,usedPercent:20,
    resetAt:R,windowId:'w',percentageErrorBound:.5},{...inputs.observations[0],
    resetAt:R+240_000,windowId:'w',percentageErrorBound:.5}];
  inputs.usage=[{timestamp:start+120_000,equivalentUsd:10,pricedTokens:100,totalTokens:100},
    {timestamp:T-1000,equivalentUsd:30,pricedTokens:100,totalTokens:100}];
  const [entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+1});
  assert.equal(entry.fullEquivalentUsd,null);
  assert.ok(entry.flags.includes('boundary-uncertain'));
});

test('positive money without priced tokens cannot enter a fully-priced numerator',()=>{
  const inputs=sample();inputs.usage.push({timestamp:T-500,equivalentUsd:4000,pricedTokens:0,totalTokens:0});
  assert.equal(buildLocalWeeklyEstimates('codex',inputs,{now:T+1})[0].fullEquivalentUsd,null);
});

test('invalid numbers demonstrably outside the historical interval cannot rewrite its estimate',()=>{
  for(const timestamp of [T+100,R-9*D]){
    const inputs=sample();inputs.usage.push({timestamp,equivalentUsd:NaN,pricedTokens:100,totalTokens:100});
    const [entry]=buildLocalWeeklyEstimates('codex',inputs,{now:T+200});
    assert.equal(entry.fullEquivalentUsd,100);assert.equal(entry.unusedEquivalentUsd,60);
  }
});
