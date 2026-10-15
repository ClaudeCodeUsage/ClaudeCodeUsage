import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {ACHIEVEMENT_DEFINITIONS,type AchievementId} from '../achievements';
import {getAchievementMoneyPricebook} from '../achievementMoney';
import {AchievementRecordRepository,parseAchievementRecordStore,type AchievementRecordDraft} from '../achievementRecordStore';

const newIds:AchievementId[]=['claude-api-week-platinum','claude-api-week-legendary','codex-api-week-platinum','codex-api-week-legendary'];
const history=(id:AchievementId):AchievementRecordDraft=>({id,origin:'history',recordedDay:null,timeZone:null,
  referencePricebook:getAchievementMoneyPricebook(id.startsWith('codex-')?'openai':'anthropic').version});
async function fixture(run:(legacy:string,current:string)=>Promise<void>):Promise<void>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'ccu-weekly-money-store-'));
  try{await run(path.join(directory,'achievements-v1.json'),path.join(directory,'achievements-v2.json'));}
  finally{await rm(directory,{recursive:true,force:true});}
}

test('new weekly IDs cannot be parsed or appended as old-envelope proof, with or without book attribution',async()=>{
  await fixture(async(legacy,current)=>{
    const old=new AchievementRecordRepository(legacy),initial=await old.initialize(['sonnet-main']);
    const before=await readFile(legacy);
    for(const id of newIds){
      const record={...history(id),ruleVersion:1,seq:initial.sequence+1,unread:false};
      const {referencePricebook,...withoutBook}=record;
      for(const row of [record,withoutBook])assert.throws(()=>parseAchievementRecordStore({
        ...initial,sequence:row.seq,records:[...initial.records,row]}),/invalid/);
      await assert.rejects(old.append(initial.generation,[history(id)]),/invalid/);
    }
    assert.deepEqual(await readFile(legacy),before);
    const host=new AchievementRecordRepository(current),migrated=await host.initialize(newIds);
    assert.deepEqual(migrated.records.map(row=>row.id),['sonnet-main']);
    const saved=await host.append(migrated.generation,newIds.map(history));
    assert.deepEqual(saved.store.records[0],migrated.records[0]);
    assert.deepEqual(saved.added.map(r=>[r.id,r.recordedDay,r.timeZone,r.unread,r.referencePricebook]),
      newIds.map(id=>[id,null,null,false,history(id).referencePricebook]));
    assert.deepEqual(parseAchievementRecordStore(saved.store),saved.store);
    for(const row of saved.added)assert.throws(()=>parseAchievementRecordStore({...saved.store,
      records:saved.store.records.map(r=>r.id===row.id?{...r,referencePricebook:'future-book'}:r)}),/invalid/);
    assert.deepEqual(await readFile(legacy),before);
  });
});

test('fresh legacy Memento seeds never confer new monetary ranks; v2 keeps existing money and pins intact',async()=>{
  await fixture(async(_legacy,current)=>{
    const host=new AchievementRecordRepository(current),initial=await host.initialize(['local-share-export',...newIds]);
    assert.deepEqual(initial.records.map(r=>r.id),['local-share-export']);
    const oldIds:AchievementId[]=['claude-api-week-bronze','claude-api-week-silver','claude-api-week-gold',
      'codex-api-week-bronze','codex-api-week-silver','codex-api-week-gold'];
    const saved=(await host.append(initial.generation,oldIds.map(history))).store;
    const pinned=await host.pin(saved.generation,['claude-api-week','codex-api-week'],()=>true,saved.pinRevision);
    const added=(await host.append(saved.generation,newIds.map(history))).store;
    assert.deepEqual(added.records.slice(0,pinned.records.length),pinned.records);
    assert.deepEqual(added.pins,pinned.pins);
    assert.equal(added.sequence,pinned.sequence+4);
    assert.equal(added.schemaVersion,2);
    assert.equal(added.catalogVersion,2);
    assert.deepEqual(await new AchievementRecordRepository(current).initialize([]),added);
  });
});

test('a pre-expansion 174-rule reader fails closed on new weekly IDs without rewriting or clearing either envelope',async()=>{
  await fixture(async(legacy,current)=>{
    const old=new AchievementRecordRepository(legacy);await old.initialize(['sonnet-main']);
    const host=new AchievementRecordRepository(current),initial=await host.initialize([]);
    await host.append(initial.generation,newIds.map(history));
    const before=await Promise.all([readFile(current),readFile(legacy)]);
    const definitions=ACHIEVEMENT_DEFINITIONS as unknown as Array<{id:AchievementId;group:string;target:number}>;
    const full=definitions.slice(),modulePath=require.resolve('../achievementRecordStore'),cached=require.cache[modulePath];
    let oldApi:typeof import('../achievementRecordStore');
    try{
      definitions.splice(0,definitions.length,...full.filter(r=>!newIds.includes(r.id)));
      assert.equal(definitions.length,174);
      delete require.cache[modulePath];oldApi=require('../achievementRecordStore');
    }finally{
      definitions.splice(0,definitions.length,...full);delete require.cache[modulePath];
      if(cached)require.cache[modulePath]=cached;
    }
    const reader=new oldApi!.AchievementRecordRepository(current);
    await assert.rejects(reader.initialize(['sonnet-main']),/invalid/);
    await assert.rejects(reader.append(initial.generation,[{id:'sonnet-main-silver',origin:'history',recordedDay:null,timeZone:null}]),/invalid/);
    let cleared=false;await assert.rejects(reader.clear(async()=>{cleared=true;}),/invalid/);
    assert.equal(cleared,false);
    assert.deepEqual(await Promise.all([readFile(current),readFile(legacy)]),before);
    assert.deepEqual((await readdir(path.dirname(current))).sort(),['achievements-v1.json','achievements-v2.json']);
  });
});
