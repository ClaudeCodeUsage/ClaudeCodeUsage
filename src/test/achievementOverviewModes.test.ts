import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {selectAchievementOverview, retainAchievementOverview, AchievementOverviewCandidate} from '../achievementOverview';
const keys=['sonnet-main','opus-cannon','haiku-worker','astra-regular','sol-regular','luna-regular'];
const rows: AchievementOverviewCandidate[]=keys.map((key,i)=>({key,group:i<3?'claude':'codex',
  earnedLevel:1,earned:true,next:false,progress:1,target:1,proof:'ready'}));
const select=selectAchievementOverview as (...args:any[])=>ReturnType<typeof selectAchievementOverview>;

test('manual showcase displays six explicit themes in saved order without automatic padding',()=>{
  assert.deepEqual(select(rows,'claude',keys,'manual').badges,keys);
  assert.deepEqual(select(rows,'codex',keys.slice(2,3),'manual').badges,keys.slice(2,3));
});
test('manual empty selection stays empty and automatic ignores retained manual choices',()=>{
  assert.deepEqual(select(rows,'claude',[],'manual').badges,[]);
  assert.deepEqual(select(rows,'claude',keys.slice(3),'automatic').badges,select(rows,'claude',[]).badges);
});
test('a live update preserves all six valid manual representatives and never fills a retired slot',()=>{
  const selection={badges:keys.slice(),next:[]};
  assert.deepEqual(retainAchievementOverview(selection,rows).badges,keys);
  assert.deepEqual(retainAchievementOverview(selection,rows.slice(1)).badges,keys.slice(1));
});
test('manual display deduplicates legacy aliases but never grants a badge from the pin alone',()=>{
  const noAwards=rows.map(row=>({...row,earned:false}));
  assert.deepEqual(select(noAwards,'claude',keys,'manual').badges,[]);
  assert.deepEqual(select(rows,'claude',['sonnet-main','sonnet-main-silver'],'manual').badges,['sonnet-main']);
});
