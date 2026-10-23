import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {buildCodexWitnessCycles,buildCodexWitnessLedger,copyCodexWitnessCycle} from '../codexWitnessCycles';
const T=1800000000000,R=T+604800000;
const v=(n:number)=>({inputTotal:n,cachedInput:0,outputTotal:0,reasoningOutput:0,sourceTotal:n});
const book={schemaVersion:1 as const,parserVersion:4,periodVersion:1,rates:[{model:'known',input:.01,cachedInput:.001,output:.02}]};
const row=(at:number,p:number,n:number,baseline=false,segment=0,model='known')=>({segment,from:T,through:T+at,resetAt:R,observedResetAt:R,usedPercent:p,baseline,
 byModel:baseline?{}:{[model]:v(n)},...(baseline?{baselineByModel:{[model]:v(n)}}:{}),complete:true});
test('witness cycles sum each source terminal and baseline once, not every cumulative row',()=>{
 const cycles=buildCodexWitnessCycles([{rows:[row(0,0,10,true),row(1000,10,20),row(2000,50,90)],primaryByModel:{known:v(100)}}],book,{now:T+3000});
 assert.equal(cycles.length,1);assert.equal(cycles[0].knownUsd,1);assert.equal(cycles[0].knownTokens,100);
 assert.equal(cycles[0].referenceCapacityUsd,1.8);
});
test('an unpriced source and incomplete rows preserve known amounts with partial coverage',()=>{
 const cycles=buildCodexWitnessCycles([
  {rows:[row(0,0,10,true),{...row(2000,50,90),complete:false}],primaryByModel:{known:v(100)},hasUnknownGap:true},
  {rows:[row(1000,10,5,true,0,'unpriced'),row(2000,50,15,false,0,'unpriced')],primaryByModel:{unpriced:v(20)}}],book,{now:T+3000});
 assert.equal(cycles[0].knownUsd,1);assert.equal(cycles[0].unpricedTokens,20);assert.equal(cycles[0].partial,true);
 assert.equal(cycles[0].referenceCapacityUsd,1.8);
});
test('nonzero first percentage uses the common interval delta, excluding only its starting request',()=>{
 const [c]=buildCodexWitnessCycles([{rows:[row(0,20,50,true),row(1000,40,50)],primaryByModel:{known:v(100)}}],book,{now:T+3000});
 assert.equal(c.knownUsd,1);assert.equal(c.referenceCapacityUsd,2.5);
});
test('future rows and vectors exceeding the primary source are not admitted',()=>{
 const [c]=buildCodexWitnessCycles([{rows:[row(0,0,10,true),row(1000,10,20),row(4000,80,90)],primaryByModel:{known:v(100)}}],book,{now:T+2000});
 assert.equal(c.knownUsd,.3);
 assert.deepEqual(buildCodexWitnessCycles([{rows:[row(0,0,10,true),row(1000,50,200)],primaryByModel:{known:v(100)}}],book,{now:T+3000}),[]);
});
test('small concurrent percentage jitter remains explicit uncertainty rather than erasing the reference',()=>{
 const [c]=buildCodexWitnessCycles([{rows:[row(0,10,10,true),row(1000,15,20),row(2000,13,40),row(3000,20,100)],primaryByModel:{known:v(110)}}],book,{now:T+4000});
 assert.equal(c.knownUsd,1.1);assert.equal(c.deltaUsd,1);assert.equal(c.referenceCapacityUsd,10);
 assert.equal(c.counterConflict,true);assert.equal(c.partial,true);
});
test('an observed reset within the same reset anchor produces two independent cycle rows',()=>{
 const b={...row(2000,0,20,true,1),from:T+2000};
 const last={...row(3000,20,200,false,1),from:T+2000};
 const c=buildCodexWitnessCycles([{rows:[row(0,80,100,true),row(1000,90,100),b,last],primaryByModel:{known:v(420)}}],book,{now:T+4000});
 assert.equal(c.length,2);assert.deepEqual(c.map(x=>x.knownUsd),[2,2.2]);
 assert.deepEqual(c.map(x=>x.referenceCapacityUsd),[10,10]);
 assert.ok(c[0].through<c[1].from);
});
test('primary usage without quota witnesses remains separate coverage, never donated to a cycle',()=>{
 const result=buildCodexWitnessLedger([{rows:[],primaryByModel:{known:v(300)},hasUnknownGap:true},
  {rows:[row(0,0,10,true),row(1000,10,20)],primaryByModel:{known:v(30)}}],book,{now:T+2000});
 assert.equal(result.cycles[0].knownUsd,.3);assert.equal(result.cycles[0].partial,true);
 assert.equal(result.coverage.unplacedSources,1);assert.equal(result.coverage.unlocatedPrimaryUsd,3);
 const empty=buildCodexWitnessLedger([{rows:[],primaryByModel:{known:v(300)}}],book,{now:T});
 assert.equal(empty.cycles.length,0);assert.equal(empty.coverage.unplacedSources,1);
});
test('same-time cumulative updates keep all known usage and use the last post-request endpoint',()=>{
 const [c]=buildCodexWitnessCycles([{rows:[row(0,0,10,true),row(0,1,20),row(1000,11,120)],primaryByModel:{known:v(130)}}],book,{now:T+2000});
 assert.equal(c.knownUsd,1.3);assert.equal(c.deltaUsd,1);assert.equal(c.percentFrom,1);
 assert.equal(c.referenceCapacityUsd,10);assert.equal(c.unavailableSources,0);
});
test('retained witness evidence validates arithmetic and strips identifiers',()=>{
 const [c]=buildCodexWitnessCycles([{rows:[row(0,0,10,true),row(1000,10,20)],primaryByModel:{known:v(30)}}],book,{now:T+2000});
 assert.deepEqual(copyCodexWitnessCycle({...c,sourceKey:'PRIVATE-CANARY'}),c);
 for(const bad of [{...c,referenceCapacityUsd:999},{...c,sources:0},{...c,requestedThrough:T},
  {...c,knownTokens:0},{...c,unavailableSources:1,partial:false},{...c,cycleEndAt:T}])
   assert.equal(copyCodexWitnessCycle(bad),undefined);
});
test('window budget omissions are explicit coverage rather than complete history',()=>{
 const sources=Array.from({length:513},(_,i)=>({rows:[{...row(0,0,10,true),resetAt:R+i*604800000}],primaryByModel:{known:v(10)}}));
 const result=buildCodexWitnessLedger(sources,book,{now:T+2000});
 assert.equal(result.cycles.length,512);assert.equal(result.coverage.rejectedSources,1);
 assert.ok(result.cycles.every(c=>c.partial&&c.unavailableSources===1));
});
test('touching open-left reset brackets describe separate episodes',()=>{
 const b=(at:number,p:number,s:number)=>({...row(at,p,10,true,s),from:T+at});
 const rows=[b(0,80,0),row(1000,90,10),b(2000,50,1),b(3000,10,2),{...row(4000,20,10,false,2),from:T+3000}];
 const cycles=buildCodexWitnessCycles([{rows,primaryByModel:{known:v(50)}}],book,{now:T+5000});
 assert.equal(cycles.length,3);assert.equal(cycles[2].referenceCapacityUsd,1);
});
test('nearby reset anchors cannot group observations after the earlier deadline',()=>{
 const sources=[{rows:[{...row(0,10,10,true),resetAt:T+1000},{...row(900,20,10),resetAt:T+1000}],primaryByModel:{known:v(20)}},
 {rows:[{...row(1500,30,10,true),from:T+1500,resetAt:T+3000},{...row(1600,40,10),from:T+1500,resetAt:T+3000}],primaryByModel:{known:v(20)}}];
 const cycles=buildCodexWitnessCycles(sources,book,{now:T+2000});
 assert.equal(cycles.length,2);assert.ok(cycles.every(c=>copyCodexWitnessCycle(c)));
});
test('invalid component differences reject the source without throwing',()=>{
 const rows=[row(0,0,10,true),row(0,1,20),{...row(1000,11,30),byModel:{known:{...v(30),cachedInput:20}}}];
 const result=buildCodexWitnessLedger([{rows,primaryByModel:{known:{...v(40),cachedInput:20}}}],book,{now:T+2000});
 assert.equal(result.cycles.length,0);assert.equal(result.coverage.rejectedSources,1);
});
