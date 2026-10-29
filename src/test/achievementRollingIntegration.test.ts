import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {achievementCalendarSignals,type AchievementDayEvidence} from '../achievementCalendar';
import {claudeAchievementMoneyScopes,claudeMoneyEvidenceFromModels} from '../achievementMoneyScopes';
import {achievementHistoryDates} from '../achievementHistoryDates';
import {achievementRuleVersion} from '../achievementRuleVersions';
import {parseAchievementRecordStore,AchievementRecordRepository,loadAchievementRecords} from '../achievementRecordStore';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {achievementRollingPeak} from '../achievementRollingPeak';
import {evaluateAchievements} from '../achievements';

const model='claude-opus-5-5';
const day=(day:string,n:number)=>({day,processed:n,output:0,models:{[model]:{processed:n,output:0}}});
const proof=(rows:AchievementDayEvidence['days'],complete=true):AchievementDayEvidence=>({complete,days:rows,timeZone:'UTC',...(!complete?{scope:'verified-subset' as const}:{})});
const models=(n:number)=>({[model]:{inputTokens:n,outputTokens:0,cacheCreationTokens:0,cacheReadTokens:0,
 referenceUsage:{inputTokens:n,outputTokens:0,cacheCreation5mTokens:0,cacheCreation1hTokens:0,cacheReadTokens:0}}});

test('production Token calendar evaluates a closed seven-day window crossing Monday, not a natural week',()=>{
 const rows=[day('2026-10-01',3e8),day('2026-10-05',3e8),day('2026-10-08',9e9)];
 const result=achievementCalendarSignals({claude:proof(rows),codex:proof([]),asOfDay:'2026-10-08'}) as any;
 assert.equal(result.rollingSevenDayPeak,6e8);
 assert.deepEqual(result.rollingSevenDayWindow,{startDay:'2026-10-01',endDay:'2026-10-07'});
 assert.equal((achievementCalendarSignals({claude:proof(rows.slice(0,2)),codex:proof([]),asOfDay:'2026-10-07'}) as any).rollingSevenDayPeak,undefined);
});

test('frozen API money uses the same closed seven-day boundary and never reuses a Monday scope',()=>{
 const result=claudeAchievementMoneyScopes({backend:'anthropic',asOfDay:'2026-10-08',allTimeModels:models(1e9),days:{complete:true,
  rows:[{date:'2026-10-01',models:models(2e7)},{date:'2026-10-05',models:models(2e7)},{date:'2026-10-08',models:models(1e9)}]}}) as any;
 assert.equal(result.completedRollingSevenDayPeak,160_000_000);
 assert.deepEqual(result.rollingSevenDayWindow,{startDay:'2026-10-01',endDay:'2026-10-07'});
});

test('new rule dates require a seven-day closed witness; old receipts and pins keep their original version and day',()=>{
 const rows=[day('2026-10-01',3e8),day('2026-10-05',3e8)];
 const input={timeZone:'UTC',asOfDay:'2026-10-08',claude:proof(rows),codex:proof([]),enabled:{claude:true,codex:false}};
 const date=achievementHistoryDates(input)['weekly-volume-bronze'] as any;
 assert.equal(date?.day,'2026-10-08');
 assert.equal(date?.ruleVersion,3);
 assert.equal(date?.windowStartDay,'2026-10-01');assert.equal(date?.windowEndDay,'2026-10-07');
 assert.equal(achievementHistoryDates({...input,asOfDay:'2026-10-07'})['weekly-volume-bronze'],undefined);
 assert.equal(achievementHistoryDates({...input,claude:proof(rows,false)})['weekly-volume-bronze'],undefined);
 assert.equal(achievementRuleVersion('weekly-volume-bronze'),3);
 assert.equal(achievementRuleVersion('active-weeks-bronze'),1);
 const old={schemaVersion:2,catalogVersion:2,generation:1,sequence:1,lastNoticeAt:17,pins:['weekly-volume'],
  records:[{id:'weekly-volume-bronze',ruleVersion:1,seq:1,origin:'usage',recordedDay:'2026-09-07',timeZone:'UTC',unread:false}],
  auxiliary:{activity:{schemaVersion:2,settingKeys:[],features:[]},hours:{schemaVersion:3,maxStreak:0},calendarPeak:null},
  legacyRecords:[],showcaseMode:'manual',pinRevision:1,legacyBoundary:null};
 const parsed=parseAchievementRecordStore(old);
 assert.deepEqual(parsed.records,old.records);assert.deepEqual(parsed.pins,old.pins);assert.equal(parsed.lastNoticeAt,17);
});

test('rolling adapter rejects malformed/duplicate/future input and keeps partial evidence out of earliest dates',()=>{
 const complete=[{day:'2024-02-27',coverage:'complete' as const,units:9n},{day:'2024-03-04',coverage:'complete' as const,units:8n}];
 const before=JSON.stringify(complete,(_,v)=>typeof v==='bigint'?v.toString():v);
 const actual=achievementRollingPeak({days:complete,asOfDay:'2024-03-05',complete:true,thresholds:[17n]});
 assert.equal(actual.units,17n);assert.deepEqual(actual.window,{startDay:'2024-02-27',endDay:'2024-03-04'});
 assert.deepEqual(actual.first.get(17n),actual.window);
 for(const days of [[...complete,complete[0]],[{...complete[0],day:'2024-02-30'}],
   [{...complete[0],day:'2024-03-06'}],[{...complete[0],units:-1n}]]){
  assert.equal(achievementRollingPeak({days,asOfDay:'2024-03-05',complete:true}).units,undefined);
 }
 const partial=achievementRollingPeak({days:complete,asOfDay:'2024-03-05',complete:false,thresholds:[17n]});
 assert.equal(partial.units,17n);assert.equal(partial.lowerBound,true);assert.equal(partial.first.size,0);
 assert.equal(JSON.stringify(complete,(_,v)=>typeof v==='bigint'?v.toString():v),before);
});

test('year boundary, ties, sparse epochs, exact bigint sums and the live day follow the shared closed-window reducer',()=>{
 const a={day:'2023-12-29',coverage:'complete' as const,units:BigInt(Number.MAX_SAFE_INTEGER)};
 const b={day:'2024-01-04',coverage:'complete' as const,units:2n};
 const huge=achievementRollingPeak({days:[b,a,{day:'2024-01-05',coverage:'complete',units:10n**30n}],asOfDay:'2024-01-05',complete:true});
 assert.equal(huge.units,BigInt(Number.MAX_SAFE_INTEGER)+2n);
 assert.deepEqual(huge.window,{startDay:'2023-12-29',endDay:'2024-01-04'});
 const sparse=achievementRollingPeak({days:[{day:'0001-01-01',coverage:'complete',units:9n},
  {day:'9999-01-01',coverage:'complete',units:9n}],asOfDay:'9999-01-08',complete:true});
 assert.equal(sparse.units,9n);assert.deepEqual(sparse.window,{startDay:'0001-01-01',endDay:'0001-01-07'});
});

test('record initialization preserves old calendar receipts/pins and new rolling awards get rule 3 without date rewriting',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ccu-rolling-migration-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=path.join(root,'achievements-v2.json');
 const old={schemaVersion:2,catalogVersion:2,generation:1,sequence:1,lastNoticeAt:17,pins:['weekly-volume'],
  records:[{id:'weekly-volume-bronze',ruleVersion:1,seq:1,origin:'usage',recordedDay:'2026-09-07',timeZone:'UTC',unread:false}],
  auxiliary:{activity:{schemaVersion:2,settingKeys:[],features:[]},hours:{schemaVersion:3,maxStreak:0},calendarPeak:null},
  legacyRecords:[],showcaseMode:'manual',pinRevision:1,legacyBoundary:null};
 await writeFile(file,JSON.stringify(old));
 const repo=new AchievementRecordRepository(file),initial=await repo.initialize([]);
 assert.deepEqual(initial.records,old.records);assert.deepEqual(initial.pins,old.pins);
 const next=await repo.append(initial.generation,[{id:'weekly-volume-silver',origin:'history',recordedDay:null,timeZone:null}]);
 assert.equal(next.store.catalogVersion,3);assert.deepEqual(next.store.records[0],old.records[0]);
 assert.equal(next.store.records[1].ruleVersion,3);assert.deepEqual(next.store.pins,old.pins);
 const reopened=await new AchievementRecordRepository(file).initialize([]);
 assert.deepEqual(reopened,next.store);assert.deepEqual((await loadAchievementRecords(file))!.records[0],old.records[0]);
});

test('a retired natural-week Money DTO cannot satisfy the rolling monetary rule',()=>{
 const facts:any={claudeTokens:0,codexTokens:0,activeDays:0,claudeFamilies:[],codex:{modelCount:0,efforts:[],familyRootCounts:{astra:0,sol:0,luna:0}},
  money:{claude:{provider:'claude',backend:'anthropic',pricebookVersion:claudeMoneyEvidenceFromModels(models(1),'anthropic').pricebookVersion,
   completedMondayWeekPeak:10**12,coverage:{completedMondayWeekPeak:{status:'complete'}}}}};
 assert.ok(evaluateAchievements(facts).filter(r=>r.id.startsWith('claude-api-week-')).every(r=>!r.unlocked));
});

test('civil seven-day boundaries ignore a DST hour change and reject mixed normalization zones',()=>{
 const days=Array.from({length:7},(_,i)=>day('2024-03-'+String(25+i),100_000_000));
 const claude={...proof(days),timeZone:'Europe/Berlin'},codex={...proof([]),timeZone:'Europe/Berlin'};
 const result=achievementCalendarSignals({claude,codex,asOfDay:'2024-04-01'});
 assert.equal(result.rollingSevenDayPeak,700_000_000);
 assert.deepEqual(result.rollingSevenDayWindow,{startDay:'2024-03-25',endDay:'2024-03-31'});
 assert.equal(achievementCalendarSignals({claude,codex:{...codex,timeZone:'UTC'},asOfDay:'2024-04-01'}).rollingSevenDayPeak,undefined);
});
