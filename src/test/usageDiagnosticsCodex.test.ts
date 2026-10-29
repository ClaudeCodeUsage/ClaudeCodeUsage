import {test} from 'node:test';
import * as assert from 'node:assert/strict';
const project=():any=>require('../providers/codex/codexUsage').projectCodexDiagnosticDays;
const tokens=(output:number)=>({inputTotal:10,outputTotal:output,cachedInput:0,reasoningOutput:0});
const file=(role='root'):any=>({total:tokens(20),session:{role},period:{timeZone:'UTC',lineageVersion:1,lineagePrefixEvents:0,indexedThrough:100,days:{'2026-10-21':{total:tokens(20),byModel:{a:tokens(20)},byEffort:{},structural:{}}}},byDay:{'2026-10-21':tokens(999)}});
test('Codex diagnostic source uses current sidecars, preserving model and role sums',()=>{const rows=project()([file(),file('subagent')],'UTC','2026-10-23',true);const day=rows.find((r:any)=>r.day==='2026-10-21');assert.equal(day.output,40);assert.deepEqual(day.models,{a:40});assert.deepEqual(day.roles,{root:20,subagent:20});assert.equal(day.coverage,'complete');assert.equal(rows.length,30);});
test('wrong timezone, missing sidecar and old lineage never use UTC fallback',()=>{for(const f of [{...file(),period:undefined},{...file(),period:{...file().period,timeZone:'Asia/Tokyo'}},{...file(),period:{...file().period,lineageVersion:0}}])assert.deepEqual(project()([f],'UTC','2026-10-23',true),[]);});
test('partial input retains only known subtotal and never fills missing days',()=>{const rows=project()([file(),{...file(),period:undefined}],'UTC','2026-10-23',true);assert.equal(rows.length,1);assert.equal(rows[0].coverage,'partial');assert.equal(project()([file()],'UTC','2026-10-23',false)[0].coverage,'partial');});
test('missing model attribution is a separate unknown bucket, not fabricated known coverage',()=>{const f=file();f.period.days['2026-10-21'].byModel={};const row=project()([f],'UTC','2026-10-23',true).find((d:any)=>d.day==='2026-10-21');assert.deepEqual(row.models,{unknown:20});});

test('lazy diagnostics remain non-enumerable and do not alter equal display DTOs',()=>{
 const {snapshotFixture}=require('./codexFixtures');const usage=require('../providers/codex/codexUsage');
 const snapshot=snapshotFixture();const left=usage.buildCodexUsageView(snapshot),right=usage.buildCodexUsageView(structuredClone(snapshot));
 assert.deepEqual(left,right);assert.equal(Object.keys(left).includes('diagnosticDays'),false);assert.equal(typeof left.diagnosticDays,'function');
});
test('retained display identity adopts new diagnostic evidence without enumerable mutations',()=>{
 const usage=require('../providers/codex/codexUsage');const target:any={visible:'same'},next:any={visible:'same'};
 const old=()=>[{day:'2026-10-21',output:10}],fresh=()=>[{day:'2026-10-21',output:20}];
 Object.defineProperty(target,'diagnosticDays',{value:old,configurable:true});Object.defineProperty(next,'diagnosticDays',{value:fresh,configurable:true});
 const identity=target;usage.adoptCodexDiagnosticSource(target,next);assert.equal(target,identity);assert.deepEqual(target,{visible:'same'});
 assert.equal((target as any).diagnosticDays,fresh);assert.equal((target as any).diagnosticDays()[0].output,20);
});
test('immutable unchanged numeric source reuses the same hidden reader without hashing',()=>{
 const {snapshotFixture}=require('./codexFixtures');const {immutableCodexAchievementFiles}=require('../codexAchievementRevision');const usage=require('../providers/codex/codexUsage');
 const snapshot=snapshotFixture();snapshot.files=immutableCodexAchievementFiles(snapshot.files);
 const first=usage.buildCodexUsageView(snapshot),second=usage.buildCodexUsageView({...snapshot});assert.equal(first.diagnosticDays,second.diagnosticDays);
});
