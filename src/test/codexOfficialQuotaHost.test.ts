import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import {ResourceOwnershipRegistry} from '../resourceOwnership';
import {CodexAccountEstimator} from '../codexAccountEstimate';
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
