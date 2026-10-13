import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {AchievementRecordRepository,loadAchievementRecords} from '../achievementRecordStore';
const money=require('../achievementMoney') as typeof import('../achievementMoney');

test('published monetary history stays readable, immutable and clearable after the current reference changes',async(t)=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'ccu-reference-history-'));
  const original=money.getAchievementMoneyPricebook;
  t.after(async()=>{money.getAchievementMoneyPricebook=original;await rm(directory,{recursive:true,force:true});});
  const file=path.join(directory,'achievements-v2.json'),repository=new AchievementRecordRepository(file);
  const initial=await repository.initialize([]);
  const oldBook=original('anthropic').version;
  const old=await repository.append(initial.generation,[
    {id:'sonnet-main',origin:'history',recordedDay:null,timeZone:null},
    {id:'claude-api-total-bronze',origin:'history',recordedDay:null,timeZone:null,referencePricebook:oldBook},
  ]);
  const before=await readFile(file);
  // Simulate a future build selecting a revised current book, without changing
  // production rates or introducing an unpublished version into the registry.
  money.getAchievementMoneyPricebook=(backend)=>({...original(backend),version:original(backend).version.replace(/-v1$/,'-v2')});
  assert.deepEqual((await loadAchievementRecords(file))!.records,old.store.records);
  assert.deepEqual(await readFile(file),before,'loading never relabels historical reference identities');
  const reloaded=new AchievementRecordRepository(file);
  const adopted=await reloaded.initialize([]);
  await assert.rejects(reloaded.recordUsage(adopted.generation,adopted.sequence,['claude-api-total-silver'],
    {recordedDay:'2026-10-13',timeZone:'UTC',referencePricebooks:{'claude-api-total-silver':oldBook}}),/invalid/,
    'a readable old label cannot authorize a new current-book receipt');
  const revised=await reloaded.recordUsage(adopted.generation,adopted.sequence,['claude-api-total-silver'],
    {recordedDay:'2026-10-13',timeZone:'UTC',referencePricebooks:{'claude-api-total-silver':money.getAchievementMoneyPricebook('anthropic').version}});
  assert.equal(revised.store.records[1].referencePricebook,oldBook);
  assert.match(revised.store.records[2].referencePricebook!,/-v2$/);
  const cleared=await reloaded.clear();
  assert.equal(cleared.records.length,0);
  assert.equal(cleared.generation,adopted.generation+1);
});
