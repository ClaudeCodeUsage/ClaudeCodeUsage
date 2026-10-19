import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Module = require('node:module');
import { WeeklyEstimateArchive, WEEKLY_ESTIMATE_ARCHIVE_FILE } from '../weeklyEstimateArchive';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import { createEmptyQuotaObservationStore } from '../quotaObservationStore';
const originalLoad=(Module as any)._load;
const vscodeStub:any=new Proxy(function(){},{get:(_t,p)=>p==='then'?undefined:vscodeStub,apply:()=>vscodeStub,construct:()=>vscodeStub});
(Module as any)._load=function(request:string,...args:unknown[]){return request==='vscode'?vscodeStub:originalLoad.call(this,request,...args);};
let Extension:typeof import('../extension').ClaudeCodeUsageExtension;
try{Extension=require('../extension').ClaudeCodeUsageExtension;}finally{(Module as any)._load=originalLoad;}
const SALT='synthetic-host-salt-0123456789abcdef';
async function fixture(t:{after(fn:()=>Promise<void>):void}){
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'ccu-estimate-host-')));
  const file=path.join(root,WEEKLY_ESTIMATE_ARCHIVE_FILE),e:any=Object.create(Extension.prototype);
  const empty=createEmptyQuotaObservationStore();
  Object.assign(e,{context:{globalStorageUri:{fsPath:root},globalState:{keys:()=>[]}},
    quotaFingerprintSalt:SALT,weeklyEstimateCoordinator:new WeeklyEstimateCoordinator(file,SALT),
    weeklyEstimateClearedAt:new Map(),quotaObservationStore:empty,
    quotaObservationRepository:{clear:async()=>empty,append:async()=>empty},
    stopQuotaColdRetry:()=>{},cancelQuotaNetworks:async()=>{},assertScopedQuotaMigrationIsResolved:()=>{},
    clearLegacyQuotaMigrationInputs:async()=>{},refreshQuotaObservationViews:()=>{},syncProviderUiSafely:()=>{},
    codexDerivedIndexPaths:async()=>[]});
  t.after(async()=>{e.weeklyEstimateCoordinator.dispose();await e.weeklyEstimateCoordinator.flush();await rm(root,{recursive:true,force:true});});
  return {e,root,file};
}
function snapshot(provider:'claude'|'codex',now:number){return {provider,windowStart:now-86_400_000,resetAt:now+86_400_000,
  observedAt:now,estimatedAt:now,usedEquivalentUsd:40,fullEquivalentUsd:100,unusedEquivalentUsd:60,
  utilizationPercent:40,pricingCoverage:1,method:'legacy-prefix-ratio' as const,pricingVersion:'api-v1',
  flags:['account-unattributed','reconstructed'] as const};}

test('provider quota clear removes its historical estimates across homes but preserves another provider',async t=>{
  const {e,file}=await fixture(t),now=Date.now()-1000;
  const a=new WeeklyEstimateArchive(file,SALT,'home-a'),b=new WeeklyEstimateArchive(file,SALT,'home-b');
  await a.record(snapshot('codex',now));await b.record(snapshot('codex',now));await b.record(snapshot('claude',now));
  const result=await e.executeLocalDataAction('clear-quota-history',{provider:'codex'});
  assert.equal(result.ok,true);
  const after=await b.load();assert.equal(after.totalEntries,1);
  assert.deepEqual(after.entries.map(entry=>entry.provider),['claude']);
  assert.equal(e.weeklyEstimateClearedAt.has('codex'),true);
  assert.equal(e.weeklyEstimateClearedAt.has('claude'),false);
  const row={provider:'codex' as const,seriesKey:'window',resetAt:now+86_400_000,observedAt:now,usedPercent:40};
  await e.recordCodexQuotaObservations([row]);
  assert.equal(e.weeklyEstimateClearedAt.has('codex'),true,'an old index sample cannot re-enable cleared history');
  await e.recordCodexQuotaObservations([{...row,observedAt:e.weeklyEstimateClearedAt.get('codex')+1}]);
  assert.equal(e.weeklyEstimateClearedAt.has('codex'),false,'a genuinely newer observation permits recording again');
});

test('account-epoch quota clear does not delete unattributed estimates it cannot safely assign',async t=>{
  const {e,file}=await fixture(t),archive=new WeeklyEstimateArchive(file,SALT,'home');
  await archive.record(snapshot('codex',Date.now()-1000));
  await e.executeLocalDataAction('clear-quota-history',{provider:'codex',accountFingerprint:'unrelated-epoch'});
  assert.equal((await archive.load()).totalEntries,1);
  assert.equal(e.weeklyEstimateClearedAt.size,0);
});

test('clear-all postcondition counts every source rather than an empty source-filtered view',async t=>{
  const {e,file,root}=await fixture(t);
  await writeFile(path.join(root,'quota-observations-v2.json'),JSON.stringify(createEmptyQuotaObservationStore()));
  await new WeeklyEstimateArchive(file,SALT,'another-home').record(snapshot('codex',Date.now()-1000));
  assert.equal((await new WeeklyEstimateArchive(file,SALT,'clear').load()).entries.length,0);
  await assert.rejects(e.verifyClearAllPostcondition(),/weekly-estimate-postcondition/);
});
