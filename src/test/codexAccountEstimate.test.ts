import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {CodexAccountEstimator, OfficialQuotaSample} from '../codexAccountEstimate';
import type {WeeklyValueInputs} from '../weeklyValue';
const H=3_600_000,T=Date.parse('2026-10-19T02:00Z'),R=T+6*24*H;
const A='a'.repeat(64),B='b'.repeat(64),S='c'.repeat(64);
function sample(t:number,p:number,key=A,resetAt=R):OfficialQuotaSample{return {accountScopeKey:key,sourceScopeKey:S,requestedAt:t-100,observedAt:t,resetAt,usedPercent:p};}
function inputs(t:number,p:number,amount:number,extra=0):WeeklyValueInputs{return {localHistoryComplete:true,
  observations:[{provider:'codex',seriesKey:'codex',sourceKey:'own',observedAt:t-1,resetAt:R,usedPercent:p},
    {provider:'codex',seriesKey:'codex',sourceKey:'foreign',observedAt:t-1,resetAt:R+H,usedPercent:50}],
  usage:[{sourceKey:'own',timestamp:t-1,intervalStart:T-H,intervalEnd:t-1,equivalentUsd:amount,pricedTokens:amount*10,totalTokens:amount*10},
    {sourceKey:'foreign',timestamp:t-1,equivalentUsd:extra,pricedTokens:extra*10,totalTokens:extra*10}]};}
test('same-account incremental calibration excludes foreign-window growth, never uses the whole mixed prefix',()=>{
  const e=new CodexAccountEstimator();
  assert.equal(e.observe(sample(T,20),inputs(T,20,100,500),'v1'),undefined);
  const x=e.observe(sample(T+60_000,40),inputs(T+60_000,40,130,900),'v1')!;
  assert.equal(x.method,'account-delta-v1');assert.equal(x.usedEquivalentUsd,30);
  assert.equal(x.fullEquivalentUsd,150);assert.equal(x.unusedEquivalentUsd,90);
  assert.equal(x.accountScopeKey,A);assert.equal(x.calibrationStart,T);
  assert.ok(x.flags.includes('account-unattributed'),'quota identity is not proof of local request ownership');
});
test('A to B to A starts new baselines and cannot bridge B usage',()=>{
  const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
  assert.equal(e.observe(sample(T+60_000,30,B),inputs(T+60_000,30,500),'v1'),undefined);
  assert.equal(e.observe(sample(T+120_000,25,A),inputs(T+120_000,25,600),'v1'),undefined);
  const x=e.observe(sample(T+180_000,35,A),inputs(T+180_000,35,620),'v1')!;
  assert.equal(x.fullEquivalentUsd,200);assert.equal(x.unusedEquivalentUsd,130);
});
test('reset, failure, long gap and pricing changes retire baselines without changing a previous result',()=>{
  for(const change of ['reset','gap','price','clear'] as const){
    const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
    const x=e.observe(sample(T+60_000,40),inputs(T+60_000,40,130),'v1')!,before=JSON.stringify(x);
    if(change==='clear')e.reset();
    const t=change==='gap'?T+H:T+120_000;
    assert.equal(e.observe(sample(t,50,A,change==='reset'?R+H:R),inputs(t,50,1000),change==='price'?'v2':'v1'),undefined);
    assert.equal(JSON.stringify(x),before);
  }
});
test('unchanged percentage retains the original baseline until a measurable delta',()=>{
  const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
  assert.equal(e.observe(sample(T+60_000,20),inputs(T+60_000,20,110),'v1'),undefined);
  assert.equal(e.observe(sample(T+120_000,40),inputs(T+120_000,40,130),'v1')!.fullEquivalentUsd,150);
});
test('counter decrease, incomplete indexing, reversed clock and saturation do not generate a new numeric calibration',()=>{
  for(const mode of ['decrease','incomplete','clock','saturated'] as const){
    const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
    const t=mode==='clock'?T-1:T+60_000,p=mode==='decrease'?10:mode==='saturated'?100:40;
    const i=inputs(t,p,130);if(mode==='incomplete')i.localHistoryComplete=false;
    assert.equal(e.observe(sample(t,p),i,'v1'),undefined);
  }
});
test('late-arriving pre-baseline sources and unlinked usage never become current-account increments',()=>{
  const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
  const i=inputs(T+60_000,40,100);i.usage.push({sourceKey:'late',timestamp:T-1,equivalentUsd:900,pricedTokens:900,totalTokens:900});
  i.observations.push({provider:'codex',seriesKey:'codex',sourceKey:'late',observedAt:T+50_000,resetAt:R,usedPercent:30});
  assert.equal(e.observe(sample(T+60_000,40),i,'v1'),undefined);
});
test('remote-only percentage growth does not invent a zero capacity; same-time contradiction retires calibration',()=>{
  const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
  assert.equal(e.observe(sample(T+60_000,40),inputs(T+60_000,40,100),'v1'),undefined);
  assert.equal(e.observe(sample(T+60_000,50),inputs(T+60_000,50,120),'v1'),undefined);
});
test('local same-reset counter regression is excluded even if the official account percentage rises',()=>{
  const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
  const i=inputs(T+60_000,40,130);i.observations[0].usedPercent=10;
  assert.equal(e.observe(sample(T+60_000,40),i,'v1'),undefined);
});
test('identical duplicate local witnesses are harmless; contradictory same-time samples never calibrate',()=>{
  for(const conflict of [false,true]){
    const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
    const i=inputs(T+60_000,40,130);
    i.observations.push({...i.observations[0],usedPercent:conflict?30:40});
    const x=e.observe(sample(T+60_000,40),i,'v1');
    if(conflict)assert.equal(x,undefined);else assert.equal(x!.fullEquivalentUsd,150);
  }
});
test('compatible intervals aggregate quota-point-weighted evidence instead of replacing capacity with the last noisy interval',()=>{
  const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
  const first=e.observe(sample(T+60_000,40),inputs(T+60_000,40,130),'v1')!;
  const frozen=JSON.stringify(first);
  const next=e.observe(sample(T+120_000,50),inputs(T+120_000,50,160),'v1')!;
  assert.equal(next.usedEquivalentUsd,60);assert.equal(next.fullEquivalentUsd,200);
  assert.equal(next.unusedEquivalentUsd,100);assert.equal(next.calibrationStart,T);
  assert.equal(JSON.stringify(first),frozen);
});
test('continuous unchanged-percentage observations keep the monetary baseline beyond five minutes',()=>{
  const e=new CodexAccountEstimator();e.observe(sample(T,20),inputs(T,20,100),'v1');
  for(let i=1;i<=10;i++)assert.equal(e.observe(sample(T+i*60_000,20),inputs(T+i*60_000,20,100+i),'v1'),undefined);
  const next=e.observe(sample(T+11*60_000,30),inputs(T+11*60_000,30,130),'v1')!;
  assert.equal(next.fullEquivalentUsd,300);assert.equal(next.usedEquivalentUsd,30);
});
test('an old large corpus cannot exhaust the active-window checkpoint budget',()=>{
  const e=new CodexAccountEstimator();
  const old=Array.from({length:17000},(_,i)=>({sourceKey:'old-'+i,timestamp:T-30*86_400_000,
    equivalentUsd:1,pricedTokens:1,totalTokens:1}));
  const first=inputs(T,20,100);first.usage.push(...old);
  assert.equal(e.observe(sample(T,20),first,'v1'),undefined);
  const next=inputs(T+60_000,40,130);next.usage.push(...old);
  assert.equal(e.observe(sample(T+60_000,40),next,'v1')!.fullEquivalentUsd,150);
});
