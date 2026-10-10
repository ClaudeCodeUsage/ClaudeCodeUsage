import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as https from 'node:https';
import {ClaudeDataLoader} from '../dataLoader';
import {buildApiHeatmapDaily} from '../apiHeatmapDaily';
import {fetchLatestPricing,calculateCostBreakdown} from '../pricing';
import type {ClaudeUsageRecord} from '../types';
const day='2026-10-10';
const options={startDateISO:day,endDateISO:day,timezone:'UTC',provider:'claude' as const,
  metric:'apiEquivalent' as const,showAmounts:true};
function producer(model:string,input:number,output:number,cacheRead=0,cacheWrite=0) {
  const usage={input_tokens:input,output_tokens:output,cache_read_input_tokens:cacheRead,cache_creation_input_tokens:cacheWrite};
  const record={type:'assistant',timestamp:day+'T12:00:00Z',message:{model,usage}} as ClaudeUsageRecord;
  const data=ClaudeDataLoader.calculateUsageData([record]);
  return {data,point:buildApiHeatmapDaily([{date:day,data}],[],options)[day]!.claude!,usage};
}
test('actual producer generic default estimate cannot become fully priced unknown-model sharing coverage',()=>{
  const {data,point}=producer('audit-unlisted-zeta',100,0);
  assert.ok(data.totalCost>0,'legacy default estimate is deliberately unchanged');
  assert.equal(point.tokens,100);assert.equal(point.amountUSD,null);assert.equal(point.pricingStatus,'unpriced');
  assert.equal(point.pricedCount,0);assert.equal(point.unpricedCount,100);
});
test('recognized family fallback remains a current estimate, without substituting achievement reference pricing',()=>{
  const {data,point}=producer('claude-sonnet-next-audit',100,0);
  assert.equal(point.amountUSD,data.totalCost);assert.equal(point.estimated,true);assert.equal(point.pricingStatus,'complete');
  assert.equal(point.pricedCount,100);assert.equal(point.unpricedCount,0);
});
test('actual runtime missing component rates remain unpriced; explicit zero rates are real priced zero',async context=>{
  class Response extends EventEmitter {statusCode=200;headers={};setEncoding(){} resume(){} destroy(){}}
  class Request extends EventEmitter {destroy() {}}
  const response=new Response();
  context.mock.method(https,'get',(_url:unknown,_options:unknown,callback:(r:Response)=>void)=>{
    queueMicrotask(()=>callback(response));return new Request();
  });
  const fetched=fetchLatestPricing();await Promise.resolve();
  response.emit('data',JSON.stringify({
    'audit-custom':{input_cost_per_token:0.000003},
    'audit-custom-zero':{input_cost_per_token:0,output_cost_per_token:0,
      cache_read_input_token_cost:0,cache_creation_input_token_cost:0},
  }));response.emit('end');await fetched;
  const missing=producer('audit-custom',0,100);
  assert.equal(missing.data.totalCost,0,'legacy missing-rate cost is unchanged');
  assert.equal(missing.point.pricingStatus,'unpriced');assert.equal(missing.point.amountUSD,null);
  assert.equal(missing.point.pricedCount,0);assert.equal(missing.point.unpricedCount,100);
  const partial=producer('audit-custom',100,100,25,50);
  assert.equal(partial.point.pricingStatus,'partial');assert.equal(partial.point.pricedCount,100);
  assert.equal(partial.point.unpricedCount,175);assert.equal(partial.point.amountUSD,partial.data.totalCost);
  assert.deepEqual(calculateCostBreakdown(partial.usage,'audit-custom'),partial.data.costBreakdown,
    'existing cost algorithm and breakdown stay identical');
  const zero=producer('audit-custom-zero',100,100,25,50);
  assert.equal(zero.point.pricingStatus,'complete');assert.equal(zero.point.amountUSD,0);
  assert.equal(zero.point.pricedCount,275);assert.equal(zero.point.unpricedCount,0);
  const hidden=buildApiHeatmapDaily([{date:day,data:partial.data}],[],{...options,metric:'tokens',showAmounts:false});
  assert.equal(hidden[day]!.claude!.tokens,275);assert.equal(hidden[day]!.claude!.amountUSD,null);
});
