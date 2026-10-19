import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projectWeeklyEstimateChart } from '../weeklyEstimateChart';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
import type { WeeklyValuePoint } from '../weeklyValue';
const D=86_400_000,H=D/24,N=Date.parse('2026-10-19T12:00Z'),R=N+D;
const usage=(resetAt=R,amount=400):WeeklyValuePoint=>({provider:'codex',seriesKey:'unattributed',windowStart:resetAt-7*D,
  resetAt,current:resetAt>N,usedEquivalentUsd:amount,fullEquivalentUsd:null,unusedEquivalentUsd:null,
  utilizationPercent:null,pricingCoverage:.92,observationGapMs:null,confidence:'usage-only',basis:'reset-aligned-usage'});
const snapshot=(extra:Partial<LocalWeeklyEstimate>={}):LocalWeeklyEstimate=>({provider:'codex',windowStart:R-7*D,
  resetAt:R,observedAt:N-H,estimatedAt:N,usedEquivalentUsd:25,fullEquivalentUsd:100,unusedEquivalentUsd:75,
  utilizationPercent:25,pricingCoverage:.92,method:'rough-prefix-v2',flags:['account-unattributed'],...extra});

test('stacked estimates use 25 observed-used plus 75 unused, not current local 400 plus old 75',()=>{
  const rows=[usage()],snapshots=[snapshot()],before=JSON.stringify([rows,snapshots]);
  const [point]=projectWeeklyEstimateChart('codex',rows,snapshots,{now:N});
  assert.equal(point.usedEquivalentUsd,25);assert.equal(point.unusedEquivalentUsd,75);
  assert.equal(point.fullEquivalentUsd,100);assert.equal(point.observedAt,N-H);assert.ok(point.asOfEstimate);
  assert.equal(point.usedEquivalentUsd+point.unusedEquivalentUsd!,point.fullEquivalentUsd);
  assert.equal(JSON.stringify([rows,snapshots]),before);
});
test('paired interval delta is not the full-cycle blue segment: 150 total and 90 unused imply 60 used',()=>{
  const [point]=projectWeeklyEstimateChart('codex',[usage()],[snapshot({method:'paired-delta',usedEquivalentUsd:30,
    fullEquivalentUsd:150,unusedEquivalentUsd:90,utilizationPercent:40,calibrationStart:N-2*H})],{now:N});
  assert.equal(point.usedEquivalentUsd,60);assert.equal(point.unusedEquivalentUsd,90);assert.equal(point.fullEquivalentUsd,150);
});
test('a real irregular reset is graphed without snapping it into the current seven-day grid',()=>{
  const entry=snapshot({resetAt:R+2*H,windowStart:R+2*H-7*D});
  const rows=projectWeeklyEstimateChart('codex',[usage(),usage(R-7*D,12)],[entry],{now:N});
  assert.equal(rows.length,2);assert.equal(rows[0].resetAt,R+2*H);assert.equal(rows[0].windowStart,entry.windowStart);
  assert.equal(rows[1].usedEquivalentUsd,12);assert.equal(rows[1].unusedEquivalentUsd,null);
});
test('latest sample per reset is selected once, while overlapping real windows remain separate and only latest observation is current',()=>{
  const snapshots=[snapshot({observedAt:N-2*H,fullEquivalentUsd:200,unusedEquivalentUsd:150}),snapshot(),
    snapshot({resetAt:R+2*H,windowStart:R+2*H-7*D,observedAt:N-3*H,fullEquivalentUsd:50,unusedEquivalentUsd:30})];
  const rows=projectWeeklyEstimateChart('codex',[usage()],snapshots,{now:N});
  assert.equal(rows.length,2);assert.equal(rows[0].fullEquivalentUsd,100);
  assert.equal(rows[0].resetAt,R);assert.equal(rows[0].current,true);
  assert.equal(rows[1].resetAt,R+2*H);assert.equal(rows[1].current,false);
});
test('newer unavailable sample does not relabel a saved older estimate as current',()=>{
  const rows=projectWeeklyEstimateChart('codex',[usage()],[snapshot(),snapshot({observedAt:N,
    fullEquivalentUsd:null,unusedEquivalentUsd:null,utilizationPercent:0})],{now:N});
  assert.equal(rows.length,1);assert.equal(rows[0].current,false);assert.equal(rows[0].observedAt,N-H);
});
test('no sample means local used-only, never a fabricated unused segment',()=>{
  const [row]=projectWeeklyEstimateChart('codex',[usage(R-7*D,12)],[],{now:N});
  assert.equal(row.usedEquivalentUsd,12);assert.equal(row.unusedEquivalentUsd,null);assert.equal(row.asOfEstimate,false);
});
test('future, other-provider and incoherent snapshots cannot become estimated bars',()=>{
  const invalid=[snapshot({observedAt:N+1}),snapshot({provider:'claude'}),snapshot({unusedEquivalentUsd:101}),
    snapshot({fullEquivalentUsd:NaN}),snapshot({observedAt:R-8*D})];
  const rows=projectWeeklyEstimateChart('codex',[usage()],invalid,{now:N});
  assert.equal(rows.length,1);assert.equal(rows[0].unusedEquivalentUsd,null);assert.equal(rows[0].usedEquivalentUsd,400);
});
test('a saved estimate remains renderable when raw usage rows are no longer present',()=>{
  const [row]=projectWeeklyEstimateChart('codex',[],[snapshot()],{now:N});
  assert.equal(row.fullEquivalentUsd,100);assert.equal(row.unusedEquivalentUsd,75);
});
