import {test} from 'node:test';
import * as assert from 'node:assert/strict';
const loader=require('node:module'),originalLoad=loader._load;
const noop=()=>undefined;
const vscode={window:{state:{focused:false},createOutputChannel:()=>({appendLine:noop,dispose:noop})},workspace:{workspaceFolders:[]},env:{}};
loader._load=function(name:string,...args:unknown[]){return name==='vscode'?vscode:originalLoad.call(this,name,...args);};
const View=require('../webview').UsageWebviewProvider;
loader._load=function(name:string,...args:any[]){
 if(name==='vscode')return vscode;
 if(name==='./statusBar')return{StatusBarManager:class {}};
 if(name==='./webview')return{UsageWebviewProvider:class {constructor(context:any){return Object.assign(Object.create(View.prototype),{context,setAchievementWindowFocused:noop});}}};
 return originalLoad.call(this,name,...args);
};
let Extension:any;try{Extension=require('../extension').ClaudeCodeUsageExtension;}finally{loader._load=originalLoad;}
function host(run:(e:any)=>void):void {
 const settings=new Map<string,unknown>([['dataDirectory',''],['usageLimitTracking',false]]);
 const overrides=['queueInitializationWrite','setupCommands','loadConfiguration','refreshQuotaObservationViews','startWindowFocusRefresh','maybeAnnounceWhatsNew','createCodexProvider'];
 const saved=overrides.map(key=>[key,Extension.prototype[key]]);
 overrides.forEach(key=>Extension.prototype[key]=noop);
 try{
  const e=new Extension({subscriptions:[],globalStorageUri:{fsPath:'/synthetic/diagnostics-test'},globalState:{get:()=>undefined,update:()=>Promise.resolve()},secrets:{get:async()=>undefined}},
   {get:(key:string)=>settings.get(key)}, {salt:'synthetic-salt',repository:{},store:{schemaVersion:2,fingerprintAlgorithm:'hmac-sha256-v1',observations:[]}});
  e.getConfiguration=()=>({dataDirectory:'',codexEnabled:true,usageLimitTracking:false,codexDataDirectory:'/synthetic/diagnostics-codex'});
  e.codexHome=()=>'/synthetic/diagnostics-codex';
  run(e);
 }finally{for(const [key,value]of saved)Extension.prototype[key]=value;}
}
test('actual snapshot adoption preserves display identity while promoting and withdrawing hidden diagnostic proof',()=>host((e)=>{
 const {snapshotFixture}=require('./codexFixtures');const snapshot=snapshotFixture();
 snapshot.files=[snapshot.files[0]];snapshot.currentManifestVerified=true;
 snapshot.coverage.complete=true;snapshot.coverage.identity.complete=true;snapshot.coverage.period.last30Days.complete=true;
 const config=e.getConfiguration();e.getConfiguration=()=>({...config,enableAchievements:false});e.recordCodexQuotaObservations=async()=>undefined;
 e.applyCodexSnapshot(snapshot);const retained=e.codexView,insights=e.codexInsights;assert.deepEqual(retained.diagnosticDays(),[]);
 const fresh=structuredClone(snapshot);fresh.files[0].period.lineageVersion=1;fresh.files[0].period.lineagePrefixEvents=0;
 e.applyCodexSnapshot(fresh);assert.equal(e.codexView,retained);assert.equal(e.codexInsights,insights);
 assert.ok(e.codexView.diagnosticDays().some((day:any)=>day.output>0),'new source proof must reach the retained view');
 const retired=structuredClone(fresh);delete retired.files[0].period.lineageVersion;e.applyCodexSnapshot(retired);
 assert.equal(e.codexView,retained);assert.deepEqual(e.codexView.diagnosticDays(),[],'withdrawn proof must not remain cached');
}));
