import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import {ResourceOwnershipRegistry} from '../resourceOwnership';
import {CodexAccountEstimator} from '../codexAccountEstimate';
import {captureCodexCalibrationPricebook} from '../codexCalibrationEvidence';
import {createEmptyQuotaObservationStore, mergeQuotaCaptures} from '../quotaObservationStore';
import {createEmptyCodexIndex} from '../providers/codex/codexIndex';
import {createCodexParserState} from '../providers/codex/codexParser';
import {buildCodexForwardCalibration} from '../providers/codex/codexForwardCalibration';
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
test('successful quota observations emit a sanitized calibration reason without diagnostic-failure coupling',async()=>{
 const clock=Date.now;Date.now=()=>T;
 try{for(const loggingFails of [false,true]){
  const{e}=fixture();const lines:string[]=[];
  e.outputChannel={appendLine(line:string){if(loggingFails)throw Error('synthetic-log-failure');lines.push(line);}};
  await e.refreshOfficialCodexQuota('manual');
  assert.equal(e.officialQuotaStatus,'ready');
  assert.equal(lines.length,loggingFails?0:1);
  if(!loggingFails){assert.match(lines[0],/^codex-calibration /);
    assert.match(lines[0],/reason=not-forward-mode/);
    assert.doesNotMatch(lines[0],/accountScopeKey|sourceScopeKey|aaaaa|Users|credential|\.jsonl/);
  }
 }
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

test('official calibration freezes the pre-request local proof and pricebook across concurrent publications',async()=>{
 const clock=Date.now;Date.now=()=>T;
 try{for(const phase of ['transport','persistence'] as const){
  const{e}=fixture();let store=createEmptyQuotaObservationStore(),received:any;
  const book=captureCodexCalibrationPricebook(['gpt-5'])!, originalRate=book.rates[0].input;
  const oldProof={verifiedAt:T-100}, futureProof={verifiedAt:T+1};
  const view=(proof:unknown,calibrationPricebook=book)=>({currentManifestVerified:true,
    coverage:{complete:true,identity:{complete:true}},periodCoverage:{allTime:{complete:false}},
    weeklyValueInputs:{observations:[],usage:[],codexForwardCalibration:proof,calibrationPricebook}});
  const original=view(oldProof);e.codexView=original;
  const publish=()=>{book.rates[0].input=originalRate+0.1;e.codexView=view(futureProof);};
  e.officialQuotaReader=async()=>{if(phase==='transport')publish();return sample;};
  e.quotaObservationRepository={append:async(captures:any[])=>{
    if(phase==='persistence')publish();
    store=mergeQuotaCaptures(store,captures,{salt:e.quotaFingerprintSalt,now:T});return store;
  }};
  e.officialAccountEstimator={reset(){},observe(_sample:unknown,inputs:any,price:string){received={inputs,price};}};
  await e.refreshOfficialCodexQuota('manual');
  assert.ok(received,phase);
  assert.equal(received.inputs.codexForwardCalibration,oldProof,phase);
  assert.equal(received.inputs.calibrationPricebook.rates[0].input,originalRate,phase);
  assert.equal(e.codexView.weeklyValueInputs.codexForwardCalibration,futureProof,phase);
  assert.equal(e.officialQuotaStatus,'ready');
  assert.ok(store.observations.length>0,'quota facts persist independently of monetary sampling');
 }
 }finally{Date.now=clock;}
});

test('real branded forward fits survive watcher publications during every official request',async()=>{
 const clock=Date.now;let now=T;Date.now=()=>now;
 try{const{e}=fixture();let store=createEmptyQuotaObservationStore(),queued=0,percent=20;
  const K='1'.repeat(64),book=captureCodexCalibrationPricebook(['gpt-5'])!;
  const makeView=(n:number,verifiedAt:number)=>{
    const index=createEmptyCodexIndex('UTC');index.indexGeneration=T-60_000;
    const counts={inputTotal:n*1000,cachedInput:0,outputTotal:0,reasoningOutput:0};
    index.files[K]={fileKey:K,sourceArea:'sessions',size:n*100,offset:n*100,mtimeMs:now-200,
      dev:1,ino:2,identityChecked:true,discardingOversizedLine:false,qualityFlags:[],
      parserState:{...createCodexParserState(K),identityLocked:true,model:'gpt-5'},
      lineage:{fingerprintBlocks:[],pendingFingerprints:Array.from({length:n},(_,i)=>i.toString(16).padStart(32,'0')),
        tokenEvents:n,desiredPrefixEvents:0,appliedPrefixEvents:0},
      aggregate:{total:counts,byModel:{'gpt-5':counts},byDay:{},byEffort:{},
        session:{sessionKey:K,role:'root',startedAt:T-1000,endedAt:now-200},
        structural:{patchCalls:0,toolCalls:0,postPatchToolCalls:0,compactCount:0,taskCompleteCount:0}},
      quotaHistory:[{provider:'codex',seriesKey:'codex',observedAt:now-200,resetAt:R,usedPercent:percent}],
      ...(n>1?{calibrationAppend:{beforeOffset:(n-1)*100,throughOffset:n*100,
        minUsageAt:now-200,maxUsageAt:now-200,complete:true}}:{}),
    };
    index.coverage.totalFiles=index.coverage.indexedFiles=1;
    const proof=buildCodexForwardCalibration(index,true,new Set([K]),new Set(),verifiedAt)!;
    assert.ok(proof);
    return {currentManifestVerified:true,coverage:{complete:true,identity:{complete:true}},
      periodCoverage:{allTime:{complete:false}},weeklyValueInputs:{observations:[],usage:[],
        codexForwardCalibration:proof,calibrationPricebook:book}};
  };
  e.quotaObservationRepository={append:async(captures:any[])=>{
    store=mergeQuotaCaptures(store,captures,{salt:e.quotaFingerprintSalt,now});return store;
  }};
  e.weeklyEstimateCoordinator={project(_provider:string,inputs:any,options:any){
    queued++;assert.ok(inputs.codexForwardCalibration.verifiedAt<options.now-10);
    assert.equal(options.accountEstimates[0].calibrationEvidence.accumulated.deltaPercent,10);
    assert.equal(options.accountEstimates[0].calibrationEvidence.accumulated.totalTokens,1000);
  }};
  for(let n=1;n<=3;n++){
    percent=10+n*10;e.codexView=makeView(n,now-100);
    e.officialQuotaReader=async()=>{e.codexView=makeView(n,now-5);return {...sample,
      requestedAt:now-10,observedAt:now,usedPercent:percent};};
    await e.refreshOfficialCodexQuota('manual');now+=60_000;
  }
  assert.equal(queued,1);assert.equal(e.officialQuotaEstimates.length,1);
  const estimate=e.officialQuotaEstimates[0],rate=book.rates.find(r=>r.model==='gpt-5')!.input;
  assert.ok(Math.abs(estimate.fullEquivalentUsd-rate*1000/.1)<1e-10);
  assert.equal(estimate.calibrationEvidence.collectionMode,'forward-append-v1');
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
