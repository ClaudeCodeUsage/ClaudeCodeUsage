import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import {ResourceOwnershipRegistry} from '../resourceOwnership';
import {CodexAccountEstimator} from '../codexAccountEstimate';
import {captureCodexCalibrationPricebook} from '../codexCalibrationEvidence';
import {createEmptyQuotaObservationStore, mergeQuotaCaptures} from '../quotaObservationStore';
const loader=require('node:module'),original=loader._load;
loader._load=function(name:string,...args:unknown[]){return name==='vscode'?{env:{}}:original.call(this,name,...args);};
let Extension:typeof import('../extension').ClaudeCodeUsageExtension;
try{Extension=require('../extension').ClaudeCodeUsageExtension;}finally{loader._load=original;}
const T=Date.parse('2026-10-19T02:00Z'),R=T+604_800_000-1000;
const sample={accountScopeKey:'a'.repeat(64),sourceScopeKey:'b'.repeat(64),requestedAt:T-10,observedAt:T,resetAt:R,usedPercent:25};
function fixture(){
 const e:any=Object.create(Extension.prototype);let calls=0,writes=0;
 Object.assign(e,{disposed:false,configurationGeneration:1,localDataClearedRequiresReload:false,
  windowActivity:{focused:true},quotaFingerprintSalt:'s'.repeat(64),resourceOwnership:new ResourceOwnershipRegistry(),
  activeQuotaNetworks:new Map(),weeklyEstimateClearedAt:new Map(),officialQuotaGeneration:0,
  officialQuotaEstimates:[],officialAccountEstimator:new CodexAccountEstimator(),officialQuotaLastAttempt:0,
  officialQuotaStatus:'disabled',officialQuotaBinary:'/synthetic/codex',
  getConfiguration:()=>({codexEnabled:true,codexOfficialQuotaEnabled:true,usageLimitTracking:true,codexDataDirectory:''}),
  codexHome:()=>path.join(os.homedir(),'.codex'),webviewProvider:{isDashboardVisible:()=>true,refreshWeeklyEstimates:()=>{}},
  officialQuotaReader:async()=>{calls++;return sample;},
  quotaObservationRepository:{append:async()=>{writes++;return{schemaVersion:2,fingerprintAlgorithm:'hmac-sha256-v1',observations:[]};}}});
 return {e,calls:()=>calls,writes:()=>writes};
}
test('default-off and hidden dashboard make zero official transport calls',async()=>{
 for(const kind of ['off','hidden','quota-off','provider-off'] as const){const{e,calls,writes}=fixture();
  if(kind==='hidden')e.webviewProvider.isDashboardVisible=()=>false;
  else e.getConfiguration=()=>({codexEnabled:kind!=='provider-off',codexOfficialQuotaEnabled:kind!=='off',usageLimitTracking:kind!=='quota-off'});
  await e.refreshOfficialCodexQuota('manual');assert.equal(calls(),0);assert.equal(writes(),0);
 }
});
test('custom source cannot query the default daemon or silently use its identity',async()=>{
 const{e,calls}=fixture();e.codexHome=()=>'/synthetic/other-home';
 await e.refreshOfficialCodexQuota('manual');assert.equal(calls(),0);assert.equal(e.officialQuotaStatus,'source-mismatch');
});
test('successful read captures original quota, keeps only numeric public state and releases resources',async()=>{
 const clock=Date.now;Date.now=()=>T;
 try{const{e,calls,writes}=fixture();await e.refreshOfficialCodexQuota('manual');
  assert.equal(calls(),1);assert.equal(writes(),1);assert.equal(e.officialQuotaStatus,'ready');
  const p=e.officialQuotaPublicState();assert.equal(p.usedPercent,25);assert.equal(p.observedAt,T);
  assert.doesNotMatch(JSON.stringify(p),/accountScopeKey|sourceScopeKey|aaaaa/);
  assert.equal(e.resourceOwnership.snapshotForTests().activeCount,0);
 }finally{Date.now=clock;}
});
test('public official facts expose only numeric counts and known future expiry, never credit keys',async()=>{
 const clock=Date.now;Date.now=()=>T;
 try{const{e}=fixture();e.officialQuotaReader=async()=>({...sample,ordinaryUsageAllowed:false,
  rateLimitResetCredits:{availableCount:2,credits:[{creditKey:'d'.repeat(64),status:'available',
   resetType:'codexRateLimits',grantedAt:T-1000,expiresAt:T+3600000},
   {creditKey:'e'.repeat(64),status:'available',resetType:'codexRateLimits',grantedAt:T-2000,expiresAt:T-1}]}});
  await e.refreshOfficialCodexQuota('manual');const p=e.officialQuotaPublicState();
  assert.equal(p.resetCreditCount,2);assert.equal(p.resetCreditNextExpiryAt,T+3600000);
  assert.equal(p.ordinaryUsageAllowed,false);
  assert.doesNotMatch(JSON.stringify(p),/creditKey|dddddddd|eeeeeeee|accountScopeKey|sourceScopeKey/);
 }finally{Date.now=clock;}
});
test('official public state includes only runtime calibration progress, not baseline identities or source details',()=>{
 const clock=Date.now;Date.now=()=>T;
 try{const{e}=fixture();e.officialQuotaSample=sample;e.officialQuotaStatus='ready';
  e.officialAccountEstimator.calibrationStatus=()=>({state:'append-incomplete',deltaPercent:2,intervals:1});
  assert.deepEqual(e.officialQuotaPublicState().calibration,{state:'append-incomplete',deltaPercent:2,intervals:1});
  assert.doesNotMatch(JSON.stringify(e.officialQuotaPublicState()),/accountScopeKey|sourceScopeKey|fingerprint|baseline|creditKey/);
 }finally{Date.now=clock;}
});
test('late replies after cancellation cannot repopulate cleared account state or write history',async()=>{
 const clock=Date.now;Date.now=()=>T;
 try{const{e,writes}=fixture();let reply!:(v:unknown)=>void;
  e.officialQuotaReader=()=>new Promise(r=>reply=r);
  const pending=e.refreshOfficialCodexQuota('manual');await Promise.resolve();
  const cancelled=e.cancelQuotaNetworks('cancelled');reply(sample);await Promise.all([pending,cancelled]);
  assert.equal(writes(),0);assert.notEqual(e.officialQuotaStatus,'ready');
  assert.equal(e.resourceOwnership.snapshotForTests().activeCount,0);
 }finally{Date.now=clock;}
});
test('single flight and minimum cadence bound repeated manual and polling requests',async()=>{
 const clock=Date.now;let now=T;Date.now=()=>now;
 try{const{e,calls}=fixture();await e.refreshOfficialCodexQuota('manual');
  await e.refreshOfficialCodexQuota('manual');await e.refreshOfficialCodexQuota('poll');assert.equal(calls(),1);
  now+=60_000;await e.refreshOfficialCodexQuota('poll');assert.equal(calls(),2);
 }finally{Date.now=clock;}
});
test('index-generation changes retire calibration and in-flight reply authority, but unchanged appends do not',()=>{
 const {e}=fixture();let resets=0;e.officialAccountEstimator={reset:()=>resets++};
 e.acceptOfficialQuotaIndexGeneration(1);const generation=e.officialQuotaGeneration;
 e.acceptOfficialQuotaIndexGeneration(1);assert.equal(resets,0);assert.equal(e.officialQuotaGeneration,generation);
 e.officialQuotaSample=sample;e.acceptOfficialQuotaIndexGeneration(2);
 assert.equal(resets,1);assert.equal(e.officialQuotaSample,undefined);
 assert.ok(e.officialQuotaGeneration>generation);
});
test('a renderer failure cannot reject a successful background quota read or retain its resource lease',async()=>{
 const clock=Date.now;Date.now=()=>T;
 try{const{e}=fixture();e.webviewProvider.refreshWeeklyEstimates=()=>{throw Error('synthetic-render-failure');};
  await assert.doesNotReject(e.refreshOfficialCodexQuota('manual'));
  assert.equal(e.officialQuotaStatus,'ready');assert.equal(e.officialQuotaPending,undefined);
  assert.equal(e.resourceOwnership.snapshotForTests().activeCount,0);
 }finally{Date.now=clock;}
});

test('official epoch checkpoints survive before any amount calibration and a small same-reset drop opens a new segment',async()=>{
 const clock=Date.now;let now=T,percent=12;Date.now=()=>now;
 try{const{e}=fixture();let store=createEmptyQuotaObservationStore();
  e.officialQuotaReader=async()=>({...sample,requestedAt:now-10,observedAt:now,usedPercent:percent});
  e.quotaObservationRepository={append:async(captures:any[])=>{
    store=mergeQuotaCaptures(store,captures,{salt:e.quotaFingerprintSalt,now});return store;
  }};
  await e.refreshOfficialCodexQuota('manual');
  assert.equal(e.officialQuotaSample.quotaEpoch?.startedAt,T);
  assert.equal(e.officialQuotaEstimates.length,0,'identity checkpoint does not invent a monetary calibration');
  now+=60_000;percent=3;await e.refreshOfficialCodexQuota('manual');
  assert.equal(e.officialQuotaSample.quotaEpoch?.startedAt,now);
  assert.equal(e.officialQuotaSample.quotaEpoch?.reason,'counter-drop');
  assert.equal(e.officialQuotaSample.quotaEpoch?.startLowerAt,T);
  assert.equal(new Set(store.observations.map(row=>row.windowId)).size,2);
  assert.equal(e.officialQuotaPublicState().quotaEpochStartedAt,now);
  assert.doesNotMatch(JSON.stringify(e.officialQuotaPublicState()),/accountFingerprint|accountScopeKey|sourceScopeKey/);
 }finally{Date.now=clock;}
});

test('a successful account calibration queues archive work without requiring a dashboard render',async()=>{
 const clock=Date.now;let now=T,percent=20,usd=100;Date.now=()=>now;
 try{const{e}=fixture();let store=createEmptyQuotaObservationStore(),queued=0;
  e.officialQuotaReader=async()=>({...sample,requestedAt:now-10,observedAt:now,usedPercent:percent});
  e.quotaObservationRepository={append:async(captures:any[])=>{
    store=mergeQuotaCaptures(store,captures,{salt:e.quotaFingerprintSalt,now});return store;
  }};
  e.weeklyEstimateCoordinator={project:(_provider:string,_inputs:unknown,options:any)=>{
    queued++;assert.equal(options.accountEstimates.length,1);
    assert.equal(options.accountEstimates[0].fullEquivalentUsd,150);
    assert.equal(options.accountEstimates[0].calibrationEvidence.interval.deltaUsd,30);
    assert.equal(options.accountEstimates[0].calibrationEvidence.accumulated.deltaPercent,20);
    assert.equal(options.accountEstimates[0].calibrationEvidence.pricebook.rates[0].model,'gpt-5');
    assert.equal(options.activeQuotaEpochStartedAt,T);
  }};
  const view=()=>({currentManifestVerified:true,coverage:{complete:true,identity:{complete:true}},
    periodCoverage:{allTime:{complete:true}},weeklyValueInputs:{
      calibrationPricebook:captureCodexCalibrationPricebook(['gpt-5']),
      observations:[{provider:'codex',sourceKey:'synthetic',observedAt:now-1,resetAt:R,usedPercent:percent}],
      usage:[{sourceKey:'synthetic',timestamp:now-1,intervalStart:T-60_000,intervalEnd:now-1,equivalentUsd:usd,pricedTokens:usd,totalTokens:usd}],
    }});
  e.codexView=view();await e.refreshOfficialCodexQuota('manual');assert.equal(queued,0);
  now+=60_000;percent=40;usd=130;e.codexView=view();await e.refreshOfficialCodexQuota('manual');
  assert.equal(queued,1);assert.equal(e.officialQuotaEstimates.length,1);
 }finally{Date.now=clock;}
});

test('an older unexpired quota remains a labelled historical observation rather than a current identity claim',()=>{
 const clock=Date.now;Date.now=()=>T+6*60_000;
 try{const{e}=fixture();e.officialQuotaSample=sample;e.officialQuotaStatus='ready';
  const state=e.officialQuotaPublicState();
  assert.equal(state.status,'ready');assert.equal(state.stale,true);
  assert.equal(state.observedAt,T);assert.equal(state.usedPercent,25);
  Date.now=()=>R+1;assert.equal(e.officialQuotaPublicState().status,'unavailable');
 }finally{Date.now=clock;}
});

test('verified scope admits complete current increments and refuses excluded growth or an unverified bypass',async()=>{
 const clock=Date.now;
 try{for(const verified of [false,true])for(const excludedGrows of [false,true]){
  let now=T,percent=20,usd=100;Date.now=()=>now;
  const{e}=fixture();let store=createEmptyQuotaObservationStore();
  e.officialQuotaReader=async()=>({...sample,requestedAt:now-10,observedAt:now,usedPercent:percent});
  e.quotaObservationRepository={append:async(captures:any[])=>{
    store=mergeQuotaCaptures(store,captures,{salt:e.quotaFingerprintSalt,now});return store;
  }};
  const view=()=>({currentManifestVerified:true,coverage:{complete:true,identity:{complete:false}},
    periodCoverage:{allTime:{complete:true}},weeklyValueInputs:{
      calibrationPricebook:captureCodexCalibrationPricebook(['gpt-5']),
      calibrationSourceScope:{verified,excludedSourceKeys:['ambiguous']},
      observations:['own','ambiguous'].map(sourceKey=>({provider:'codex',sourceKey,
        observedAt:now-1,resetAt:R,usedPercent:percent})),
      usage:['own','ambiguous'].map(sourceKey=>({sourceKey,timestamp:now-1,intervalStart:T-60_000,
        intervalEnd:now-1,equivalentUsd:sourceKey==='own'?usd:excludedGrows?usd*10:1000,
        pricedTokens:sourceKey==='own'?usd*100:excludedGrows?usd*1000:100000,
        totalTokens:sourceKey==='own'?usd*100:excludedGrows?usd*1000:100000})),
    }});
  e.codexView=view();await e.refreshOfficialCodexQuota('manual');
  now+=60_000;percent=40;usd=130;e.codexView=view();await e.refreshOfficialCodexQuota('manual');
  const admitted=verified&&!excludedGrows;
  assert.equal(e.officialQuotaEstimates.length,admitted?1:0);
  if(admitted){const result=e.officialQuotaEstimates[0];
    assert.equal(result.fullEquivalentUsd,150);assert.equal(result.calibrationEvidence.interval.excludedSources,1);
    assert.ok(result.flags.includes('partial-history'));
  }
 }}finally{Date.now=clock;}
});
