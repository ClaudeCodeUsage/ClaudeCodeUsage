import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {achievementHistoryDates,claudeAchievementSessionHistory,codexAchievementHistoryEvidence,
 type AchievementHistoryDay, type AchievementHistoryInput} from '../achievementHistoryDates';
import {claudeMoneyEvidenceFromModels} from '../achievementMoneyScopes';
import {snapshotFixture} from './codexFixtures';
import {CODEX_PERIOD_LINEAGE_VERSION} from '../providers/codex/codexPeriodIndex';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {createClaudeUsageIndex,updateClaudeUsageIndex,claudeUsageDashboardSnapshot} from '../claudeIncrementalIndex';
const row=(day:string,processed:number,output=1):AchievementHistoryDay=>({
  day,processed,output,models:{'claude-sonnet-4-5':{processed,output}},cacheRead:0,cacheCreation:0,
});
const input=(days:AchievementHistoryDay[]):AchievementHistoryInput=>({
  timeZone:'UTC',asOfDay:'2026-10-14',claude:{complete:true,timeZone:'UTC',days},
  codex:{complete:true,timeZone:'UTC',days:[]},enabled:{claude:true,codex:false},
});
test('each Token level gets its own first retained-log crossing, independent of input order',()=>{
 const proof=input([row('2026-10-03',900_000_000),row('2026-10-01',60_000_000),row('2026-10-02',40_000_000)]);
 const result=achievementHistoryDates(proof);
 assert.equal(result['sonnet-main']?.day,'2026-10-02');
 assert.equal(result['sonnet-main-silver']?.day,'2026-10-03');
 assert.equal(result['sonnet-main-gold'],undefined);
 assert.equal(result['sonnet-main']?.ruleVersion,1);
 assert.equal(result['sonnet-main']?.schemaVersion,1);
 assert.equal(result['sonnet-main']?.timeZone,'UTC');
 assert.deepEqual(achievementHistoryDates({...proof,claude:{...proof.claude,days:[...proof.claude.days].reverse()}}),result);
});
test('future, invalid, duplicate, inconsistent and foreign-zone evidence cannot manufacture a date',()=>{
 for(const proof of [
  input([row('2026-10-15',1e9)]),
  input([row('2026-02-30',1e9)]),
  input([row('2026-10-01',1e9),row('2026-10-01',1e9)]),
  input([{...row('2026-10-01',1e9),output:1e9+1}]),
  {...input([row('2026-10-01',1e9)]),timeZone:'Asia/Shanghai'},
  input([{...row('2026-10-01',1e9),models:{'claude-sonnet-4-5':{processed:2e9,output:1}}}]),
 ])assert.equal(achievementHistoryDates(proof)['sonnet-main'],undefined);
});
test('subset dates are labelled as witnessed lower-bound history, not an absolute attainment date',()=>{
 const proof=input([row('2026-10-01',1e9)]);
 proof.claude={...proof.claude,complete:false,scope:'verified-subset'};
 assert.equal(achievementHistoryDates(proof)['sonnet-main']?.scope,'verified-subset');
 proof.claude={...proof.claude,scope:undefined};
 assert.equal(achievementHistoryDates(proof)['sonnet-main'],undefined);
});
test('family days are ended days; active-day rules include today as the existing evaluator does',()=>{
 const proof=input(Array.from({length:30},(_,i)=>row('2026-09-'+String(i+1).padStart(2,'0'),1)));
 assert.equal(achievementHistoryDates(proof)['active-days-bronze']?.day,'2026-09-30');
 assert.equal(achievementHistoryDates(proof)['sonnet-days-bronze'],undefined);
 const days=Array.from({length:7},(_,i)=>row('2026-10-'+String(i+1).padStart(2,'0'),1e6));
 const dated=achievementHistoryDates(input(days));
 assert.equal(dated['sonnet-days-bronze']?.day,'2026-10-08');
 assert.equal(dated['active-day-streak']?.day,'2026-10-07');
 assert.equal(achievementHistoryDates({...input(days),asOfDay:'2026-10-07'})['active-day-streak']?.day,'2026-10-07');
 assert.equal(achievementHistoryDates({...input(days),asOfDay:'2026-10-07'})['sonnet-days-bronze'],undefined);
});
test('zero-volume dates do not supply the first full week for the four-week average',()=>{
 const proof={...input([row('2026-09-07',0,0),row('2026-09-08',2e9),row('2026-09-14',2e9)]),asOfDay:'2026-10-05'};
 assert.equal(achievementHistoryDates(proof)['weekly-average-bronze'],undefined);
 assert.equal(achievementHistoryDates({...proof,asOfDay:'2026-10-12'})['weekly-average-bronze']?.day,'2026-10-12');
});
test('unsupported joint/session/action/price scopes stay unknown; frozen ledger data is never edited',()=>{
 const proof=input([row('2026-10-01',1e12)]);
 Object.freeze(proof.claude.days[0]);Object.freeze(proof.claude.days);
 const dated=achievementHistoryDates(proof);
 for(const id of ['agent-standup','effort-explorer','claude-output-sessions-bronze','local-share-export','claude-money-total-bronze']){
  assert.equal((dated as Record<string,unknown>)[id],undefined);
 }
 assert.ok(Object.isFrozen(dated));assert.ok(Object.isFrozen(dated['sonnet-main']));
 assert.deepEqual(Object.keys(dated['sonnet-main']!).sort(),['day','ruleVersion','schemaVersion','scope','timeZone']);
});
test('overflow and invalid optional cache values cannot date counters from a capped or normalized number',()=>{
 const proof=input([{...row('2026-10-01',1e9),cacheRead:-1}]);
 assert.equal(achievementHistoryDates(proof)['cache-wizard'],undefined);
 assert.equal(achievementHistoryDates(input([row('2026-10-01',Number.MAX_SAFE_INTEGER),row('2026-10-02',1)]))['sonnet-main'],undefined);
});
test('fixed-reference money dates sum exact units and wait for completed Monday weeks',()=>{
 const priced=(day:string,n:number)=>{
  const money=claudeMoneyEvidenceFromModels({'claude-sonnet-4-5':{inputTokens:n,outputTokens:0,
   cacheReadTokens:0,cacheCreationTokens:0,referenceUsage:{inputTokens:n,outputTokens:0,cacheReadTokens:0,
    cacheCreation5mTokens:0,cacheCreation1hTokens:0}}},'anthropic');
  assert.equal(money.status,'complete');
  return {...row(day,n,0),money:money as any};
 };
 const proof=input([priced('2026-10-01',1e8),priced('2026-10-02',3e8)]);
 assert.equal(achievementHistoryDates(proof)['claude-api-total-bronze']?.day,'2026-10-01');
 assert.equal(achievementHistoryDates(proof)['claude-api-total-silver']?.day,'2026-10-02');
 assert.equal(achievementHistoryDates({...proof,asOfDay:'2026-10-04'})['claude-api-week-bronze'],undefined);
 assert.equal(achievementHistoryDates({...proof,asOfDay:'2026-10-05'})['claude-api-week-silver']?.day,'2026-10-05');
 assert.equal(achievementHistoryDates(proof)['claude-api-session-bronze'],undefined);
 assert.match(achievementHistoryDates(proof)['claude-api-total-bronze']!.pricebookVersion!,/anthropic/);
 const forged=structuredClone(proof);forged.claude.days[0].money={...forged.claude.days[0].money!,pricebookVersion:'future-book'};
 assert.equal(achievementHistoryDates(forged)['sonnet-main']?.day,'2026-10-01','price failure cannot erase Token proof');
});
test('manual all-session projection counts first output once per parent and ignores unowned/future/content',()=>{
 const record=(id:string,time:string,model='claude-sonnet-4-5')=>Object.defineProperty({
  timestamp:time,_sessionId:id,message:{model,usage:{input_tokens:0,output_tokens:1,cache_creation_input_tokens:0,cache_read_input_tokens:0}},
 },'content',{get(){throw Error('conversation content is not required');}})as any;
 const records=Array.from({length:10},(_,i)=>record('s'+i,'2026-10-01T20:00:00Z'));
 records.push(record('s0','2026-10-02T20:00:00Z'),record('s0','2026-10-03T20:00:00Z','claude-fable-5'));
 records.push({...record('flat','2026-10-01T20:00:00Z'),_unownedAgentSession:true});
 records.push(record('future','2026-10-15T20:00:00Z'));
 const days=claudeAchievementSessionHistory(records,'Asia/Shanghai',Date.parse('2026-10-14T00:00:00Z'),new Set(records.map((r:any)=>r._sessionId)));
 assert.equal(days[0].day,'2026-10-02');assert.equal(days[0].outputSessions,10);
 assert.equal(days[1].day,'2026-10-04');assert.equal(days[1].fableSessions,1);assert.equal(days[1].mixedSessions,1);
 const proof={...input([row('2026-10-02',100)]),timeZone:'Asia/Shanghai',
  claude:{...input([]).claude,timeZone:'Asia/Shanghai',days:[row('2026-10-02',100)]},
  codex:{complete:true,timeZone:'Asia/Shanghai',days:[]},claudeSessions:days};
 assert.equal(achievementHistoryDates(proof)['claude-output-sessions-bronze']?.day,'2026-10-02');
 assert.equal(achievementHistoryDates(proof)['fable-relay']?.day,'2026-10-04');
 assert.equal(JSON.stringify(days).includes('s0'),false);
 assert.deepEqual(achievementHistoryDates({...proof,enabled:{claude:false,codex:false}}),{});
 assert.deepEqual(claudeAchievementSessionHistory(records,'Asia/Shanghai',Date.parse('2026-10-14T00:00:00Z')),[],
  'missing uncapped eligibility cannot be inferred from raw output');
});
test('Codex cache and monetary dating require an independently settled fully dated selection',()=>{
 const files=snapshotFixture().files.slice(0,2);
 for(const file of files){
  Object.assign(file.period!,{indexedThrough:100,lineageVersion:CODEX_PERIOD_LINEAGE_VERSION,lineagePrefixEvents:0});
  file.achievementPeriodWitness={size:100,offset:100,expectedPrefixEvents:0,timeZone:'UTC'};
 }
 const proof=codexAchievementHistoryEvidence(files,'UTC',true,true);
 assert.equal(proof.complete,true);assert.ok(proof.days.length>0);
 assert.ok(proof.days.some(row=>typeof row.cacheRead==='number'));
 assert.ok(proof.days.every(row=>row.money?.provider==='codex'));
 for(const file of files)file.achievementPeriodWitness!.offset--;
 assert.deepEqual(codexAchievementHistoryEvidence(files,'UTC',true,true).days,[]);
 assert.deepEqual(codexAchievementHistoryEvidence(files,'UTC',false,true).days,[]);
});
test('session dates use the same uncapped admission as the canonical index, not unknown-model output alone',async t=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'ccu-date-admission-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const project=path.join(home,'projects','-anonymous');await mkdir(project,{recursive:true});
 for(let i=0;i<20;i++){
  const unknown=i<10,day=unknown?'2026-10-01':'2026-10-05';
  await writeFile(path.join(project,'session-'+i+'.jsonl'),JSON.stringify({type:'assistant',
   timestamp:day+'T12:00:00Z',requestId:'r'+i,message:{id:'m'+i,model:unknown?'<unknown>':'claude-sonnet-4-5',
    usage:{input_tokens:0,output_tokens:100,cache_creation_input_tokens:0,cache_read_input_tokens:0}}})+'\n');
 }
 const loaded=await updateClaudeUsageIndex(createClaudeUsageIndex(),home,{analyzeContent:false});
 assert.equal(loaded.records.length,20,'output remains real usage even if a display session is inadmissible');
 const snapshot=claudeUsageDashboardSnapshot(loaded.index);
 assert.equal(snapshot.achievementSessionEvidence.outputSessions,10);
 const eligible=new Set([...loaded.index.sessionRows.values()].filter(row=>!row._unownedAgentSession&&
  (row.data.messageCount>0||row.data.totalCost>0)).map(row=>row.sessionId));
 const days=claudeAchievementSessionHistory(loaded.records,'UTC',Date.parse('2026-10-14T00:00:00Z'),eligible);
 assert.deepEqual(days,[{day:'2026-10-05',outputSessions:10,fableSessions:0,mixedSessions:0}]);
 assert.equal(achievementHistoryDates({...input([row('2026-10-01',1e9)]),claudeSessions:days})
  ['claude-output-sessions-bronze']?.day,'2026-10-05');
});
test('a session cannot be dated before the prompt or positive cost that made it admissible',()=>{
 const record=(session:string,day:string,model:string)=>({_sessionId:session,type:'assistant',timestamp:day+'T12:00:00Z',
  message:{id:session+day,model,usage:{input_tokens:0,output_tokens:100,cache_creation_input_tokens:0,cache_read_input_tokens:0}}}as any);
 const rows=Array.from({length:9},(_,i)=>record('known'+i,'2026-10-01','claude-sonnet-4-5'));
 rows.push(record('later','2026-10-01','<unknown>'),record('later','2026-10-05','claude-sonnet-4-5'));
 const eligible=new Set(rows.map(r=>r._sessionId));
 const days=claudeAchievementSessionHistory(rows,'UTC',Date.parse('2026-10-14T00:00:00Z'),eligible);
 assert.equal(days.find(d=>d.day==='2026-10-01')?.outputSessions,9);
 assert.equal(days.find(d=>d.day==='2026-10-05')?.outputSessions,1);
 assert.equal(achievementHistoryDates({...input([row('2026-10-01',1e9)]),claudeSessions:days})
  ['claude-output-sessions-bronze']?.day,'2026-10-05');
 const prompted=[record('prompted','2026-10-01','<unknown>'),{...record('prompted','2026-10-06','<synthetic>'),_isUserPrompt:true}];
 assert.equal(claudeAchievementSessionHistory(prompted,'UTC',Date.parse('2026-10-14T00:00:00Z'),new Set(['prompted']))[0].day,'2026-10-06');
});
