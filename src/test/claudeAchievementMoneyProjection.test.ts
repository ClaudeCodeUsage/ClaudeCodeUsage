import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {createClaudeUsageIndex} from '../claudeIncrementalIndex';
import * as projection from '../claudeAchievementMoneyProjection';
const model=(input:number):any=>({'claude-opus-5-5':{inputTokens:input,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,
  referenceUsage:{inputTokens:input,outputTokens:0,cacheReadTokens:0,cacheCreation5mTokens:0,cacheCreation1hTokens:0}}});
test('OFF and incomplete projection never iterate daily or uncapped session maps',()=>{
  const index=createClaudeUsageIndex();
  const bomb=()=>{throw Error('unexpected projection scan');};
  index.aggregates.byLocalDay.values=bomb; index.aggregates.bySession.values=bomb;
  assert.equal(projection.claudeAchievementMoneyProjection(index,'anthropic',new Date('2026-10-12'),false),undefined);
  assert.equal(projection.claudeAchievementMoneyProjection(index,'anthropic',new Date('2026-10-12'),true),undefined);
});
test('warm projection reuses the identical bounded DTO; new committed snapshot/backend/day changes invalidate it',()=>{
  const index=createClaudeUsageIndex(); index.timeZone='UTC';
  index.manifest={entries:new Map(),scannedAtMs:0,scanDurationMs:0};
  index.aggregates.allTime.modelBreakdown=model(25_000_000);
  index.aggregates.byLocalDay.set('2026-10-05',{modelBreakdown:model(25_000_000)} as any);
  for(let n=0;n<1001;n++) index.aggregates.bySession.set(String(n),{modelBreakdown:model(n===1000?50_000_000:1)} as any);
  const first=projection.claudeAchievementMoneyProjection(index,'anthropic',new Date('2026-10-12'),true)!;
  assert.equal(first.cumulative?.microUsd,100_000_000); assert.equal(first.maxSessionTask,200_000_000);
  assert.equal(first.completedMondayWeekPeak,100_000_000);
  const iterate=index.aggregates.bySession.values; let loops=0;
  index.aggregates.bySession.values=function(){loops++;return iterate.call(this);};
  assert.equal(projection.claudeAchievementMoneyProjection(index,'anthropic',new Date('2026-10-12T01:00Z'),true),first);
  assert.equal(loops,0);
  const next={...index,aggregates:{...index.aggregates,allTime:{...index.aggregates.allTime,modelBreakdown:model(50_000_000)}}};
  assert.equal(projection.claudeAchievementMoneyProjection(next,'anthropic',new Date('2026-10-12'),true)!.cumulative?.microUsd,200_000_000);
  assert.notEqual(projection.claudeAchievementMoneyProjection(index,'aws-bedrock-in-region',new Date('2026-10-12'),true),first);
  assert.notEqual(projection.claudeAchievementMoneyProjection(index,'anthropic',new Date('2026-10-13'),true),first);
});
