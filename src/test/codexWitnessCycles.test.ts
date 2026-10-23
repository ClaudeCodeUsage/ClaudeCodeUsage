import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {buildCodexWitnessCycles} from '../codexWitnessCycles';
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
