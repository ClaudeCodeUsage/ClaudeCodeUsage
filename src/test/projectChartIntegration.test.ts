import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildProjectUsageMatrixSnapshot } from '../projectUsageMatrix';
import { I18n } from '../i18n';
const Module = require('node:module'), original = Module._load;
Module._load = function(name: string, ...args: unknown[]) { return name === 'vscode' ? {window:{activeColorTheme:{kind:2}}} : original.call(this,name,...args); };
let Provider: typeof import('../webview').UsageWebviewProvider;
try { Provider = require('../webview').UsageWebviewProvider; } finally { Module._load = original; }
const snapshot = buildProjectUsageMatrixSnapshot('codex',[
 {projectKey:'/private/source-a',projectName:'Alpha',day:'2026-10-22',tokens:11,coverage:'partial'},
 {projectKey:'/private/source-b',projectName:'Beta',day:'2026-10-22',tokens:20,coverage:'partial'},
],{asOfDay:'2026-10-23',timeZone:'UTC',coverage:'partial'});
function owner(){const p:any=Object.create(Provider.prototype);p.setting=(_key:string,fallback:unknown)=>fallback;p.codexView={projectUsageMatrix:snapshot};return p;}
test('real Projects renderer retains unknowns, scale controls and opaque filters',()=>{
 const html=owner().renderProjectUsageMatrix('codex');
 assert.match(html,/project-matrix-level-unknown/);assert.match(html,/data-project-scale-panel="week"/);
 assert.match(html,/data-project-scale-panel="month"/);assert.match(html,/data-project-filter="[a-f0-9-]+"/);
 assert.doesNotMatch(html,/\/private\/source/);assert.match(html,/data-tokens=""/);
});
test('real Projects renderer filters the source before ranking and preserves empty selection',()=>{
 const p=owner();p.projectChartSelection={codex:['/private/source-a']};
 const filtered=p.renderProjectUsageMatrix('codex');
 assert.equal((filtered.match(/class="project-matrix-row"/g)||[]).length,6);
 p.projectChartSelection.codex=[];const empty=p.renderProjectUsageMatrix('codex');
 assert.equal((empty.match(/class="project-matrix-row"/g)||[]).length,0);
 assert.ok(empty.includes(I18n.projectChartControls.empty));
 assert.ok(!empty.includes('class="project-matrix-area"'),'empty selection does not draw a numeric trend');
});

test('actual host filter boundary rejects foreign/stale handles and never reads source logs',()=>{
 const p=owner();p.currentProvider='codex';p.dashboardDocumentId='document';p.projectChartSelection={};
 p.allRecords=new Proxy([], {get(){throw Error('source read');}});let renders=0;p.updateWebview=()=>renders++;
 const html=p.renderProjectUsageMatrix('codex');const handles=[...html.matchAll(/data-project-filter="([^"<>]+)"/g)].map(m=>m[1]);
 const message={provider:'codex',documentId:'document',scope:p.projectChartHandleScopes.codex,handles:[handles[0]]};
 p.handleProjectChartFilter({...message,documentId:'stale'});p.handleProjectChartFilter({...message,handles:['foreign']});assert.equal(renders,0);
 p.handleProjectChartFilter(message);assert.equal(renders,1);assert.equal(p.projectChartSelection.codex.length,1);
 assert.equal(p.projectChartProjection(snapshot,30).rows.length,1);
 p.handleProjectChartFilter({...message,handles:[]});assert.equal(p.projectChartProjection(snapshot,30).status,'no-data');
 p.handleProjectChartFilter({...message,handles:[],all:true});assert.equal(p.projectChartProjection(snapshot,30).rows.length,2);
});

test('selection keys are opaque and runtime state retires without destroying stable handles',()=>{
 const p=owner();const first=p.renderProjectUsageMatrix('codex');
 const key=first.match(/data-project-selection-key="([^"<>]+)"/)![1];assert.match(key,/^30:day:h:[a-f0-9]{32}:/);assert.doesNotMatch(key,/Alpha|private/);
 const before=[...p.projectChartHandles.values()];p.projectChartSelection={codex:['/private/source-a']};
 p.clearProjectChartRuntime();assert.deepEqual(p.projectChartSelection,{});assert.equal(p.projectChartCache,undefined);assert.equal(p.projectChartHandles,undefined);
 p.renderProjectUsageMatrix('codex');assert.deepEqual([...p.projectChartHandles.values()],before);
});

test('retired source scopes and disappearing projects cannot revive old host filters',()=>{
 const p=owner();p.projectChartSelection={codex:['/private/source-a']};p.renderProjectUsageMatrix('codex');const scope=p.projectChartHandleScopes.codex;
 p.codexView.projectUsageMatrix=buildProjectUsageMatrixSnapshot('codex',[{projectKey:'/private/source-b',projectName:'Beta',day:'2026-10-22',tokens:20,coverage:'complete'}],{asOfDay:'2026-10-23',timeZone:'UTC'});
 const updated=p.renderProjectUsageMatrix('codex');assert.equal(p.projectChartSelection.codex,undefined);assert.match(updated,/data-project-filter-normalized="true"/);assert.match(updated,/Beta/);
 p.clearProjectChartRuntime(true);p.renderProjectUsageMatrix('codex');assert.notEqual(p.projectChartHandleScopes.codex,scope);
});

test('retiring one provider leaves the other provider filter intact',()=>{
 const p=owner();p.projectChartSelection={codex:['/private/source-a'],claude:['private-claude']};
 p.clearProjectChartRuntime(true,'claude');assert.deepEqual(p.projectChartSelection.codex,['/private/source-a']);
 assert.equal(p.projectChartSelection.claude,undefined);
});

test('real cached panel changes with host filtering and retains provider-specific scopes',()=>{
 const p=owner();p.codexView.limits=[];p.currentProvider='codex';p.dashboardDocumentId='doc';p.projectChartSelection={};p.dataPanelCache=new Map();
 let renders=0;const render=()=>p.cachedDataPanel('projects','codex',()=>{renders++;return p.renderProjectUsageMatrix('codex');});
 const before=render(),scope=p.projectChartHandleScopes.codex,handle=before.match(/data-project-filter="([^"<>]+)"/)![1];
 p.updateWebview=render;p.handleProjectChartFilter({documentId:'doc',provider:'codex',scope,handles:[handle]});
 assert.equal(renders,2);assert.equal((render().match(/class="project-matrix-row"/g)||[]).length,6);
 p.claudeProjectUsageMatrix={...snapshot,provider:'claude'};p.renderProjectUsageMatrix('claude');
 assert.notEqual(p.projectChartHandleScopes.claude,scope);assert.equal(p.projectChartHandleScopes.codex,scope);
 p.handleProjectChartFilter({documentId:'doc',provider:'codex',scope,handles:[],all:true});
 assert.equal((render().match(/class="project-matrix-row"/g)||[]).length,12);
});

test('large Token axes remain compact while retaining exact accessible values',()=>{
 const p=owner();p.codexView.projectUsageMatrix=buildProjectUsageMatrixSnapshot('codex',[
  {projectKey:'large',projectName:'Large',day:'2026-10-22',tokens:1_000_000_000,coverage:'complete'},
 ],{asOfDay:'2026-10-23',timeZone:'UTC',coverage:'complete'});
 const html=p.renderProjectUsageMatrix('codex');
 const labels=[...html.matchAll(/<span data-axis-tokens="([^"]+)"([^>]*)>([^<]+)<\/span>/g)];
 assert.ok(labels.length>0);
 for(const [,value,attributes,label] of labels) {
  assert.ok(label.length<=8,'axis exceeds narrow gutter: '+label);
  assert.ok(attributes.includes('title="'+I18n.formatNumber(Number(value))+' Token"'));
 }
});

test('confirmed zero periods paint no positive Token segment',()=>{
 const p=owner();p.codexView.projectUsageMatrix=buildProjectUsageMatrixSnapshot('codex',[
  {projectKey:'zero',projectName:'Zero',day:'2026-10-22',tokens:0,coverage:'complete'},
 ],{asOfDay:'2026-10-23',timeZone:'UTC',coverage:'complete'});
 const html=p.renderProjectUsageMatrix('codex');
 assert.ok(!html.includes('class="project-matrix-trend-segment'));
 assert.ok(!/class="project-matrix-area-\d"/.test(html));
 assert.ok(html.includes('0 Token'));
});

test('area transitions from confirmed zero to known positive remain connected',()=>{
 const p=owner();p.codexView.projectUsageMatrix=buildProjectUsageMatrixSnapshot('codex',[
  {projectKey:'rise',projectName:'Rise',day:'2026-10-22',tokens:0,coverage:'complete'},
  {projectKey:'rise',projectName:'Rise',day:'2026-10-23',tokens:10,coverage:'complete'},
 ],{asOfDay:'2026-10-23',timeZone:'UTC',coverage:'complete'});
 const html=p.renderProjectUsageMatrix('codex');
 assert.match(html,/<polygon class="project-matrix-area-0" points="[\d.]+,145 [\d.]+,145 [\d.]+,15 [\d.]+,145"/);
});
