import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import {HISTORY_DATE_REGISTRATIONS,HISTORY_REGISTRY_VERSION,historyRegistrationAllows,
 matchesAchievementHistoryRegistration,ACHIEVEMENT_HISTORY_CATALOG_SIGNATURE} from '../achievementHistoryRegistry';
test('date registration is an explicit frozen manifest, not future catalog membership',()=>{
 assert.equal(HISTORY_REGISTRY_VERSION,1);
 assert.equal(HISTORY_DATE_REGISTRATIONS.length,138);
 assert.ok(Object.isFrozen(HISTORY_DATE_REGISTRATIONS));
 assert.equal(new Set(HISTORY_DATE_REGISTRATIONS.map(r=>r.id)).size,138);
 for(const row of HISTORY_DATE_REGISTRATIONS){assert.ok(Object.isFrozen(row));assert.equal(historyRegistrationAllows(row.id,row.counter),true,row.id);}
 assert.equal(historyRegistrationAllows('sonnet-main-future','sonnet-main'),false);
 assert.equal(historyRegistrationAllows('codex-api-month-bronze','codex-api-total'),false);
 assert.equal(historyRegistrationAllows('agent-standup','agent-team'),false);
 const sig=JSON.parse(ACHIEVEMENT_HISTORY_CATALOG_SIGNATURE);
 assert.equal(sig.registry,1);assert.equal(sig.registered.length,138);
 assert.ok(sig.actual.some(([id,shape]:any)=>id==='sonnet-main-platinum'&&shape.baseId==='sonnet-main-gold'));
});
test('each date rule rejects changed counter, target, group, rule version, ownership, base and scope',()=>{
 for(const row of HISTORY_DATE_REGISTRATIONS){
  const {id,counter,...shape}=row;
  assert.equal(matchesAchievementHistoryRegistration(id,counter,shape),true);
  assert.equal(matchesAchievementHistoryRegistration(id,counter+'-different',shape),false);
  for(const patch of [{target:shape.target+1},{group:'future-provider'},{ruleVersion:shape.ruleVersion+1},
    {series:'different-series'},{baseId:'different-base'},{scope:'different-scope'}]){
   assert.equal(matchesAchievementHistoryRegistration(id,counter,{...shape,...patch}),false,id+': '+JSON.stringify(patch));
  }
  assert.equal(matchesAchievementHistoryRegistration(id+'-future',counter,shape),false);
 }
});
